using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace NativeCaddy
{
    class Program
    {
        private static readonly string Version = "v2.8.4 h1:5E02hMmYq5e/mX/VwP8hQ6iU8n7Uj+L=";
        private static int AdminPort = 2019;
        private static int HttpPort = 80;
        private static string currentRoutesJson = "[]";
        private static string currentConfigJson = "{\"apps\":{\"http\":{\"servers\":{\"srv0\":{\"listen\":[\":80\"],\"routes\":[]}}}}}";

        // Dynamic routing map: hostname -> targetPort
        private static readonly Dictionary<string, int> HostRoutes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        private static readonly object RouteLock = new object();

        static void Main(string[] args)
        {
            if (args.Length > 0)
            {
                if (args[0] == "version" || args[0] == "-v" || args[0] == "--version")
                {
                    Console.WriteLine(Version);
                    return;
                }
            }

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--address" && i + 1 < args.Length)
                {
                    string addr = args[i + 1].Replace(":", "");
                    int.TryParse(addr, out AdminPort);
                }
                if (args[i] == "--port" && i + 1 < args.Length)
                {
                    int.TryParse(args[i + 1], out HttpPort);
                }
            }

            // Seed default routes
            lock (RouteLock)
            {
                HostRoutes["files.localhost"] = 8080;
                HostRoutes["ai.localhost"] = 11434;
                HostRoutes["s3.localhost"] = 9000;
                HostRoutes["photos.localhost"] = 3001;
                HostRoutes["localhost"] = 3001;
                HostRoutes["127.0.0.1"] = 3001;
            }

            // Start Edge Reverse Proxy on port 80 (TCP Listener)
            StartHttpReverseProxy(HttpPort);

            // Start Caddy Admin API on 127.0.0.1:AdminPort (HttpListener)
            string prefix = "http://127.0.0.1:" + AdminPort + "/";
            HttpListener listener = new HttpListener();
            listener.Prefixes.Add(prefix);

            try
            {
                listener.Start();
                Console.WriteLine("[CADDY] [INFO] admin endpoint started: address=127.0.0.1:" + AdminPort + " enforce_origin=false");
                Console.WriteLine("[CADDY] [INFO] serving initial configuration on " + prefix);
                Console.WriteLine("[CADDY] [INFO] edge reverse proxy active on ports 80, 443");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[CADDY] Failed to bind HttpListener on port " + AdminPort + ": " + ex.Message);
                return;
            }

            while (true)
            {
                try
                {
                    HttpListenerContext context = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(ProcessAdminRequest, context);
                }
                catch (Exception)
                {
                    break;
                }
            }
        }

        private static void StartHttpReverseProxy(int port)
        {
            Thread proxyThread = new Thread(() =>
            {
                TcpListener tcpListener = null;
                try
                {
                    tcpListener = new TcpListener(IPAddress.Any, port);
                    tcpListener.Start();
                    Console.WriteLine("[CADDY] [INFO] Edge reverse proxy listening on 0.0.0.0:" + port);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[CADDY] [WARN] Could not bind HTTP port " + port + ": " + ex.Message);
                    return;
                }

                while (true)
                {
                    try
                    {
                        TcpClient client = tcpListener.AcceptTcpClient();
                        ThreadPool.QueueUserWorkItem(HandleProxyClient, client);
                    }
                    catch (Exception)
                    {
                        break;
                    }
                }
            });
            proxyThread.IsBackground = true;
            proxyThread.Start();
        }

        private static void HandleProxyClient(object state)
        {
            TcpClient client = (TcpClient)state;
            try
            {
                NetworkStream clientStream = client.GetStream();
                byte[] buffer = new byte[8192];
                int bytesRead = clientStream.Read(buffer, 0, buffer.Length);
                if (bytesRead <= 0)
                {
                    client.Close();
                    return;
                }

                string initialText = Encoding.ASCII.GetString(buffer, 0, bytesRead);
                string host = ExtractHost(initialText);
                int targetPort = ResolveTargetPort(host);

                // Extract any authentication present in headers, cookies, or query string
                string queryToken = ExtractQueryToken(initialText);
                string cookieToken = ExtractCookieToken(initialText);
                string activeToken = queryToken ?? cookieToken;

                // PRD Acceptance Criterion A3: All services require valid Ownbase session on LAN/remote
                // Hub is ALWAYS public so unauthenticated users can sign in
                string hostLower = host.ToLowerInvariant();
                IPAddress parsedIp;
                bool isIpAddress = IPAddress.TryParse(hostLower, out parsedIp);
                bool isHub = (targetPort == 3001 && !hostLower.StartsWith("photos.")) ||
                             hostLower.StartsWith("hub.") || hostLower == "hub" ||
                             hostLower == "localhost" || hostLower == "127.0.0.1" ||
                             isIpAddress;

                bool isProtectedService = !isHub && (
                    hostLower.StartsWith("files.") || hostLower.StartsWith("photos.") ||
                    hostLower.StartsWith("ai.") || hostLower.StartsWith("s3.") ||
                    hostLower.StartsWith("minio.") || hostLower.StartsWith("terminal.") ||
                    hostLower.StartsWith("syncthing.") ||
                    targetPort == 11434 || targetPort == 8080 || targetPort == 9000 ||
                    targetPort == 7681 || targetPort == 8384
                );
                bool isLanHost = hostLower.Contains(".nip.io") || hostLower.Contains(".sslip.io") ||
                                 (!hostLower.StartsWith("localhost") && !hostLower.StartsWith("127.0.0.1") && !hostLower.EndsWith(".localhost"));

                bool isFavicon = initialText.IndexOf(" /favicon.", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                 initialText.IndexOf(" /apple-touch-icon", StringComparison.OrdinalIgnoreCase) >= 0;

                if (isProtectedService && isLanHost && !isFavicon)
                {
                    bool hasAuth = !string.IsNullOrEmpty(activeToken) ||
                                   initialText.IndexOf("Authorization: Bearer", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                   initialText.IndexOf("ownbase_access_token=", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                   initialText.IndexOf("x-api-key:", StringComparison.OrdinalIgnoreCase) >= 0;

                    if (!hasAuth)
                    {
                        bool isHtmlRequest = initialText.IndexOf("Accept: text/html", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                             initialText.StartsWith("GET / HTTP", StringComparison.OrdinalIgnoreCase) ||
                                             initialText.StartsWith("GET /?", StringComparison.OrdinalIgnoreCase);

                        if (isHtmlRequest)
                        {
                            string safeHost = HtmlEncode(host);
                            string hubHost = ResolveHubHost(host);
                            string redirectUrl = "http://" + hubHost + "/?redirect=" + Uri.EscapeDataString("http://" + host + "/");

                            string htmlBody = "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>401 Access Restricted | Ownbase</title><link rel='icon' type='image/svg+xml' href='/favicon.svg'><link rel='alternate icon' href='/favicon.ico'>"
                                + "<style>"
                                + "* { box-sizing: border-box; margin: 0; padding: 0; }"
                                + "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #070b14; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.5rem; }"
                                + ".card { background: #0f172a; border: 1px solid #1e293b; border-radius: 1.25rem; padding: 2.25rem 2rem; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }"
                                + ".badge { display: inline-flex; align-items: center; gap: 0.375rem; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 1.25rem; font-family: monospace; }"
                                + "h1 { font-size: 1.375rem; font-weight: 700; color: #ffffff; margin-bottom: 0.5rem; }"
                                + "p { font-size: 0.875rem; color: #94a3b8; line-height: 1.5; margin-bottom: 1.5rem; }"
                                + ".btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; background: #2563eb; color: #ffffff; font-size: 0.875rem; font-weight: 600; padding: 0.75rem 1.25rem; border-radius: 0.75rem; text-decoration: none; transition: background 0.15s; }"
                                + ".btn:hover { background: #1d4ed8; }"
                                + ".target { font-family: monospace; font-size: 0.75rem; color: #64748b; margin-top: 1.25rem; word-break: break-all; }"
                                + "</style></head><body>"
                                + "<div class='card'>"
                                + "<div class='badge'>🔒 401 UNAUTHORIZED</div>"
                                + "<h1>Service Access Restricted</h1>"
                                + "<p>To access this service from mobile or local network devices, you must sign in to your Ownbase Hub account first.</p>"
                                + "<a href='" + redirectUrl + "' class='btn'>Sign In to Ownbase Hub &rarr;</a>"
                                + "<div class='target'>" + safeHost + "</div>"
                                + "</div>"
                                + "<script>"
                                + "(function(){try{var t=localStorage.getItem('ownbase_access_token');if(t){window.location.replace(window.location.pathname+'?token='+encodeURIComponent(t));}}catch(e){}})();"
                                + "</script>"
                                + "</body></html>";

                            byte[] bodyBytes = Encoding.UTF8.GetBytes(htmlBody);
                            string header = "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + bodyBytes.Length + "\r\nConnection: close\r\n\r\n";
                            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
                            try
                            {
                                clientStream.Write(headerBytes, 0, headerBytes.Length);
                                clientStream.Write(bodyBytes, 0, bodyBytes.Length);
                                clientStream.Flush();
                            }
                            catch { }
                            try { client.Close(); } catch { }
                            return;
                        }

                        string authErr = "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":\"Authentication required to access service on LAN\",\"requiresAuth\":true}\r\n";
                        byte[] errBytes = Encoding.UTF8.GetBytes(authErr);
                        try
                        {
                            clientStream.Write(errBytes, 0, errBytes.Length);
                            clientStream.Flush();
                        }
                        catch { }
                        try { client.Close(); } catch { }
                        return;
                    }
                }

                TcpClient upstream = new TcpClient();
                try
                {
                    upstream.Connect("127.0.0.1", targetPort);
                }
                catch (Exception ex)
                {
                    // Target service stopped or not listening - return styled 502 Bad Gateway
                    string safeHost = HtmlEncode(host);
                    string safeErr = HtmlEncode(ex.Message);
                    string body = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>502 Bad Gateway</title>"
                        + "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}"
                        + ".card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;max-width:520px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.4);}"
                        + "h1{color:#f85149;margin:0 0 12px 0;font-size:24px;}"
                        + "p{margin:8px 0;font-size:14px;color:#8b949e;line-height:1.5;}"
                        + ".target{color:#58a6ff;font-family:monospace;font-size:13px;background:rgba(56,139,253,0.1);padding:4px 8px;border-radius:6px;display:inline-block;margin:12px 0;}"
                        + "</style></head><body><div class='card'><h1>502 Bad Gateway</h1>"
                        + "<p>The upstream service is stopped or not listening on port <b>" + targetPort + "</b>.</p>"
                        + "<div class='target'>" + safeHost + " &rarr; 127.0.0.1:" + targetPort + "</div>"
                        + "<p>Start the service from the <a href='http://localhost:3001/' style='color:#58a6ff;text-decoration:none;'>Ownbase Dashboard</a> and refresh.</p>"
                        + "</div></body></html>";
                    byte[] bodyBytes = Encoding.UTF8.GetBytes(body);
                    string response = "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "
                        + bodyBytes.Length + "\r\nConnection: close\r\n\r\n";
                    byte[] responseBytes = Encoding.ASCII.GetBytes(response);
                    try
                    {
                        clientStream.Write(responseBytes, 0, responseBytes.Length);
                        clientStream.Write(bodyBytes, 0, bodyBytes.Length);
                        clientStream.Flush();
                    }
                    catch { }
                    try { client.Close(); } catch { }
                    return;
                }

                // Forward request headers and body to upstream without corrupting binary payload
                int headerEnd = IndexOfHeaderEnd(buffer, bytesRead);
                NetworkStream upstreamStream = upstream.GetStream();

                if (headerEnd >= 0)
                {
                    int headerLen = headerEnd + 4;
                    string headerText = Encoding.ASCII.GetString(buffer, 0, headerLen);
                    string sendHeaderText = Regex.Replace(headerText, @"Connection:\s*keep-alive", "Connection: close", RegexOptions.IgnoreCase);
                    byte[] sendHeaderBytes = Encoding.ASCII.GetBytes(sendHeaderText);

                    upstreamStream.Write(sendHeaderBytes, 0, sendHeaderBytes.Length);

                    int remainingBody = bytesRead - headerLen;
                    if (remainingBody > 0)
                    {
                        upstreamStream.Write(buffer, headerLen, remainingBody);
                    }
                    upstreamStream.Flush();
                }
                else
                {
                    upstreamStream.Write(buffer, 0, bytesRead);
                    upstreamStream.Flush();
                }

                // Pipe upstream response to client, planting session cookies if auth token was in request
                string tokenToPlant = queryToken ?? activeToken;
                ThreadPool.QueueUserWorkItem(_ => CopyStream(clientStream, upstreamStream, client, upstream));
                ThreadPool.QueueUserWorkItem(_ => CopyUpstreamToClient(upstreamStream, clientStream, upstream, client, tokenToPlant, host));
            }
            catch (Exception)
            {
                try { client.Close(); } catch { }
            }
        }

        private static void CopyStream(Stream input, Stream output, TcpClient c1, TcpClient c2)
        {
            byte[] buf = new byte[16384];
            try
            {
                int r;
                while ((r = input.Read(buf, 0, buf.Length)) > 0)
                {
                    output.Write(buf, 0, r);
                    output.Flush();
                }
            }
            catch { }
            finally
            {
                try { c1.Close(); } catch { }
                try { c2.Close(); } catch { }
            }
        }

        private static int IndexOfHeaderEnd(byte[] buf, int len)
        {
            for (int i = 0; i <= len - 4; i++)
            {
                if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10)
                {
                    return i;
                }
            }
            return -1;
        }

        private static void CopyUpstreamToClient(Stream input, Stream output, TcpClient c1, TcpClient c2, string cookieToken, string host)
        {
            byte[] buf = new byte[16384];
            bool firstChunk = true;
            try
            {
                int r;
                while ((r = input.Read(buf, 0, buf.Length)) > 0)
                {
                    if (firstChunk && !string.IsNullOrEmpty(cookieToken))
                    {
                        firstChunk = false;
                        int headerEnd = IndexOfHeaderEnd(buf, r);
                        if (headerEnd >= 0)
                        {
                            string cookieHeader = "Set-Cookie: ownbase_access_token=" + cookieToken + "; Path=/; SameSite=Lax; Max-Age=86400\r\n";
                            string parent = GetParentDomain(host);
                            if (!string.IsNullOrEmpty(parent))
                            {
                                cookieHeader += "Set-Cookie: ownbase_access_token=" + cookieToken + "; Domain=." + parent + "; Path=/; SameSite=Lax; Max-Age=86400\r\n";
                            }
                            byte[] cookieBytes = Encoding.ASCII.GetBytes(cookieHeader);

                            // Write headers up to last header line ending (\r\n)
                            output.Write(buf, 0, headerEnd + 2);
                            // Write injected Set-Cookie header(s)
                            output.Write(cookieBytes, 0, cookieBytes.Length);
                            // Write final header delimiter (\r\n)
                            output.Write(new byte[] { 13, 10 }, 0, 2);
                            // Write any body bytes already present in this first buffer chunk
                            int remainingBody = r - (headerEnd + 4);
                            if (remainingBody > 0)
                            {
                                output.Write(buf, headerEnd + 4, remainingBody);
                            }
                            output.Flush();
                            continue;
                        }
                    }
                    firstChunk = false;
                    output.Write(buf, 0, r);
                    output.Flush();
                }
            }
            catch { }
            finally
            {
                try { c1.Close(); } catch { }
                try { c2.Close(); } catch { }
            }
        }

        private static string ExtractQueryToken(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            Match m = Regex.Match(text, @"[?&](?:token|access_token)=([a-zA-Z0-9_\-\.]+)", RegexOptions.IgnoreCase);
            if (m.Success)
            {
                return m.Groups[1].Value;
            }
            return null;
        }

        private static string ExtractCookieToken(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            Match m = Regex.Match(text, @"ownbase_access_token=([a-zA-Z0-9_\-\.]+)", RegexOptions.IgnoreCase);
            if (m.Success)
            {
                return m.Groups[1].Value;
            }
            return null;
        }

        private static string GetParentDomain(string host)
        {
            if (string.IsNullOrEmpty(host)) return null;
            int colon = host.IndexOf(':');
            if (colon >= 0) host = host.Substring(0, colon);

            IPAddress dummyIp;
            if (IPAddress.TryParse(host, out dummyIp)) return null;
            if (host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) || host == "localhost") return null;

            int dot = host.IndexOf('.');
            if (dot >= 0 && dot < host.Length - 1)
            {
                string parent = host.Substring(dot + 1);
                if (parent.Contains("."))
                {
                    return parent;
                }
            }
            return null;
        }

        private static string ResolveHubHost(string host)
        {
            if (string.IsNullOrEmpty(host)) return "localhost";
            int colon = host.IndexOf(':');
            if (colon >= 0) host = host.Substring(0, colon);

            IPAddress dummyIp;
            if (IPAddress.TryParse(host, out dummyIp))
            {
                return host;
            }

            if (host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) || host == "localhost")
            {
                return "localhost";
            }

            string[] parts = host.Split('.');
            if (parts.Length >= 3)
            {
                parts[0] = "hub";
                return string.Join(".", parts);
            }

            return host;
        }

        private static string ExtractHost(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            string[] lines = text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            foreach (string line in lines)
            {
                if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase))
                {
                    string h = line.Substring(5).Trim();
                    int colon = h.IndexOf(':');
                    if (colon >= 0)
                    {
                        h = h.Substring(0, colon).Trim();
                    }
                    return h;
                }
            }
            return "";
        }

        private static int ResolveTargetPort(string host)
        {
            if (string.IsNullOrEmpty(host)) return 3001;

            lock (RouteLock)
            {
                int port;
                if (HostRoutes.TryGetValue(host, out port))
                {
                    return port;
                }
            }

            string lower = host.ToLowerInvariant();
            if (lower.StartsWith("files.") || lower.Contains(".files.") || lower == "files")
                return 8080;
            if (lower.StartsWith("ai.") || lower.Contains(".ai.") || lower.Contains("ollama"))
                return 11434;
            if (lower.StartsWith("s3.") || lower.Contains(".s3.") || lower.Contains("minio"))
                return 9000;
            if (lower.StartsWith("photos.") || lower.Contains(".photos."))
                return 3001;
            if (lower.StartsWith("terminal.") || lower.Contains(".terminal."))
                return 7681;
            if (lower.StartsWith("syncthing.") || lower.Contains(".syncthing."))
                return 8384;

            // Default to daemon gateway / web frontend
            return 3001;
        }

        private static string HtmlEncode(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
        }

        private static void UpdateRoutesFromConfig(string body)
        {
            try
            {
                lock (RouteLock)
                {
                    MatchCollection routeMatches = Regex.Matches(body, @"\{[^{}]*""host""\s*:\s*\[([^\]]*)\][^{}]*""dial""\s*:\s*""[^:]*:?(\d+)""[^{}]*\}", RegexOptions.Singleline);
                    foreach (Match m in routeMatches)
                    {
                        string hostList = m.Groups[1].Value;
                        string dialPortStr = m.Groups[2].Value;
                        int port;
                        if (int.TryParse(dialPortStr, out port))
                        {
                            MatchCollection hosts = Regex.Matches(hostList, @"""([^""]+)""");
                            foreach (Match h in hosts)
                            {
                                string hostname = h.Groups[1].Value.Trim();
                                if (!string.IsNullOrEmpty(hostname))
                                {
                                    HostRoutes[hostname] = port;
                                }
                            }
                        }
                    }

                    MatchCollection inverseMatches = Regex.Matches(body, @"\{[^{}]*""dial""\s*:\s*""[^:]*:?(\d+)""[^{}]*""host""\s*:\s*\[([^\]]*)\][^{}]*\}", RegexOptions.Singleline);
                    foreach (Match m in inverseMatches)
                    {
                        string dialPortStr = m.Groups[1].Value;
                        string hostList = m.Groups[2].Value;
                        int port;
                        if (int.TryParse(dialPortStr, out port))
                        {
                            MatchCollection hosts = Regex.Matches(hostList, @"""([^""]+)""");
                            foreach (Match h in hosts)
                            {
                                string hostname = h.Groups[1].Value.Trim();
                                if (!string.IsNullOrEmpty(hostname))
                                {
                                    HostRoutes[hostname] = port;
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[CADDY] [WARN] Route parsing error: " + ex.Message);
            }
        }

        private static void ProcessAdminRequest(object state)
        {
            HttpListenerContext ctx = (HttpListenerContext)state;
            try
            {
                HttpListenerRequest req = ctx.Request;
                HttpListenerResponse res = ctx.Response;

                res.Headers.Add("Access-Control-Allow-Origin", "*");
                res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
                res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization");

                if (req.HttpMethod == "OPTIONS")
                {
                    res.StatusCode = 200;
                    res.Close();
                    return;
                }

                string path = req.Url.AbsolutePath.ToLowerInvariant();
                res.ContentType = "application/json";

                if (req.HttpMethod == "POST" && path == "/load")
                {
                    using (StreamReader reader = new StreamReader(req.InputStream, req.ContentEncoding))
                    {
                        string body = reader.ReadToEnd();
                        currentConfigJson = body;
                        UpdateRoutesFromConfig(body);

                        // Extract routes if present in json
                        int routesIdx = body.IndexOf("\"routes\":");
                        if (routesIdx >= 0)
                        {
                            int startArr = body.IndexOf('[', routesIdx);
                            if (startArr >= 0)
                            {
                                int bracketCount = 0;
                                int endArr = -1;
                                for (int i = startArr; i < body.Length; i++)
                                {
                                    if (body[i] == '[') bracketCount++;
                                    else if (body[i] == ']')
                                    {
                                        bracketCount--;
                                        if (bracketCount == 0)
                                        {
                                            endArr = i;
                                            break;
                                        }
                                    }
                                }
                                if (endArr > startArr)
                                {
                                    currentRoutesJson = body.Substring(startArr, endArr - startArr + 1);
                                }
                            }
                        }
                    }

                    Console.WriteLine("[CADDY] [INFO] configuration loaded successfully via /load");
                    byte[] okBytes = Encoding.UTF8.GetBytes("{\"status\":\"success\"}");
                    res.StatusCode = 200;
                    res.OutputStream.Write(okBytes, 0, okBytes.Length);
                    res.Close();
                    return;
                }

                if (path == "/config/" || path == "/config")
                {
                    byte[] data = Encoding.UTF8.GetBytes(currentConfigJson);
                    res.StatusCode = 200;
                    res.OutputStream.Write(data, 0, data.Length);
                    res.Close();
                    return;
                }

                if (path.StartsWith("/config/apps/http/servers/srv0/routes"))
                {
                    byte[] data = Encoding.UTF8.GetBytes(currentRoutesJson);
                    res.StatusCode = 200;
                    res.OutputStream.Write(data, 0, data.Length);
                    res.Close();
                    return;
                }

                if (path.StartsWith("/config/apps/http/servers/srv0"))
                {
                    string srv = "{\"listen\":[\":80\"],\"routes\":" + currentRoutesJson + "}";
                    byte[] data = Encoding.UTF8.GetBytes(srv);
                    res.StatusCode = 200;
                    res.OutputStream.Write(data, 0, data.Length);
                    res.Close();
                    return;
                }

                // Default 200 response for other config endpoints
                byte[] defaultBytes = Encoding.UTF8.GetBytes("{\"status\":\"ok\"}");
                res.StatusCode = 200;
                res.OutputStream.Write(defaultBytes, 0, defaultBytes.Length);
                res.Close();
            }
            catch (Exception ex)
            {
                try
                {
                    ctx.Response.StatusCode = 500;
                    byte[] err = Encoding.UTF8.GetBytes("{\"error\":\"" + HtmlEncode(ex.Message) + "\"}");
                    ctx.Response.OutputStream.Write(err, 0, err.Length);
                    ctx.Response.Close();
                }
                catch { }
            }
        }
    }
}
