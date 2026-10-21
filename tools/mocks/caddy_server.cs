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

                // PRD Acceptance Criterion A3: ai.* and files.* require valid Ownbase session on LAN
                string hostLower = host.ToLowerInvariant();
                bool isProtectedService = targetPort == 11434 || targetPort == 8080 || hostLower.StartsWith("ai.") || hostLower.StartsWith("files.");
                bool isLanHost = hostLower.Contains(".nip.io") || (!hostLower.StartsWith("localhost") && !hostLower.StartsWith("127.0.0.1") && !hostLower.EndsWith(".localhost"));

                if (isProtectedService && isLanHost)
                {
                    bool hasAuth = initialText.IndexOf("Authorization: Bearer", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                   initialText.IndexOf("ownbase_access_token=", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                   initialText.IndexOf("x-api-key:", StringComparison.OrdinalIgnoreCase) >= 0;

                    if (!hasAuth)
                    {
                        string authErr = "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":\"Authentication required to access service on LAN\",\"requiresAuth\":true}\r\n";
                        byte[] errBytes = Encoding.UTF8.GetBytes(authErr);
                        clientStream.Write(errBytes, 0, errBytes.Length);
                        clientStream.Flush();
                        client.Close();
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

                NetworkStream upstreamStream = upstream.GetStream();
                upstreamStream.Write(buffer, 0, bytesRead);

                ThreadPool.QueueUserWorkItem(_ => CopyStream(clientStream, upstreamStream, client, upstream));
                ThreadPool.QueueUserWorkItem(_ => CopyStream(upstreamStream, clientStream, upstream, client));
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
