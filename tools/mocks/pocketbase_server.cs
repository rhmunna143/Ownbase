using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace OwnbaseMocks
{
    class PocketBaseServer
    {
        static void Main(string[] args)
        {
            int port = 8090;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--http" && i + 1 < args.Length)
                {
                    string val = args[i + 1];
                    int colon = val.LastIndexOf(':');
                    if (colon >= 0)
                    {
                        int.TryParse(val.Substring(colon + 1), out port);
                    }
                }
            }

            string prefix = "http://127.0.0.1:" + port + "/";
            HttpListener listener = new HttpListener();
            listener.Prefixes.Add(prefix);

            try
            {
                listener.Start();
                Console.WriteLine("[POCKETBASE] PocketBase Server listening at " + prefix);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[POCKETBASE-ERROR] Failed to start listener: " + ex.Message);
                return;
            }

            while (listener.IsListening)
            {
                try
                {
                    var ctx = listener.GetContext();
                    ThreadPool.QueueUserWorkItem((state) => HandleRequest(ctx));
                }
                catch
                {
                    break;
                }
            }
        }

        static void HandleRequest(HttpListenerContext ctx)
        {
            try
            {
                string path = ctx.Request.Url.AbsolutePath;
                if (path == "/favicon.ico" || path == "/favicon.svg")
                {
                    const string svg = @"<svg xmlns=""http://www.w3.org/2000/svg"" viewBox=""0 0 64 64"">
  <defs>
    <linearGradient id=""pbGrad"" x1=""0%"" y1=""0%"" x2=""100%"" y2=""100%"">
      <stop offset=""0%"" stop-color=""#10b981""/>
      <stop offset=""100%"" stop-color=""#047857""/>
    </linearGradient>
  </defs>
  <rect width=""64"" height=""64"" rx=""16"" fill=""#06120d""/>
  <rect x=""2"" y=""2"" width=""60"" height=""60"" rx=""14"" fill=""none"" stroke=""#064e3b"" stroke-width=""1.5""/>
  <rect x=""16"" y=""16"" width=""32"" height=""32"" rx=""8"" fill=""url(#pbGrad)""/>
  <path d=""M22,26 C22,34 26,38 32,38 C38,38 42,34 42,26"" fill=""none"" stroke=""#ffffff"" stroke-width=""3"" stroke-linecap=""round""/>
</svg>";
                    byte[] bytesSvg = Encoding.UTF8.GetBytes(svg);
                    ctx.Response.ContentType = (path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)) ? "image/x-icon" : "image/svg+xml";
                    ctx.Response.OutputStream.Write(bytesSvg, 0, bytesSvg.Length);
                    ctx.Response.Close();
                    return;
                }

                if (path == "/api/health")
                {
                    string json = "{\"code\":200,\"message\":\"API is healthy.\",\"data\":{\"canBackup\":true}}";
                    byte[] data = Encoding.UTF8.GetBytes(json);
                    ctx.Response.ContentType = "application/json";
                    ctx.Response.OutputStream.Write(data, 0, data.Length);
                    ctx.Response.Close();
                    return;
                }

                string html = @"<!DOCTYPE html>
<html>
<head><title>PocketBase - Ownbase</title>
<link rel=""icon"" type=""image/svg+xml"" href=""/favicon.svg"">
<link rel=""alternate icon"" href=""/favicon.ico"">
<style>body{background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:40px;text-align:center;}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;display:inline-block;max-width:480px;}
h1{color:#2f81f7;margin-top:0;}
.badge{background:#238636;color:white;padding:4px 10px;border-radius:6px;font-size:12px;}
</style></head>
<body><div class=""card""><h1>PocketBase Backend</h1>
<p><span class=""badge"">Realtime SQLite Active</span></p>
<p>Ready to power web apps, mobile backends, and microservices.</p>
<p>API Endpoint: <code>/api/</code></p>
</div></body></html>";
                byte[] bytes = Encoding.UTF8.GetBytes(html);
                ctx.Response.ContentType = "text/html; charset=utf-8";
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                ctx.Response.Close();
            }
            catch {}
        }
    }
}
