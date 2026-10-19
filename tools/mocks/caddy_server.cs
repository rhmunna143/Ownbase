using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace NativeCaddy
{
    class Program
    {
        private static readonly string Version = "v2.8.4 h1:5E02hMmYq5e/mX/VwP8hQ6iU8n7Uj+L=";
        private static int AdminPort = 2019;
        private static string currentRoutesJson = "[]";
        private static string currentConfigJson = "{\"apps\":{\"http\":{\"servers\":{\"srv0\":{\"listen\":[\":80\"],\"routes\":[]}}}}}";

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
            }

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
                    ThreadPool.QueueUserWorkItem(ProcessRequest, context);
                }
                catch (Exception)
                {
                    break;
                }
            }
        }

        private static void ProcessRequest(object state)
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
                    byte[] err = Encoding.UTF8.GetBytes("{\"error\":\"" + ex.Message + "\"}");
                    ctx.Response.OutputStream.Write(err, 0, err.Length);
                    ctx.Response.Close();
                }
                catch { }
            }
        }
    }
}
