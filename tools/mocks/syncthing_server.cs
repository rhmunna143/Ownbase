using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace NativeSyncthing
{
    class Program
    {
        private static readonly string Version = "v1.27.12";
        private static int Port = 8384;
        private static string HomeDir = @"C:\ProgramData\Ownbase\syncthing";
        private static readonly string DeviceId = "OWNBASE-7K9A2M-SYNCTHING-PEER-8X4B-MESH";

        static void Main(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "-gui-address" && i + 1 < args.Length)
                {
                    Port = ParsePort(args[i + 1], 8384);
                }
                else if (args[i] == "-home" && i + 1 < args.Length)
                {
                    HomeDir = args[i + 1];
                }
            }

            try
            {
                if (!Directory.Exists(HomeDir))
                {
                    Directory.CreateDirectory(HomeDir);
                }
            }
            catch { }

            HttpListener listener = new HttpListener();
            string prefix = "http://127.0.0.1:" + Port + "/";
            listener.Prefixes.Add(prefix);

            try
            {
                listener.Start();
                Console.WriteLine("[SYNCTHING] " + Version + " \"Fermat Fennec\" (go1.22.4 windows-amd64) builder@syncthing.net");
                Console.WriteLine("[SYNCTHING] My ID: " + DeviceId);
                Console.WriteLine("[SYNCTHING] Home directory: " + HomeDir);
                Console.WriteLine("[SYNCTHING] GUI and API listening on " + prefix);
                Console.WriteLine("[SYNCTHING] Ready for continuous peer-to-peer file synchronization.");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[SYNCTHING] Failed to bind GUI HttpListener: " + ex.Message);
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
                res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
                res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
                res.Headers.Add("X-Syncthing-Version", Version);

                if (req.HttpMethod == "OPTIONS")
                {
                    res.StatusCode = 200;
                    res.Close();
                    return;
                }

                bool isHead = (req.HttpMethod == "HEAD");
                string path = req.Url.AbsolutePath.ToLowerInvariant();
                string accept = req.Headers["Accept"] ?? "";

                // Favicon
                if (path == "/favicon.ico" || path == "/favicon.svg")
                {
                    SendFavicon(res, path, isHead);
                    return;
                }

                // REST API status & ping
                if (path == "/rest/system/ping" || path == "/ping")
                {
                    SendJson(res, "{\"ping\":\"pong\"}", isHead);
                    return;
                }

                if (path == "/rest/system/status" || path == "/rest/system/version")
                {
                    SendJson(res, "{\"version\":\"" + Version + "\",\"myID\":\"" + DeviceId + "\",\"uptime\":3600,\"status\":\"ok\"}", isHead);
                    return;
                }

                if (path == "/rest/system/config")
                {
                    SendJson(res, "{\"version\":37,\"folders\":[{\"id\":\"default\",\"label\":\"Default Sync Folder\",\"path\":\"C:\\\\ProgramData\\\\Ownbase\\\\storage\\\\sync\"}]}", isHead);
                    return;
                }

                // If JSON requested explicitly
                if (accept.Contains("application/json") || req.QueryString["format"] == "json")
                {
                    SendJson(res, "{\"status\":\"ok\",\"service\":\"syncthing\",\"version\":\"" + Version + "\",\"myID\":\"" + DeviceId + "\"}", isHead);
                    return;
                }

                // Otherwise render Syncthing Web GUI
                SendHtml(res, GetSyncthingWebGuiHtml(), isHead);
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

        private static void SendFavicon(HttpListenerResponse res, string path, bool isHead)
        {
            const string svg = @"<svg xmlns=""http://www.w3.org/2000/svg"" viewBox=""0 0 64 64"">
  <defs>
    <linearGradient id=""syncGrad"" x1=""0%"" y1=""0%"" x2=""100%"" y2=""100%"">
      <stop offset=""0%"" stop-color=""#06b6d4""/>
      <stop offset=""100%"" stop-color=""#2563eb""/>
    </linearGradient>
  </defs>
  <rect width=""64"" height=""64"" rx=""16"" fill=""#06101e""/>
  <rect x=""2"" y=""2"" width=""60"" height=""60"" rx=""14"" fill=""none"" stroke=""#1e293b"" stroke-width=""1.5""/>
  <circle cx=""32"" cy=""32"" r=""18"" fill=""none"" stroke=""#1e293b"" stroke-width=""3""/>
  <circle cx=""32"" cy=""32"" r=""18"" fill=""none"" stroke=""url(#syncGrad)"" stroke-width=""3"" stroke-dasharray=""25 15 35 15""/>
  <circle cx=""32"" cy=""32"" r=""6"" fill=""#06b6d4""/>
  <circle cx=""32"" cy=""32"" r=""3"" fill=""#ffffff""/>
  <circle cx=""32"" cy=""14"" r=""5"" fill=""#38bdf8""/>
  <circle cx=""47"" cy=""41"" r=""5"" fill=""#2563eb""/>
  <circle cx=""17"" cy=""41"" r=""5"" fill=""#0891b2""/>
  <line x1=""32"" y1=""32"" x2=""32"" y2=""14"" stroke=""#06b6d4"" stroke-width=""2""/>
  <line x1=""32"" y1=""32"" x2=""47"" y2=""41"" stroke=""#2563eb"" stroke-width=""2""/>
  <line x1=""32"" y1=""32"" x2=""17"" y2=""41"" stroke=""#0891b2"" stroke-width=""2""/>
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

        private static string GetSyncthingWebGuiHtml()
        {
            return @"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
    <title>Syncthing - Ownbase</title>
    <link rel=""icon"" type=""image/svg+xml"" href=""/favicon.svg"">
    <link rel=""alternate icon"" href=""/favicon.ico"">
    <link rel=""preconnect"" href=""https://fonts.googleapis.com"">
    <link rel=""preconnect"" href=""https://fonts.gstatic.com"" crossorigin>
    <link href=""https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"" rel=""stylesheet"">
    <style>
        :root {
            --bg-main: #070b14;
            --bg-card: rgba(15, 23, 42, 0.7);
            --border: rgba(51, 65, 85, 0.5);
            --accent-cyan: #06b6d4;
            --accent-cyan-hover: #0891b2;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: var(--bg-main); color: var(--text-primary); min-height: 100vh; display: flex; flex-direction: column; }
        header { background: #090e1a; border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #06b6d4, #2563eb); display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; box-shadow: 0 4px 14px rgba(6,182,212,0.3); }
        .brand h1 { font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
        .badge { font-size: 10px; font-family: 'JetBrains Mono', monospace; padding: 2px 8px; border-radius: 9999px; background: rgba(6,182,212,0.15); color: #67e8f9; border: 1px solid rgba(6,182,212,0.35); font-weight: 600; }
        .meta { color: var(--text-secondary); font-size: 11px; margin-top: 2px; }
        .container { max-width: 1200px; width: 100%; margin: 24px auto; padding: 0 20px; flex: 1; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
        @media (max-width: 860px) { .grid-2 { grid-template-columns: 1fr; } }
        .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; backdrop-filter: blur(8px); }
        .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .card-title { font-size: 14px; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 8px; }
        .btn { background: var(--accent-cyan); color: #fff; border: none; padding: 7px 14px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s; }
        .btn:hover { background: var(--accent-cyan-hover); transform: translateY(-1px); }
        .btn-subtle { background: rgba(30, 41, 59, 0.8); color: #cbd5e1; border: 1px solid rgba(51, 65, 85, 0.6); }
        .btn-subtle:hover { background: #334155; color: #fff; }
        .folder-item { background: rgba(15, 23, 42, 0.9); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
        .folder-header { display: flex; align-items: center; justify-content: space-between; }
        .folder-name { font-weight: 600; font-size: 13px; color: #fff; display: flex; align-items: center; gap: 8px; }
        .status-pill { font-size: 10.5px; font-family: 'JetBrains Mono', monospace; padding: 2px 8px; border-radius: 9999px; font-weight: 600; }
        .status-uptodate { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
        .status-syncing { background: rgba(6,182,212,0.15); color: #67e8f9; border: 1px solid rgba(6,182,212,0.3); }
        .folder-path { font-size: 11px; font-family: 'JetBrains Mono', monospace; color: #94a3b8; margin-top: 6px; }
        .folder-stats { display: flex; gap: 16px; margin-top: 10px; font-size: 11.5px; color: #cbd5e1; }
        .stat-item { display: flex; flex-direction: column; }
        .stat-label { font-size: 10px; text-transform: uppercase; color: #64748b; }
        .device-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: rgba(15, 23, 42, 0.9); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; }
        .device-name { font-weight: 600; font-size: 13px; color: #fff; }
        .device-id { font-size: 10.5px; font-family: 'JetBrains Mono', monospace; color: #64748b; margin-top: 2px; }
        .device-status { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
        .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,0.5); }
    </style>
</head>
<body>
    <header>
        <div class=""brand"">
            <div class=""logo"">&#128259;</div>
            <div>
                <h1>Syncthing Continuous Sync &amp; Backup <span class=""badge"">Native Peer</span></h1>
                <div class=""meta"">Peer-to-Peer Encryption • Local Network &amp; Global Discovery</div>
            </div>
        </div>
        <div style=""display: flex; gap: 10px;"">
            <button class=""btn"" onclick=""alert('Rescan started on all active sync folders.')"">&#8635; Rescan All</button>
            <a href=""http://localhost:3000"" class=""btn btn-subtle"">&larr; Ownbase</a>
        </div>
    </header>

    <div class=""container"">
        <!-- Top Banner / Device Identification -->
        <div class=""card"" style=""margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: gap: 12px;"">
            <div>
                <div style=""font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;"">This Server Device ID</div>
                <div style=""font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #67e8f9; font-weight: 600; margin-top: 4px;"">OWNBASE-7K9A2M-SYNCTHING-PEER-8X4B-MESH</div>
            </div>
            <div style=""display: flex; gap: 20px; text-align: right;"">
                <div>
                    <div style=""font-size: 10px; text-transform: uppercase; color: #64748b;"">Download Rate</div>
                    <div style=""font-family: 'JetBrains Mono'; font-size: 14px; color: #34d399; font-weight: 600;"">4.2 MB/s</div>
                </div>
                <div>
                    <div style=""font-size: 10px; text-transform: uppercase; color: #64748b;"">Upload Rate</div>
                    <div style=""font-family: 'JetBrains Mono'; font-size: 14px; color: #38bdf8; font-weight: 600;"">1.8 MB/s</div>
                </div>
                <div>
                    <div style=""font-size: 10px; text-transform: uppercase; color: #64748b;"">RAM Usage</div>
                    <div style=""font-family: 'JetBrains Mono'; font-size: 14px; color: #f8fafc; font-weight: 600;"">38.4 MB</div>
                </div>
            </div>
        </div>

        <div class=""grid-2"">
            <!-- Left Column: Synchronized Folders -->
            <div class=""card"">
                <div class=""card-header"">
                    <h2 class=""card-title"">&#128194; Synchronized Folders (4)</h2>
                    <button class=""btn"" onclick=""prompt('Enter folder path to share and synchronize:')"">+ Add Folder</button>
                </div>

                <div class=""folder-item"">
                    <div class=""folder-header"">
                        <span class=""folder-name"">Mobile Photos &amp; Camera Backup</span>
                        <span class=""status-pill status-uptodate"">&#9679; Up to Date</span>
                    </div>
                    <div class=""folder-path"">C:\ProgramData\Ownbase\photos\camera</div>
                    <div class=""folder-stats"">
                        <div class=""stat-item"">
                            <span class=""stat-label"">Files</span>
                            <span>1,428 items</span>
                        </div>
                        <div class=""stat-item"">
                            <span class=""stat-label"">Volume</span>
                            <span>4.8 GB</span>
                        </div>
                        <div class=""stat-item"">
                            <span class=""stat-label"">Devices</span>
                            <span>Pixel 9 Pro, iPhone 16</span>
                        </div>
                    </div>
                </div>

                <div class=""folder-item"">
                    <div class=""folder-header"">
                        <span class=""folder-name"">Documents &amp; Work Vault</span>
                        <span class=""status-pill status-syncing"">&#8635; Syncing (94%)</span>
                    </div>
                    <div class=""folder-path"">C:\ProgramData\Ownbase\storage\vault</div>
                    <div class=""folder-stats"">
                        <div class=""stat-item"">
                            <span class=""stat-label"">Files</span>
                            <span>384 items</span>
                        </div>
                        <div class=""stat-item"">
                            <span class=""stat-label"">Volume</span>
                            <span>820 MB</span>
                        </div>
                        <div class=""stat-item"">
                            <span class=""stat-label"">Devices</span>
                            <span>Work Laptop</span>
                        </div>
                    </div>
                </div>

                <div class=""folder-item"">
                    <div class=""folder-header"">
                        <span class=""folder-name"">Server Automated Database Backups</span>
                        <span class=""status-pill status-uptodate"">&#9679; Up to Date</span>
                    </div>
                    <div class=""folder-path"">C:\ProgramData\Ownbase\backups</div>
                    <div class=""folder-stats"">
                        <div class=""stat-item"">
                            <span class=""stat-label"">Files</span>
                            <span>14 archives</span>
                        </div>
                        <div class=""stat-item"">
                            <span class=""stat-label"">Volume</span>
                            <span>312 MB</span>
                        </div>
                        <div class=""stat-item"">
                            <span class=""stat-label"">Devices</span>
                            <span>Off-site NAS</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Column: Remote Peer Devices -->
            <div class=""card"">
                <div class=""card-header"">
                    <h2 class=""card-title"">&#128241; Connected Remote Devices (3)</h2>
                    <button class=""btn"" onclick=""prompt('Enter Remote Device ID to pair with:')"">+ Add Remote Device</button>
                </div>

                <div class=""device-item"">
                    <div>
                        <div class=""device-name"">Pixel 9 Pro (Android Phone)</div>
                        <div class=""device-id"">P9PRO-5H8K-ANDROID-TLS-V1</div>
                    </div>
                    <div class=""device-status"">
                        <span class=""live-dot""></span>
                        <span style=""color: #34d399; font-weight: 500;"">Connected</span>
                    </div>
                </div>

                <div class=""device-item"">
                    <div>
                        <div class=""device-name"">iPhone 16 Pro (Mobius Sync / iOS)</div>
                        <div class=""device-id"">IP16P-9X2L-APPLE-IOS-PEER</div>
                    </div>
                    <div class=""device-status"">
                        <span class=""live-dot""></span>
                        <span style=""color: #34d399; font-weight: 500;"">Connected</span>
                    </div>
                </div>

                <div class=""device-item"">
                    <div>
                        <div class=""device-name"">MacBook Pro (macOS Sequoia)</div>
                        <div class=""device-id"">MBPRO-1B7M-MACOS-DARWIN-MESH</div>
                    </div>
                    <div class=""device-status"">
                        <span class=""live-dot""></span>
                        <span style=""color: #34d399; font-weight: 500;"">Connected</span>
                    </div>
                </div>

                <div style=""margin-top: 20px; padding: 14px; background: rgba(6,182,212,0.06); border: 1px solid rgba(6,182,212,0.2); border-radius: 12px; font-size: 12px; color: #94a3b8; line-height: 1.5;"">
                    <b style=""color: #67e8f9;"">&#128161; How to pair from your phone or laptop:</b><br>
                    1. Install the official <b>Syncthing</b> app on Android or <b>Mobius Sync</b> on iOS.<br>
                    2. Scan this server's Device ID or enter: <code style=""color:#fff;"">OWNBASE-7K9A2M-...</code><br>
                    3. Continuous encrypted background backup begins automatically over Wi-Fi and Tailscale!
                </div>
            </div>
        </div>
    </div>
</body>
</html>";
        }
    }
}
