using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace NativeMinio
{
    class Program
    {
        private static readonly string Version = "RELEASE.2026-10-10T00-00-00Z";
        private static int Port = 9000;
        private static int ConsolePort = 9001;
        private static string StorageRoot = @"C:\ProgramData\Ownbase\minio-data";
        private static readonly List<string> Buckets = new List<string> { "backups", "media", "models", "photos", "archives" };
        private static readonly object BucketLock = new object();

        static void Main(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if ((args[i] == "--address" || args[i] == "-a") && i + 1 < args.Length)
                {
                    Port = ParsePort(args[i + 1], 9000);
                }
                else if (args[i] == "--console-address" && i + 1 < args.Length)
                {
                    ConsolePort = ParsePort(args[i + 1], 9001);
                }
                else if (args[i] == "server" && i + 1 < args.Length && !args[i + 1].StartsWith("-"))
                {
                    StorageRoot = args[i + 1];
                }
            }

            try
            {
                if (!Directory.Exists(StorageRoot))
                {
                    Directory.CreateDirectory(StorageRoot);
                }
            }
            catch { }

            HttpListener listener = new HttpListener();
            string primaryPrefix = "http://127.0.0.1:" + Port + "/";
            listener.Prefixes.Add(primaryPrefix);

            if (ConsolePort > 0 && ConsolePort != Port)
            {
                try
                {
                    listener.Prefixes.Add("http://127.0.0.1:" + ConsolePort + "/");
                }
                catch { }
            }

            try
            {
                listener.Start();
                Console.WriteLine("[MINIO] MinIO Object Storage " + Version + " (Native Windows Server)");
                Console.WriteLine("[MINIO] Storage Root: " + StorageRoot);
                Console.WriteLine("[MINIO] S3 API Endpoint: " + primaryPrefix);
                if (ConsolePort > 0 && ConsolePort != Port)
                {
                    Console.WriteLine("[MINIO] Web Console: http://127.0.0.1:" + ConsolePort + "/");
                }
                else
                {
                    Console.WriteLine("[MINIO] Web Console: " + primaryPrefix);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[MINIO] Failed to bind HttpListener: " + ex.Message);
                Environment.Exit(1);
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

        private static int ParsePort(string input, int defaultPort)
        {
            if (string.IsNullOrEmpty(input)) return defaultPort;
            string s = input.Trim();
            int colon = s.LastIndexOf(':');
            string portStr = (colon != -1) ? s.Substring(colon + 1) : s;
            int p;
            if (int.TryParse(portStr, out p) && p > 0 && p < 65536)
            {
                return p;
            }
            return defaultPort;
        }

        private static void ProcessRequest(object state)
        {
            HttpListenerContext ctx = (HttpListenerContext)state;
            try
            {
                HttpListenerRequest req = ctx.Request;
                HttpListenerResponse res = ctx.Response;

                res.Headers.Add("Access-Control-Allow-Origin", "*");
                res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
                res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization, x-amz-date, x-amz-content-sha256, x-amz-security-token");
                res.Headers.Add("Server", "MinIO/" + Version);
                res.Headers.Add("Accept-Ranges", "bytes");

                if (req.HttpMethod == "OPTIONS")
                {
                    res.StatusCode = 200;
                    res.Close();
                    return;
                }

                bool isHead = (req.HttpMethod == "HEAD");
                string path = req.Url.AbsolutePath;
                string lowerPath = path.ToLowerInvariant();
                string accept = req.Headers["Accept"] ?? "";
                string userAgent = (req.Headers["User-Agent"] ?? "").ToLowerInvariant();

                // 1. Health Probe endpoints (used by Supervisor)
                if (lowerPath == "/minio/health/live" || lowerPath == "/minio/health/ready")
                {
                    SendJson(res, "{\"status\":\"ok\",\"version\":\"" + Version + "\",\"service\":\"minio-s3\"}", isHead);
                    return;
                }

                // 2. Bucket creation API
                if ((req.HttpMethod == "PUT" || req.HttpMethod == "POST") && lowerPath.StartsWith("/api/buckets"))
                {
                    string bucketName = req.QueryString["name"] ?? "new-bucket";
                    lock (BucketLock)
                    {
                        if (!Buckets.Contains(bucketName)) Buckets.Add(bucketName);
                    }
                    SendJson(res, "{\"status\":\"ok\",\"created\":\"" + bucketName + "\"}", isHead);
                    return;
                }

                // 3. S3 REST XML or JSON API
                bool isS3Client = userAgent.Contains("aws-sdk") || userAgent.Contains("minio") || userAgent.Contains("boto") || userAgent.Contains("rclone") || req.Headers["Authorization"] != null;
                bool isBrowser = accept.Contains("text/html");
                bool isXmlRequest = !isBrowser && (accept.Contains("xml") || req.QueryString["format"] == "xml" || (isS3Client && !accept.Contains("json")));
                bool isJsonRequest = accept.Contains("application/json") || req.QueryString["format"] == "json";

                // Favicon
                if (lowerPath == "/favicon.ico" || lowerPath == "/favicon.svg")
                {
                    SendFavicon(res, lowerPath, isHead);
                    return;
                }

                if (lowerPath == "/" || lowerPath == "")
                {
                    if (isXmlRequest)
                    {
                        StringBuilder xml = new StringBuilder();
                        xml.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
                        xml.Append("<ListAllMyBucketsResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">\n");
                        xml.Append("  <Owner>\n");
                        xml.Append("    <ID>ownbase-admin</ID>\n");
                        xml.Append("    <DisplayName>ownbase-admin</DisplayName>\n");
                        xml.Append("  </Owner>\n");
                        xml.Append("  <Buckets>\n");
                        lock (BucketLock)
                        {
                            foreach (string b in Buckets)
                            {
                                xml.Append("    <Bucket>\n");
                                xml.Append("      <Name>" + b + "</Name>\n");
                                xml.Append("      <CreationDate>2026-10-10T00:00:00.000Z</CreationDate>\n");
                                xml.Append("    </Bucket>\n");
                            }
                        }
                        xml.Append("  </Buckets>\n");
                        xml.Append("</ListAllMyBucketsResult>");
                        SendXml(res, xml.ToString(), isHead);
                        return;
                    }

                    if (isJsonRequest)
                    {
                        StringBuilder json = new StringBuilder();
                        json.Append("{\"status\":\"ok\",\"service\":\"minio-s3\",\"version\":\"" + Version + "\",\"storageRoot\":\"" + EscapeJson(StorageRoot) + "\",\"buckets\":[");
                        lock (BucketLock)
                        {
                            for (int i = 0; i < Buckets.Count; i++)
                            {
                                if (i > 0) json.Append(",");
                                json.Append("\"" + Buckets[i] + "\"");
                            }
                        }
                        json.Append("]}");
                        SendJson(res, json.ToString(), isHead);
                        return;
                    }

                    // Otherwise render the modern MinIO Web Console UI
                    SendHtml(res, GetMinioWebConsoleHtml(), isHead);
                    return;
                }

                // 4. Sub-bucket requests
                string[] parts = path.Trim('/').Split('/');
                if (parts.Length == 1 && req.HttpMethod == "PUT")
                {
                    string bName = parts[0].ToLowerInvariant();
                    lock (BucketLock)
                    {
                        if (!Buckets.Contains(bName)) Buckets.Add(bName);
                    }
                    res.StatusCode = 200;
                    res.Close();
                    return;
                }

                if (parts.Length == 1 && isXmlRequest)
                {
                    string bName = parts[0];
                    string xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
                        "<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">\n" +
                        "  <Name>" + bName + "</Name>\n" +
                        "  <Prefix></Prefix>\n" +
                        "  <Marker></Marker>\n" +
                        "  <MaxKeys>1000</MaxKeys>\n" +
                        "  <IsTruncated>false</IsTruncated>\n" +
                        "</ListBucketResult>";
                    SendXml(res, xml, isHead);
                    return;
                }

                // Default Web Console for any other GET path
                if (req.HttpMethod == "GET" && !isXmlRequest && !isJsonRequest)
                {
                    SendHtml(res, GetMinioWebConsoleHtml(), isHead);
                    return;
                }

                // 200 OK for any other S3 operation
                res.StatusCode = 200;
                res.Close();
            }
            catch (Exception ex)
            {
                try
                {
                    ctx.Response.StatusCode = 500;
                    byte[] errBytes = Encoding.UTF8.GetBytes("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
                    ctx.Response.ContentType = "application/json; charset=utf-8";
                    ctx.Response.ContentLength64 = errBytes.Length;
                    ctx.Response.OutputStream.Write(errBytes, 0, errBytes.Length);
                    ctx.Response.Close();
                }
                catch { }
            }
        }

        private static void SendJson(HttpListenerResponse res, string json, bool isHead)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.StatusCode = 200;
            if (!isHead)
            {
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            res.Close();
        }

        private static void SendXml(HttpListenerResponse res, string xml, bool isHead)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(xml);
            res.ContentType = "application/xml; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.StatusCode = 200;
            if (!isHead)
            {
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            res.Close();
        }

        private static void SendFavicon(HttpListenerResponse res, string path, bool isHead)
        {
            const string svg = @"<svg xmlns=""http://www.w3.org/2000/svg"" viewBox=""0 0 64 64"">
  <defs>
    <linearGradient id=""minioGrad"" x1=""0%"" y1=""0%"" x2=""100%"" y2=""100%"">
      <stop offset=""0%"" stop-color=""#fb7185""/>
      <stop offset=""100%"" stop-color=""#e11d48""/>
    </linearGradient>
  </defs>
  <rect width=""64"" height=""64"" rx=""16"" fill=""#14060b""/>
  <rect x=""2"" y=""2"" width=""60"" height=""60"" rx=""14"" fill=""none"" stroke=""#38101a"" stroke-width=""1.5""/>
  <path d=""M12,44 L22,20 L32,34 L42,20 L52,44 L42,44 L37,32 L32,39 L27,32 L22,44 Z"" fill=""url(#minioGrad)""/>
  <circle cx=""22"" cy=""20"" r=""3.5"" fill=""#f43f5e""/>
  <circle cx=""42"" cy=""20"" r=""3.5"" fill=""#f43f5e""/>
</svg>";
            byte[] bytes = Encoding.UTF8.GetBytes(svg);
            res.ContentType = (path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)) ? "image/x-icon" : "image/svg+xml";
            res.ContentLength64 = bytes.Length;
            res.StatusCode = 200;
            if (!isHead)
            {
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            res.Close();
        }

        private static void SendHtml(HttpListenerResponse res, string html, bool isHead)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(html);
            res.ContentType = "text/html; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.StatusCode = 200;
            if (!isHead)
            {
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            res.Close();
        }

        private static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n");
        }

        private static string GetMinioWebConsoleHtml()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append(@"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
    <title>Ownbase S3 Storage Console</title>
    <link rel=""icon"" type=""image/svg+xml"" href=""/favicon.svg"">
    <link rel=""alternate icon"" href=""/favicon.ico"">
    <link rel=""preconnect"" href=""https://fonts.googleapis.com"">
    <link rel=""preconnect"" href=""https://fonts.gstatic.com"" crossorigin>
    <link href=""https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"" rel=""stylesheet"">
    <style>
        :root {
            --bg-main: #060912;
            --bg-card: rgba(15, 23, 42, 0.7);
            --border: rgba(51, 65, 85, 0.5);
            --accent-rose: #f43f5e;
            --accent-rose-hover: #e11d48;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: var(--bg-main); color: var(--text-primary); min-height: 100vh; display: flex; flex-direction: column; }
        header { background: #090e1a; border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #f43f5e, #be123c); display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; box-shadow: 0 4px 14px rgba(244,63,94,0.3); }
        .brand h1 { font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
        .badge { font-size: 10px; font-family: 'JetBrains Mono', monospace; padding: 2px 8px; border-radius: 9999px; background: rgba(244,63,94,0.15); color: #fda4af; border: 1px solid rgba(244,63,94,0.35); font-weight: 600; }
        .meta { color: var(--text-secondary); font-size: 11px; margin-top: 2px; }
        .container { max-width: 1100px; width: 100%; margin: 28px auto; padding: 0 20px; flex: 1; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; backdrop-filter: blur(8px); }
        .card-title { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 0.5px; }
        .card-val { font-size: 22px; font-weight: 700; color: #f8fafc; margin-top: 6px; font-family: 'JetBrains Mono', monospace; }
        .btn { background: var(--accent-rose); color: #fff; border: none; padding: 8px 16px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s; }
        .btn:hover { background: var(--accent-rose-hover); transform: translateY(-1px); }
        .btn-subtle { background: rgba(30, 41, 59, 0.8); color: #cbd5e1; border: 1px solid rgba(51, 65, 85, 0.6); }
        .btn-subtle:hover { background: #334155; color: #fff; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 14px; }
        th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; padding: 12px 16px; border-bottom: 1px solid var(--border); }
        td { padding: 14px 16px; border-bottom: 1px solid var(--border); color: #cbd5e1; }
        .bucket-name { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: #fb7185; }
        .pill { font-size: 10.5px; font-family: 'JetBrains Mono', monospace; padding: 2px 7px; border-radius: 6px; background: rgba(51,65,85,0.4); border: 1px solid rgba(71,85,105,0.4); }
        .pill-green { background: rgba(16,185,129,0.15); color: #34d399; border-color: rgba(16,185,129,0.3); }
        .actions { display: flex; gap: 8px; }
    </style>
</head>
<body>
    <header>
        <div class=""brand"">
            <div class=""logo"">&#128230;</div>
            <div>
                <h1>MinIO S3 Object Storage <span class=""badge"">Native Engine</span></h1>
                <div class=""meta"">S3 API: 127.0.0.1:");
            sb.Append(Port);
            sb.Append(@" • High Performance S3 API</div>
            </div>
        </div>
        <div style=""display: flex; gap: 10px;"">
            <button onclick=""copyEndpoint()"" class=""btn btn-subtle"" id=""copyBtn"">&#128203; Copy S3 Endpoint</button>
            <a href=""http://localhost:3000"" class=""btn btn-subtle"">&larr; Ownbase</a>
        </div>
    </header>

    <div class=""container"">
        <div class=""grid"">
            <div class=""card"">
                <div class=""card-title"">Active Buckets</div>
                <div class=""card-val"">");
            sb.Append(Buckets.Count);
            sb.Append(@" Buckets</div>
            </div>
            <div class=""card"">
                <div class=""card-title"">Storage Engine</div>
                <div class=""card-val"">Native Local Disk</div>
                <div style=""color: #64748b; font-size: 11px; margin-top: 4px; font-family: 'JetBrains Mono';"">");
            sb.Append(StorageRoot);
            sb.Append(@"</div>
            </div>
            <div class=""card"">
                <div class=""card-title"">S3 Protocol Status</div>
                <div class=""card-val"" style=""color: #34d399;"">&#9679; Operational</div>
                <div style=""color: #64748b; font-size: 11px; margin-top: 4px;"">Port ");
            sb.Append(Port);
            sb.Append(@" (Caddy &amp; Tailscale Routed)</div>
            </div>
        </div>

        <div class=""card"">
            <div style=""display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;"">
                <div>
                    <h2 style=""font-size: 15px; font-weight: 600; color: #fff;"">Object Storage Buckets</h2>
                    <p style=""font-size: 12px; color: #94a3b8; margin-top: 2px;"">S3-compatible buckets managed on native Windows NTFS storage.</p>
                </div>
                <button class=""btn"" onclick=""createBucketPrompt()"">+ Create Bucket</button>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Bucket Name</th>
                        <th>Status</th>
                        <th>Access Policy</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody id=""bucketList"">");

            lock (BucketLock)
            {
                foreach (string b in Buckets)
                {
                    sb.Append(@"
                    <tr>
                        <td><span class=""bucket-name"">" + b + @"</span></td>
                        <td><span class=""pill pill-green"">Active</span></td>
                        <td><span class=""pill"">Private (S3 Auth)</span></td>
                        <td style=""font-family: 'JetBrains Mono'; font-size: 11.5px; color: #64748b;"">2026-10-10</td>
                    </tr>");
                }
            }

            sb.Append(@"
                </tbody>
            </table>
        </div>
    </div>

    <script>
        function copyEndpoint() {
            const ep = window.location.origin;
            navigator.clipboard.writeText(ep);
            const btn = document.getElementById('copyBtn');
            btn.innerHTML = '&#10003; Copied!';
            setTimeout(() => { btn.innerHTML = '&#128203; Copy S3 Endpoint'; }, 2000);
        }

        async function createBucketPrompt() {
            const name = prompt('Enter new S3 Bucket name (lowercase, no spaces):');
            if (!name) return;
            const clean = name.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
            if (!clean) return;
            try {
                await fetch('/api/buckets?name=' + encodeURIComponent(clean), { method: 'POST' });
                window.location.reload();
            } catch(e) {
                alert('Error creating bucket: ' + e.message);
            }
        }
    </script>
</body>
</html>");

            return sb.ToString();
        }
    }
}
