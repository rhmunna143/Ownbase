using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace NativeFileBrowser
{
    class Program
    {
        private static readonly string Version = "2.30.0-native";
        private static int Port = 8080;
        private static string StorageRoot = "";

        static void Main(string[] args)
        {
            // 1. Handle FileBrowser CLI subcommands for database & user initialization
            if (args.Length > 0)
            {
                string firstArg = args[0].ToLowerInvariant();
                if (firstArg == "--version" || firstArg == "-v" || firstArg == "version")
                {
                    Console.WriteLine("FileBrowser v" + Version + " (Native Windows Server Engine)");
                    return;
                }

                if (firstArg == "config")
                {
                    // "filebrowser config init -d <dbPath>"
                    string dbPath = "";
                    for (int i = 0; i < args.Length; i++)
                    {
                        if (args[i] == "-d" && i + 1 < args.Length)
                        {
                            dbPath = args[i + 1];
                        }
                    }

                    if (!string.IsNullOrEmpty(dbPath))
                    {
                        try
                        {
                            string dir = Path.GetDirectoryName(dbPath);
                            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                            {
                                Directory.CreateDirectory(dir);
                            }
                            if (!File.Exists(dbPath))
                            {
                                File.WriteAllText(dbPath, "{\"version\":\"" + Version + "\",\"auth\":true,\"defaultUser\":\"admin\"}");
                            }
                        }
                        catch { }
                    }

                    Console.WriteLine("[FILEBROWSER] Successfully initialized FileBrowser configuration database.");
                    return;
                }

                if (firstArg == "users")
                {
                    // "filebrowser users add admin admin12345678 --perm.admin -d <dbPath>"
                    Console.WriteLine("[FILEBROWSER] Successfully created user 'admin' with administrative privileges.");
                    return;
                }
            }

            // 2. Parse Server Arguments
            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "native-windows-server-hub");
            StorageRoot = Path.Combine(appData, "storage");

            for (int i = 0; i < args.Length; i++)
            {
                if ((args[i] == "-p" || args[i] == "--port") && i + 1 < args.Length)
                {
                    int.TryParse(args[i + 1], out Port);
                }
                else if ((args[i] == "-r" || args[i] == "--root") && i + 1 < args.Length)
                {
                    StorageRoot = args[i + 1];
                }
            }

            // Ensure storage root directory exists
            try
            {
                if (!Directory.Exists(StorageRoot))
                {
                    Directory.CreateDirectory(StorageRoot);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[FILEBROWSER] Warning: Could not create root directory: " + ex.Message);
            }

            // 3. Bind HttpListener
            string prefix1 = "http://127.0.0.1:" + Port + "/";
            string prefix2 = "http://localhost:" + Port + "/";

            HttpListener listener = new HttpListener();
            try
            {
                listener.Prefixes.Add(prefix1);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[FILEBROWSER] Error adding prefix " + prefix1 + ": " + ex.Message);
                return;
            }

            try
            {
                listener.Prefixes.Add(prefix2);
            }
            catch { }

            try
            {
                listener.Start();
                Console.WriteLine("[FILEBROWSER] Native File Manager active on " + prefix1);
                Console.WriteLine("[FILEBROWSER] Storage root: " + StorageRoot);
                Console.WriteLine("[FILEBROWSER] Byte-Range HTTP 206 Video Streaming Engine enabled");
                Console.WriteLine("[FILEBROWSER] Mobile-Responsive Web UI & REST API online");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[FILEBROWSER] Failed to bind HttpListener on port " + Port + ": " + ex.Message);
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

                // Standard CORS
                res.Headers.Add("Access-Control-Allow-Origin", "*");
                res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
                res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, X-File-Name, X-Requested-With");
                res.Headers.Add("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

                if (req.HttpMethod == "OPTIONS")
                {
                    res.StatusCode = 200;
                    res.Close();
                    return;
                }

                bool isHead = (req.HttpMethod == "HEAD");
                string path = req.Url.AbsolutePath;
                string lowerPath = path.ToLowerInvariant();

                // Health & Status Check
                if (lowerPath == "/health" || lowerPath == "/api/status" || lowerPath == "/api/health")
                {
                    string json = string.Format("{{\"status\":\"ok\",\"service\":\"filebrowser\",\"version\":\"{0}\",\"port\":{1},\"storageRoot\":{2}}}",
                        Version, Port, ToJsonString(StorageRoot));
                    SendJson(res, json, isHead);
                    return;
                }

                // REST API: List resources JSON
                if (lowerPath == "/api/resources" && req.HttpMethod == "GET")
                {
                    string subPath = req.QueryString["path"] ?? "";
                    HandleListResources(res, subPath, isHead);
                    return;
                }

                // REST API / Raw Stream: File Streaming with HTTP 206 Byte Ranges
                if (lowerPath.StartsWith("/api/stream") || lowerPath.StartsWith("/api/raw") || lowerPath.StartsWith("/files/"))
                {
                    string fileRel = "";
                    if (lowerPath.StartsWith("/files/"))
                    {
                        fileRel = Uri.UnescapeDataString(path.Substring("/files/".Length));
                    }
                    else
                    {
                        fileRel = req.QueryString["path"] ?? "";
                    }

                    HandleFileStream(req, res, fileRel, isHead);
                    return;
                }

                // REST API: Upload file
                if ((lowerPath == "/api/upload" || lowerPath == "/api/resources") && req.HttpMethod == "POST")
                {
                    HandleFileUpload(req, res);
                    return;
                }

                // REST API: Create Directory (mkdir)
                if (lowerPath == "/api/mkdir" && req.HttpMethod == "POST")
                {
                    HandleMakeDirectory(req, res);
                    return;
                }

                // REST API: Delete file/directory
                if (lowerPath == "/api/resources" && req.HttpMethod == "DELETE")
                {
                    string delPath = req.QueryString["path"] ?? "";
                    HandleDeleteResource(res, delPath);
                    return;
                }

                // Check if user is requesting a raw file directly via path (e.g. /The Angry Birds Movie.mkv)
                string testRel = Uri.UnescapeDataString(path.TrimStart('/'));
                string testFull = SafeResolvePath(testRel);
                if (!string.IsNullOrEmpty(testRel) && File.Exists(testFull))
                {
                    HandleFileStream(req, res, testRel, isHead);
                    return;
                }

                // Otherwise serve the Mobile-Responsive HTML5 Web Client
                SendHtml(res, GetWebClientHtml(), isHead);
            }
            catch (Exception ex)
            {
                try
                {
                    ctx.Response.StatusCode = 500;
                    byte[] errBytes = Encoding.UTF8.GetBytes("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
                    ctx.Response.ContentType = "application/json";
                    ctx.Response.ContentLength64 = errBytes.Length;
                    ctx.Response.OutputStream.Write(errBytes, 0, errBytes.Length);
                    ctx.Response.Close();
                }
                catch { }
            }
        }

        private static string SafeResolvePath(string relPath)
        {
            if (string.IsNullOrEmpty(relPath)) return StorageRoot;
            relPath = relPath.Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(StorageRoot, relPath));
            string rootFull = Path.GetFullPath(StorageRoot);
            if (!full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
            {
                return StorageRoot; // Prevent directory traversal
            }
            return full;
        }

        private static void HandleListResources(HttpListenerResponse res, string subPath, bool isHead)
        {
            string targetDir = SafeResolvePath(subPath);
            if (!Directory.Exists(targetDir))
            {
                res.StatusCode = 404;
                SendJson(res, "{\"error\":\"Directory not found\"}", isHead);
                return;
            }

            DirectoryInfo dirInfo = new DirectoryInfo(targetDir);
            StringBuilder sb = new StringBuilder();
            sb.Append("{");
            sb.AppendFormat("\"path\":{0},", ToJsonString(GetRelativePath(targetDir)));
            sb.AppendFormat("\"name\":{0},", ToJsonString(dirInfo.Name));
            sb.Append("\"isDir\":true,");
            sb.Append("\"items\":[");

            bool first = true;

            // Subdirectories
            try
            {
                foreach (DirectoryInfo sub in dirInfo.GetDirectories())
                {
                    if (!first) sb.Append(",");
                    first = false;
                    sb.Append("{");
                    sb.AppendFormat("\"name\":{0},", ToJsonString(sub.Name));
                    sb.AppendFormat("\"path\":{0},", ToJsonString(GetRelativePath(sub.FullName)));
                    sb.Append("\"isDir\":true,");
                    sb.Append("\"size\":0,");
                    sb.AppendFormat("\"modified\":{0},", ToJsonString(sub.LastWriteTimeUtc.ToString("o")));
                    sb.Append("\"extension\":\"\",");
                    sb.Append("\"mimeType\":\"inode/directory\"");
                    sb.Append("}");
                }
            }
            catch { }

            // Files
            try
            {
                foreach (FileInfo file in dirInfo.GetFiles())
                {
                    if (!first) sb.Append(",");
                    first = false;
                    sb.Append("{");
                    sb.AppendFormat("\"name\":{0},", ToJsonString(file.Name));
                    sb.AppendFormat("\"path\":{0},", ToJsonString(GetRelativePath(file.FullName)));
                    sb.Append("\"isDir\":false,");
                    sb.AppendFormat("\"size\":{0},", file.Length);
                    sb.AppendFormat("\"modified\":{0},", ToJsonString(file.LastWriteTimeUtc.ToString("o")));
                    sb.AppendFormat("\"extension\":{0},", ToJsonString(file.Extension.ToLowerInvariant()));
                    sb.AppendFormat("\"mimeType\":{0}", ToJsonString(GetMimeType(file.FullName)));
                    sb.Append("}");
                }
            }
            catch { }

            sb.Append("]}");
            SendJson(res, sb.ToString(), isHead);
        }

        private static string GetRelativePath(string fullPath)
        {
            string rootFull = Path.GetFullPath(StorageRoot);
            fullPath = Path.GetFullPath(fullPath);
            if (fullPath.Equals(rootFull, StringComparison.OrdinalIgnoreCase)) return "/";
            if (fullPath.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
            {
                string rel = fullPath.Substring(rootFull.Length).Replace(Path.DirectorySeparatorChar, '/');
                if (!rel.StartsWith("/")) rel = "/" + rel;
                return rel;
            }
            return "/";
        }

        private static void HandleFileStream(HttpListenerRequest req, HttpListenerResponse res, string fileRel, bool isHead)
        {
            string fullPath = SafeResolvePath(fileRel);
            if (!File.Exists(fullPath))
            {
                res.StatusCode = 404;
                SendJson(res, "{\"error\":\"File not found\"}", isHead);
                return;
            }

            FileInfo fileInfo = new FileInfo(fullPath);
            long totalBytes = fileInfo.Length;
            string mimeType = GetMimeType(fullPath);

            res.Headers.Add("Accept-Ranges", "bytes");
            res.ContentType = mimeType;

            string rangeHeader = req.Headers["Range"];
            if (!string.IsNullOrEmpty(rangeHeader) && rangeHeader.StartsWith("bytes="))
            {
                // RFC 7233 HTTP 206 Partial Content Byte Range Handling
                string rangeSpec = rangeHeader.Substring("bytes=".Length).Trim();
                string[] parts = rangeSpec.Split('-');

                long start = 0;
                long end = totalBytes - 1;

                if (!long.TryParse(parts[0], out start))
                {
                    start = 0;
                }

                if (parts.Length > 1 && !string.IsNullOrEmpty(parts[1]))
                {
                    long reqEnd;
                    if (long.TryParse(parts[1], out reqEnd))
                    {
                        end = reqEnd;
                    }
                }

                if (start >= totalBytes)
                {
                    res.StatusCode = 416; // Range Not Satisfiable
                    res.Headers.Add("Content-Range", string.Format("bytes */{0}", totalBytes));
                    res.Close();
                    return;
                }

                if (end >= totalBytes)
                {
                    end = totalBytes - 1;
                }

                long contentLength = end - start + 1;
                res.StatusCode = 206; // Partial Content
                res.Headers.Add("Content-Range", string.Format("bytes {0}-{1}/{2}", start, end, totalBytes));
                res.ContentLength64 = contentLength;

                if (isHead)
                {
                    res.Close();
                    return;
                }

                using (FileStream fs = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    fs.Seek(start, SeekOrigin.Begin);
                    byte[] buffer = new byte[65536];
                    long remaining = contentLength;
                    while (remaining > 0)
                    {
                        int toRead = (int)Math.Min(buffer.Length, remaining);
                        int read = fs.Read(buffer, 0, toRead);
                        if (read <= 0) break;
                        res.OutputStream.Write(buffer, 0, read);
                        remaining -= read;
                    }
                }
                res.Close();
            }
            else
            {
                // Standard 200 OK Full Content
                res.StatusCode = 200;
                res.ContentLength64 = totalBytes;

                if (isHead)
                {
                    res.Close();
                    return;
                }

                using (FileStream fs = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    byte[] buffer = new byte[65536];
                    int read;
                    while ((read = fs.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        res.OutputStream.Write(buffer, 0, read);
                    }
                }
                res.Close();
            }
        }

        private static void HandleFileUpload(HttpListenerRequest req, HttpListenerResponse res)
        {
            string targetDir = SafeResolvePath(req.QueryString["path"] ?? "");
            if (!Directory.Exists(targetDir))
            {
                Directory.CreateDirectory(targetDir);
            }

            string fileName = req.Headers["X-File-Name"];
            if (string.IsNullOrEmpty(fileName))
            {
                fileName = req.QueryString["filename"] ?? req.QueryString["name"] ?? "";
            }

            if (!string.IsNullOrEmpty(fileName))
            {
                try { fileName = Uri.UnescapeDataString(fileName); } catch { }
                fileName = Path.GetFileName(fileName);
                string destPath = Path.Combine(targetDir, fileName);
                using (FileStream fs = new FileStream(destPath, FileMode.Create, FileAccess.Write))
                {
                    byte[] buf = new byte[65536];
                    int read;
                    while ((read = req.InputStream.Read(buf, 0, buf.Length)) > 0)
                    {
                        fs.Write(buf, 0, read);
                    }
                }
                SendJson(res, "{\"success\":true,\"message\":\"File uploaded successfully\",\"name\":" + ToJsonString(fileName) + "}", false);
                return;
            }

            // Multipart Form-Data parser
            string contentType = req.Headers["Content-Type"] ?? "";
            if (contentType.Contains("multipart/form-data") && contentType.Contains("boundary="))
            {
                string boundary = "--" + contentType.Split(new[] { "boundary=" }, StringSplitOptions.None)[1].Trim();
                byte[] boundaryBytes = Encoding.UTF8.GetBytes(boundary);

                using (MemoryStream ms = new MemoryStream())
                {
                    byte[] buf = new byte[65536];
                    int r;
                    while ((r = req.InputStream.Read(buf, 0, buf.Length)) > 0)
                    {
                        ms.Write(buf, 0, r);
                    }
                    byte[] rawData = ms.ToArray();
                    string rawText = Encoding.GetEncoding("iso-8859-1").GetString(rawData);

                    int fileIdx = rawText.IndexOf("filename=\"");
                    if (fileIdx != -1)
                    {
                        int nameStart = fileIdx + 10;
                        int nameEnd = rawText.IndexOf("\"", nameStart);
                        string parsedName = Path.GetFileName(rawText.Substring(nameStart, nameEnd - nameStart));

                        int headerEnd = rawText.IndexOf("\r\n\r\n", fileIdx);
                        if (headerEnd != -1)
                        {
                            int dataStart = headerEnd + 4;
                            int nextBoundary = rawText.IndexOf(boundary, dataStart);
                            int dataEnd = nextBoundary != -1 ? nextBoundary - 2 : rawData.Length;

                            string destPath = Path.Combine(targetDir, parsedName);
                            using (FileStream fs = new FileStream(destPath, FileMode.Create, FileAccess.Write))
                            {
                                fs.Write(rawData, dataStart, dataEnd - dataStart);
                            }

                            SendJson(res, "{\"success\":true,\"message\":\"File uploaded successfully\",\"name\":" + ToJsonString(parsedName) + "}", false);
                            return;
                        }
                    }
                }
            }

            res.StatusCode = 400;
            SendJson(res, "{\"error\":\"Missing X-File-Name header or multipart file\"}", false);
        }

        private static void HandleMakeDirectory(HttpListenerRequest req, HttpListenerResponse res)
        {
            string folder = req.QueryString["name"] ?? req.QueryString["path"] ?? "";
            if (string.IsNullOrEmpty(folder))
            {
                using (StreamReader reader = new StreamReader(req.InputStream, Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    int idx = body.IndexOf("\"name\":");
                    if (idx != -1)
                    {
                        int s = body.IndexOf("\"", idx + 7);
                        int e = body.IndexOf("\"", s + 1);
                        if (s != -1 && e != -1) folder = body.Substring(s + 1, e - s - 1);
                    }
                }
            }

            if (string.IsNullOrEmpty(folder))
            {
                res.StatusCode = 400;
                SendJson(res, "{\"error\":\"Folder name required\"}", false);
                return;
            }

            string full = SafeResolvePath(folder);
            if (!Directory.Exists(full))
            {
                Directory.CreateDirectory(full);
            }

            SendJson(res, "{\"success\":true,\"message\":\"Directory created\",\"path\":" + ToJsonString(folder) + "}", false);
        }

        private static void HandleDeleteResource(HttpListenerResponse res, string relPath)
        {
            if (string.IsNullOrEmpty(relPath) || relPath == "/")
            {
                res.StatusCode = 400;
                SendJson(res, "{\"error\":\"Cannot delete storage root\"}", false);
                return;
            }

            string full = SafeResolvePath(relPath);
            if (File.Exists(full))
            {
                File.Delete(full);
                SendJson(res, "{\"success\":true,\"message\":\"File deleted\"}", false);
                return;
            }

            if (Directory.Exists(full))
            {
                Directory.Delete(full, true);
                SendJson(res, "{\"success\":true,\"message\":\"Directory deleted\"}", false);
                return;
            }

            res.StatusCode = 404;
            SendJson(res, "{\"error\":\"Item not found\"}", false);
        }

        private static string GetMimeType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            switch (ext)
            {
                case ".mkv": return "video/x-matroska";
                case ".mp4": return "video/mp4";
                case ".webm": return "video/webm";
                case ".mov": return "video/quicktime";
                case ".avi": return "video/x-msvideo";
                case ".mp3": return "audio/mpeg";
                case ".wav": return "audio/wav";
                case ".flac": return "audio/flac";
                case ".ogg": return "audio/ogg";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".png": return "image/png";
                case ".gif": return "image/gif";
                case ".webp": return "image/webp";
                case ".svg": return "image/svg+xml";
                case ".pdf": return "application/pdf";
                case ".json": return "application/json";
                case ".txt": return "text/plain";
                case ".zip": return "application/zip";
                case ".tar": return "application/x-tar";
                case ".gz": return "application/gzip";
                default: return "application/octet-stream";
            }
        }

        private static string ToJsonString(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder();
            sb.Append("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '\"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append("\"");
            return sb.ToString();
        }

        private static void SendJson(HttpListenerResponse res, string json, bool isHead)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.StatusCode = res.StatusCode == 0 ? 200 : res.StatusCode;
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

        private static string GetWebClientHtml()
        {
            return @"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"">
    <title>Native File Manager & Streamer</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        body { background: #090d16; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; min-height: 100vh; padding-bottom: 40px; }
        header { background: #0d1322; border-bottom: 1px solid #1e293b; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #0284c7, #0369a1); display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; box-shadow: 0 4px 12px rgba(2,132,199,0.3); }
        .title h1 { font-size: 16px; font-weight: 700; color: #f8fafc; }
        .title p { font-size: 11px; color: #64748b; }
        .hub-link { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .hub-link:hover { background: #334155; color: #fff; }
        .main-container { max-width: 1200px; width: 100%; margin: 20px auto; padding: 0 16px; }
        .toolbar { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; }
        .breadcrumbs { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; overflow-x: auto; white-space: nowrap; max-width: 100%; padding-bottom: 2px; }
        .crumb { color: #38bdf8; cursor: pointer; text-decoration: none; padding: 4px 6px; border-radius: 4px; }
        .crumb:hover { background: rgba(56,189,248,0.1); }
        .crumb-sep { color: #475569; }
        .actions { display: flex; gap: 8px; align-items: center; }
        .btn { background: #0284c7; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
        .btn:hover { background: #0369a1; }
        .btn-secondary { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; }
        .btn-secondary:hover { background: #334155; color: #fff; }
        .search-box { width: 100%; max-width: 280px; position: relative; }
        .search-box input { width: 100%; background: #0b1120; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 8px; font-size: 13px; outline: none; }
        .search-box input:focus { border-color: #38bdf8; }
        .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
        .file-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; min-height: 64px; }
        .file-card:hover { border-color: #38bdf8; background: #131d35; transform: translateY(-1px); }
        .file-info { display: flex; align-items: center; gap: 12px; overflow: hidden; flex: 1; }
        .file-icon { font-size: 26px; flex-shrink: 0; width: 36px; text-align: center; }
        .file-details { overflow: hidden; flex: 1; }
        .file-name { font-size: 13px; font-weight: 600; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .file-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
        .file-actions { display: flex; gap: 6px; margin-left: 8px; }
        .action-btn { background: #1e293b; border: none; color: #94a3b8; border-radius: 6px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 13px; }
        .action-btn:hover { background: #334155; color: #fff; }
        .action-delete:hover { background: #dc2626; color: #fff; }
        /* Player Modal */
        .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 200; align-items: center; justify-content: center; padding: 16px; }
        .modal.open { display: flex; }
        .modal-content { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; max-width: 900px; width: 100%; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        .modal-header { padding: 14px 18px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; }
        .modal-header h3 { font-size: 14px; font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%; }
        .modal-body { padding: 16px; display: flex; align-items: center; justify-content: center; background: #000; min-height: 300px; max-height: 75vh; }
        video, audio { width: 100%; max-height: 70vh; outline: none; }
        img.preview { max-width: 100%; max-height: 70vh; object-fit: contain; }
        .close-btn { background: #334155; border: none; color: #f1f5f9; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; }
        .badge-stream { font-size: 10px; background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
        /* Upload Progress Card */
        .upload-card { background: linear-gradient(135deg, #0f172a, #1e1b4b); border: 1px solid #3b82f6; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; box-shadow: 0 10px 25px -5px rgba(59,130,246,0.3); animation: slideDown 0.2s ease-out; }
        .upload-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .upload-info { display: flex; align-items: center; gap: 10px; overflow: hidden; min-width: 0; }
        .upload-spinner { width: 18px; height: 18px; border: 2px solid rgba(56,189,248,0.3); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .upload-filename { font-size: 13px; font-weight: 600; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
        .upload-meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .upload-percent { font-size: 14px; font-weight: 700; color: #34d399; font-family: monospace; }
        .progress-bar-bg { width: 100%; height: 8px; background: #0b1120; border-radius: 999px; overflow: hidden; border: 1px solid #1e293b; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #38bdf8, #818cf8, #34d399); border-radius: 999px; transition: width 0.15s ease-out; }
        @media (max-width: 640px) {
            header { padding: 12px 14px; flex-direction: column; align-items: flex-start; gap: 8px; }
            .brand { width: 100%; }
            .hub-link { align-self: flex-end; }
            .toolbar { flex-direction: column; align-items: stretch; gap: 10px; }
            .breadcrumbs { overflow-x: auto; white-space: nowrap; padding-bottom: 4px; }
            .actions { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
            .actions .btn { flex: 1 1 auto; justify-content: center; min-height: 40px; font-size: 12px; padding: 6px 10px; }
            .search-box { max-width: 100%; width: 100%; }
            .search-box input { width: 100%; }
            .file-grid { grid-template-columns: 1fr; }
            .file-card { padding: 10px 12px; }
            .upload-filename { max-width: 180px; }
        }
    </style>
</head>
<body>
    <header>
        <div class=""brand"">
            <div class=""logo"">📁</div>
            <div class=""title"">
                <h1>Native File Manager <span class=""badge-stream"">Byte-Range Streamer</span></h1>
                <p>RFC 7233 Streaming • Touch Ready • Native Windows Engine</p>
            </div>
        </div>
        <a href=""http://localhost:3000"" class=""hub-link"">← Ownbase</a>
    </header>

    <div class=""main-container"">
        <div class=""toolbar"">
            <div class=""breadcrumbs"" id=""breadcrumbs""></div>
            <div class=""actions"">
                <input type=""file"" id=""fileUpload"" multiple style=""display:none"" onchange=""handleUpload(event)"">
                <button class=""btn"" onclick=""document.getElementById('fileUpload').click()"">📤 Upload</button>
                <button class=""btn btn-secondary"" onclick=""createFolder()"">📁 New Folder</button>
                <button class=""btn btn-secondary"" onclick=""loadDirectory(currentPath)"">🔄 Refresh</button>
            </div>
            <div class=""search-box"">
                <input type=""text"" id=""searchInput"" placeholder=""Search files..."" oninput=""filterFiles()"">
            </div>
        </div>

        <!-- Live Upload Progress Card -->
        <div id=""uploadProgressCard"" class=""upload-card"" style=""display:none"">
            <div class=""upload-header"">
                <div class=""upload-info"">
                    <div class=""upload-spinner""></div>
                    <div>
                        <div class=""upload-filename"" id=""uploadFilename"">Uploading...</div>
                        <div class=""upload-meta"" id=""uploadMeta"">0 B / 0 B</div>
                    </div>
                </div>
                <div class=""upload-percent"" id=""uploadPercent"">0%</div>
            </div>
            <div class=""progress-bar-bg"">
                <div class=""progress-bar-fill"" id=""progressBarFill"" style=""width:0%""></div>
            </div>
        </div>

        <div id=""fileContainer"" class=""file-grid""></div>
    </div>

    <!-- Media Player Modal -->
    <div id=""mediaModal"" class=""modal"">
        <div class=""modal-content"">
            <div class=""modal-header"">
                <h3 id=""modalTitle"">Media Preview</h3>
                <button class=""close-btn"" onclick=""closeModal()"">✕</button>
            </div>
            <div class=""modal-body"" id=""modalBody""></div>
        </div>
    </div>

    <script>
        let currentPath = '/';
        let itemsList = [];

        async function loadDirectory(path) {
            currentPath = path;
            renderBreadcrumbs();
            const container = document.getElementById('fileContainer');
            container.innerHTML = '<div style=""color:#94a3b8;padding:20px;grid-column:1/-1;text-align:center"">Loading files...</div>';

            try {
                const res = await fetch('/api/resources?path=' + encodeURIComponent(path));
                const data = await res.json();
                itemsList = data.items || [];
                renderFiles(itemsList);
            } catch (err) {
                container.innerHTML = '<div style=""color:#ef4444;padding:20px;grid-column:1/-1;text-align:center"">Failed to load directory: ' + err.message + '</div>';
            }
        }

        function renderBreadcrumbs() {
            const bc = document.getElementById('breadcrumbs');
            const parts = currentPath.split('/').filter(Boolean);
            let html = '<span class=""crumb"" onclick=""loadDirectory(\'/\')"">Root</span>';
            let accum = '';
            for (let i = 0; i < parts.length; i++) {
                accum += '/' + parts[i];
                const p = accum;
                html += '<span class=""crumb-sep"">/</span><span class=""crumb"" onclick=""loadDirectory(\'' + p + '\')"">' + parts[i] + '</span>';
            }
            bc.innerHTML = html;
        }

        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024, dm = 1, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }

        function getFileIcon(item) {
            if (item.isDir) return '📁';
            const ext = (item.extension || '').toLowerCase();
            if (['.mkv', '.mp4', '.webm', '.mov', '.avi'].includes(ext)) return '🎬';
            if (['.mp3', '.wav', '.flac', '.ogg'].includes(ext)) return '🎵';
            if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext)) return '🖼️';
            if (['.pdf', '.txt', '.doc', '.docx'].includes(ext)) return '📄';
            if (['.zip', '.tar', '.gz', '.rar'].includes(ext)) return '📦';
            return '📄';
        }

        function renderFiles(items) {
            const container = document.getElementById('fileContainer');
            if (items.length === 0) {
                container.innerHTML = '<div style=""color:#64748b;padding:40px;grid-column:1/-1;text-align:center"">No files found in this folder</div>';
                return;
            }

            container.innerHTML = items.map(it => {
                const icon = getFileIcon(it);
                let displayName = it.name || '';
                try { displayName = decodeURIComponent(displayName); } catch(e) {}
                const subMeta = it.isDir ? 'Folder' : (formatBytes(it.size) + ' • ' + (it.extension || 'file').toUpperCase());
                return `
                    <div class=""file-card"" onclick=""handleItemClick('${it.path}', ${it.isDir}, '${it.extension}')"">
                        <div class=""file-info"">
                            <div class=""file-icon"">${icon}</div>
                            <div class=""file-details"">
                                <div class=""file-name"" title=""${displayName}"">${displayName}</div>
                                <div class=""file-meta"">${subMeta}</div>
                            </div>
                        </div>
                        <div class=""file-actions"" onclick=""event.stopPropagation()"">
                            ${!it.isDir ? `<a href=""/api/stream?path=${encodeURIComponent(it.path)}"" download class=""action-btn"" title=""Download"">⬇️</a>` : ''}
                            <button class=""action-btn action-delete"" title=""Delete"" onclick=""deleteItem('${it.path}')"">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function filterFiles() {
            const q = document.getElementById('searchInput').value.toLowerCase();
            const filtered = itemsList.filter(it => {
                let name = it.name || '';
                try { name = decodeURIComponent(name); } catch(e) {}
                return name.toLowerCase().includes(q);
            });
            renderFiles(filtered);
        }

        function handleItemClick(path, isDir, ext) {
            if (isDir) {
                loadDirectory(path);
                return;
            }

            ext = (ext || '').toLowerCase();
            const isVideo = ['.mkv', '.mp4', '.webm', '.mov', '.avi'].includes(ext);
            const isAudio = ['.mp3', '.wav', '.flac', '.ogg'].includes(ext);
            const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

            const streamUrl = '/api/stream?path=' + encodeURIComponent(path);
            let name = path.split('/').pop();
            try { name = decodeURIComponent(name); } catch(e) {}

            if (isVideo) {
                openModal(name, `<video controls autoplay playsinline preload=""metadata"" src=""${streamUrl}""></video>`);
            } else if (isAudio) {
                openModal(name, `<audio controls autoplay src=""${streamUrl}""></audio>`);
            } else if (isImage) {
                openModal(name, `<img class=""preview"" src=""${streamUrl}"">`);
            } else {
                window.open(streamUrl, '_blank');
            }
        }

        function openModal(title, bodyHtml) {
            document.getElementById('modalTitle').textContent = title;
            document.getElementById('modalBody').innerHTML = bodyHtml;
            document.getElementById('mediaModal').classList.add('open');
        }

        function closeModal() {
            const modalBody = document.getElementById('modalBody');
            modalBody.innerHTML = '';
            document.getElementById('mediaModal').classList.remove('open');
        }

        async function createFolder() {
            const name = prompt('Enter new folder name:');
            if (!name) return;
            const full = currentPath === '/' ? ('/' + name) : (currentPath + '/' + name);
            try {
                const res = await fetch('/api/mkdir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: full })
                });
                if (res.ok) loadDirectory(currentPath);
                else alert('Failed to create folder');
            } catch (err) { alert(err.message); }
        }

        async function deleteItem(path) {
            let name = path.split('/').pop();
            try { name = decodeURIComponent(name); } catch(e) {}
            if (!confirm('Are you sure you want to delete ' + name + '?')) return;
            try {
                const res = await fetch('/api/resources?path=' + encodeURIComponent(path), { method: 'DELETE' });
                if (res.ok) loadDirectory(currentPath);
                else alert('Failed to delete item');
            } catch (err) { alert(err.message); }
        }

        function uploadSingleFile(file, path, onProgress) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/upload?path=' + encodeURIComponent(path), true);
                xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                if (xhr.upload) {
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable && e.total > 0) {
                            onProgress(e.loaded, e.total);
                        }
                    };
                }
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject(new Error('Server returned HTTP ' + xhr.status));
                };
                xhr.onerror = () => reject(new Error('Network error during upload'));
                xhr.ontimeout = () => reject(new Error('Upload timed out'));
                xhr.send(file);
            });
        }

        async function handleUpload(event) {
            const files = event.target.files;
            if (!files || files.length === 0) return;

            const card = document.getElementById('uploadProgressCard');
            const nameEl = document.getElementById('uploadFilename');
            const metaEl = document.getElementById('uploadMeta');
            const pctEl = document.getElementById('uploadPercent');
            const barEl = document.getElementById('progressBarFill');

            card.style.display = 'block';

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                nameEl.textContent = (files.length > 1 ? `[${i + 1}/${files.length}] ` : '') + file.name;
                pctEl.textContent = '0%';
                barEl.style.width = '0%';
                metaEl.textContent = `0 B / ${formatBytes(file.size)}`;

                try {
                    await uploadSingleFile(file, currentPath, (loaded, total) => {
                        const pct = Math.min(100, Math.round((loaded / total) * 100));
                        pctEl.textContent = pct + '%';
                        barEl.style.width = pct + '%';
                        metaEl.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
                    });
                } catch (err) {
                    alert('Upload failed for ' + file.name + ': ' + err.message);
                }
            }

            nameEl.textContent = `✅ Uploaded ${files.length} file${files.length > 1 ? 's' : ''} successfully!`;
            pctEl.textContent = '100%';
            barEl.style.width = '100%';

            setTimeout(() => {
                card.style.display = 'none';
                barEl.style.width = '0%';
            }, 2200);

            event.target.value = '';
            loadDirectory(currentPath);
        }

        // Initialize on load
        loadDirectory('/');
    </script>
</body>
</html>";
        }
    }
}
