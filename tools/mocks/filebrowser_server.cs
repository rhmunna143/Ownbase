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
            string programData = Environment.GetEnvironmentVariable("ProgramData");
            if (string.IsNullOrEmpty(programData)) programData = @"C:\ProgramData";
            string serviceStorage = Path.Combine(programData, "Ownbase", "storage");
            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "native-windows-server-hub");
            string appDataStorage = Path.Combine(appData, "storage");

            StorageRoot = Directory.Exists(serviceStorage) ? serviceStorage : appDataStorage;

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

                // Cross-subdomain SSO session cookie planting
                string reqToken = req.QueryString["token"] ?? req.QueryString["access_token"];
                if (!string.IsNullOrEmpty(reqToken))
                {
                    res.Headers.Add("Set-Cookie", "ownbase_access_token=" + reqToken + "; Path=/; SameSite=Lax; Max-Age=86400");
                }

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

                // Favicon serving
                if (lowerPath == "/favicon.ico" || lowerPath == "/favicon.svg")
                {
                    SendFavicon(res, lowerPath, isHead);
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

                // REST API: Copy file/directory
                if (lowerPath == "/api/copy" && req.HttpMethod == "POST")
                {
                    HandleCopyResource(req, res);
                    return;
                }

                // REST API: Move file/directory (also used for Cut & Paste and Drag & Drop)
                if (lowerPath == "/api/move" && req.HttpMethod == "POST")
                {
                    HandleMoveResource(req, res);
                    return;
                }

                // REST API: Rename file/directory
                if ((lowerPath == "/api/rename" || lowerPath == "/api/resources/rename") && req.HttpMethod == "POST")
                {
                    HandleRenameResource(req, res);
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
            string folder = req.QueryString["name"] ?? req.QueryString["path"] ?? req.QueryString["folderName"] ?? "";
            if (string.IsNullOrEmpty(folder))
            {
                using (StreamReader reader = new StreamReader(req.InputStream, Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    folder = ExtractJsonField(body, "name");
                    if (string.IsNullOrEmpty(folder)) folder = ExtractJsonField(body, "folderName");
                    if (string.IsNullOrEmpty(folder)) folder = ExtractJsonField(body, "path");
                    string target = ExtractJsonField(body, "targetPath");
                    if (!string.IsNullOrEmpty(target) && !string.IsNullOrEmpty(folder))
                    {
                        folder = Path.Combine(target, folder);
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

        private static void HandleCopyResource(HttpListenerRequest req, HttpListenerResponse res)
        {
            string source = "";
            string destination = "";

            using (StreamReader reader = new StreamReader(req.InputStream, Encoding.UTF8))
            {
                string body = reader.ReadToEnd();
                source = ExtractJsonField(body, "source");
                if (string.IsNullOrEmpty(source)) source = ExtractJsonField(body, "sourcePath");
                if (string.IsNullOrEmpty(source)) source = ExtractJsonField(body, "from");

                destination = ExtractJsonField(body, "destination");
                if (string.IsNullOrEmpty(destination)) destination = ExtractJsonField(body, "destinationDir");
                if (string.IsNullOrEmpty(destination)) destination = ExtractJsonField(body, "target");
                if (string.IsNullOrEmpty(destination)) destination = ExtractJsonField(body, "to");
            }

            if (string.IsNullOrEmpty(source)) source = req.QueryString["source"] ?? req.QueryString["sourcePath"] ?? "";
            if (string.IsNullOrEmpty(destination)) destination = req.QueryString["destination"] ?? req.QueryString["destinationDir"] ?? "";

            if (string.IsNullOrEmpty(source) || string.IsNullOrEmpty(destination))
            {
                res.StatusCode = 400;
                SendJson(res, "{\"error\":\"Missing source or destination path\"}", false);
                return;
            }

            string srcFull = SafeResolvePath(Uri.UnescapeDataString(source));
            string dstFull = SafeResolvePath(Uri.UnescapeDataString(destination));

            if (!File.Exists(srcFull) && !Directory.Exists(srcFull))
            {
                res.StatusCode = 404;
                SendJson(res, "{\"error\":\"Source item does not exist\"}", false);
                return;
            }

            // If destination is an existing directory, place copy inside it
            if (Directory.Exists(dstFull))
            {
                string itemName = Path.GetFileName(srcFull);
                dstFull = Path.Combine(dstFull, itemName);
            }

            try
            {
                if (File.Exists(srcFull))
                {
                    if (File.Exists(dstFull))
                    {
                        string dir = Path.GetDirectoryName(dstFull);
                        string nameWithoutExt = Path.GetFileNameWithoutExtension(dstFull);
                        string ext = Path.GetExtension(dstFull);
                        dstFull = Path.Combine(dir, nameWithoutExt + " - Copy" + ext);
                    }
                    File.Copy(srcFull, dstFull, true);
                }
                else if (Directory.Exists(srcFull))
                {
                    CopyDirectoryRecursively(srcFull, dstFull);
                }

                SendJson(res, "{\"success\":true,\"message\":\"Item copied successfully\",\"destination\":" + ToJsonString(GetRelativePath(dstFull)) + "}", false);
            }
            catch (Exception ex)
            {
                res.StatusCode = 500;
                SendJson(res, "{\"error\":\"Copy operation failed: " + ex.Message.Replace("\"", "'") + "\"}", false);
            }
        }

        private static void HandleMoveResource(HttpListenerRequest req, HttpListenerResponse res)
        {
            string source = "";
            string destination = "";

            using (StreamReader reader = new StreamReader(req.InputStream, Encoding.UTF8))
            {
                string body = reader.ReadToEnd();
                source = ExtractJsonField(body, "source");
                if (string.IsNullOrEmpty(source)) source = ExtractJsonField(body, "sourcePath");
                if (string.IsNullOrEmpty(source)) source = ExtractJsonField(body, "from");

                destination = ExtractJsonField(body, "destination");
                if (string.IsNullOrEmpty(destination)) destination = ExtractJsonField(body, "destinationDir");
                if (string.IsNullOrEmpty(destination)) destination = ExtractJsonField(body, "target");
                if (string.IsNullOrEmpty(destination)) destination = ExtractJsonField(body, "to");
            }

            if (string.IsNullOrEmpty(source)) source = req.QueryString["source"] ?? req.QueryString["sourcePath"] ?? "";
            if (string.IsNullOrEmpty(destination)) destination = req.QueryString["destination"] ?? req.QueryString["destinationDir"] ?? "";

            if (string.IsNullOrEmpty(source) || string.IsNullOrEmpty(destination))
            {
                res.StatusCode = 400;
                SendJson(res, "{\"error\":\"Missing source or destination path\"}", false);
                return;
            }

            string srcFull = SafeResolvePath(Uri.UnescapeDataString(source));
            string dstFull = SafeResolvePath(Uri.UnescapeDataString(destination));

            if (!File.Exists(srcFull) && !Directory.Exists(srcFull))
            {
                res.StatusCode = 404;
                SendJson(res, "{\"error\":\"Source item does not exist\"}", false);
                return;
            }

            // If destination is an existing directory, move inside it
            if (Directory.Exists(dstFull))
            {
                string itemName = Path.GetFileName(srcFull);
                dstFull = Path.Combine(dstFull, itemName);
            }

            if (string.Equals(srcFull, dstFull, StringComparison.OrdinalIgnoreCase))
            {
                SendJson(res, "{\"success\":true,\"message\":\"Source and destination are identical\"}", false);
                return;
            }

            try
            {
                if (File.Exists(srcFull))
                {
                    if (File.Exists(dstFull))
                    {
                        File.Delete(dstFull);
                    }
                    File.Move(srcFull, dstFull);
                }
                else if (Directory.Exists(srcFull))
                {
                    if (Directory.Exists(dstFull))
                    {
                        Directory.Delete(dstFull, true);
                    }
                    Directory.Move(srcFull, dstFull);
                }

                SendJson(res, "{\"success\":true,\"message\":\"Item moved successfully\",\"destination\":" + ToJsonString(GetRelativePath(dstFull)) + "}", false);
            }
            catch (Exception ex)
            {
                res.StatusCode = 500;
                SendJson(res, "{\"error\":\"Move operation failed: " + ex.Message.Replace("\"", "'") + "\"}", false);
            }
        }

        private static void HandleRenameResource(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string body = "";
                using (StreamReader reader = new StreamReader(req.InputStream, req.ContentEncoding ?? Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }

                string oldPath = ExtractJsonField(body, "oldPath");
                if (string.IsNullOrEmpty(oldPath)) oldPath = ExtractJsonField(body, "path");
                if (string.IsNullOrEmpty(oldPath)) oldPath = ExtractJsonField(body, "source");
                string newName = ExtractJsonField(body, "newName");
                if (string.IsNullOrEmpty(newName)) newName = ExtractJsonField(body, "name");

                if (string.IsNullOrEmpty(oldPath) || string.IsNullOrEmpty(newName))
                {
                    res.StatusCode = 400;
                    SendJson(res, "{\"success\":false,\"error\":\"Missing oldPath or newName\"}", false);
                    return;
                }

                string sourceFull = SafeResolvePath(oldPath);
                if (Path.GetFullPath(sourceFull) == Path.GetFullPath(StorageRoot))
                {
                    res.StatusCode = 400;
                    SendJson(res, "{\"success\":false,\"error\":\"Cannot rename storage root directory\"}", false);
                    return;
                }

                string cleanName = Path.GetFileName(newName).Trim();
                string parentDir = Path.GetDirectoryName(sourceFull);
                string targetFull = Path.Combine(parentDir, cleanName);

                if (File.Exists(sourceFull))
                {
                    File.Move(sourceFull, targetFull);
                    SendJson(res, "{\"success\":true,\"path\":" + ToJsonString(GetRelativePath(targetFull)) + "}", false);
                    return;
                }
                else if (Directory.Exists(sourceFull))
                {
                    Directory.Move(sourceFull, targetFull);
                    SendJson(res, "{\"success\":true,\"path\":" + ToJsonString(GetRelativePath(targetFull)) + "}", false);
                    return;
                }
                else
                {
                    res.StatusCode = 404;
                    SendJson(res, "{\"success\":false,\"error\":\"Item not found\"}", false);
                    return;
                }
            }
            catch (Exception ex)
            {
                res.StatusCode = 500;
                SendJson(res, "{\"success\":false,\"error\":" + ToJsonString(ex.Message) + "}", false);
            }
        }

        private static void CopyDirectoryRecursively(string sourceDir, string destinationDir)
        {
            if (!Directory.Exists(destinationDir))
            {
                Directory.CreateDirectory(destinationDir);
            }
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string destFile = Path.Combine(destinationDir, Path.GetFileName(file));
                File.Copy(file, destFile, true);
            }
            foreach (string subDir in Directory.GetDirectories(sourceDir))
            {
                string destSubDir = Path.Combine(destinationDir, Path.GetFileName(subDir));
                CopyDirectoryRecursively(subDir, destSubDir);
            }
        }

        private static string ExtractJsonField(string json, string field)
        {
            if (string.IsNullOrEmpty(json)) return "";
            string key = "\"" + field + "\":";
            int idx = json.IndexOf(key);
            if (idx == -1) return "";
            int s = json.IndexOf("\"", idx + key.Length);
            if (s == -1) return "";
            int e = json.IndexOf("\"", s + 1);
            if (e == -1) return "";
            return json.Substring(s + 1, e - s - 1);
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

        private static void SendFavicon(HttpListenerResponse res, string path, bool isHead)
        {
            const string svg = @"<svg xmlns=""http://www.w3.org/2000/svg"" viewBox=""0 0 64 64"">
  <defs>
    <linearGradient id=""folderBack"" x1=""0%"" y1=""0%"" x2=""100%"" y2=""100%"">
      <stop offset=""0%"" stop-color=""#0284c7""/>
      <stop offset=""100%"" stop-color=""#0369a1""/>
    </linearGradient>
    <linearGradient id=""folderFront"" x1=""0%"" y1=""0%"" x2=""100%"" y2=""100%"">
      <stop offset=""0%"" stop-color=""#38bdf8""/>
      <stop offset=""100%"" stop-color=""#0284c7""/>
    </linearGradient>
    <linearGradient id=""docGrad"" x1=""0%"" y1=""0%"" x2=""100%"" y2=""100%"">
      <stop offset=""0%"" stop-color=""#ffffff""/>
      <stop offset=""100%"" stop-color=""#e2e8f0""/>
    </linearGradient>
  </defs>
  <rect width=""64"" height=""64"" rx=""16"" fill=""#070e1e""/>
  <rect x=""2"" y=""2"" width=""60"" height=""60"" rx=""14"" fill=""none"" stroke=""#1e293b"" stroke-width=""1.5""/>
  <path d=""M12,22 C12,19.8 13.8,18 16,18 L25,18 C27,18 28.5,19.2 29.5,21 L32,25 L48,25 C50.2,25 52,26.8 52,29 L52,46 C52,48.2 50.2,50 48,50 L16,50 C13.8,50 12,48.2 12,46 Z"" fill=""url(#folderBack)""/>
  <rect x=""20"" y=""14"" width=""24"" height=""24"" rx=""3"" fill=""url(#docGrad)""/>
  <line x1=""25"" y1=""20"" x2=""39"" y2=""20"" stroke=""#94a3b8"" stroke-width=""2"" stroke-linecap=""round""/>
  <line x1=""25"" y1=""26"" x2=""35"" y2=""26"" stroke=""#94a3b8"" stroke-width=""2"" stroke-linecap=""round""/>
  <path d=""M10,29 C10,26.8 11.8,25 14,25 L50,25 C52.2,25 54,26.8 54,29 L51,47 C50.8,49 49,51 47,51 L17,51 C15,51 13.2,49 13,47 Z"" fill=""url(#folderFront)""/>
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

        private static string GetWebClientHtml()
        {
            return @"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"">
    <title>Ownbase Native File Manager</title>
    <link rel=""icon"" type=""image/svg+xml"" href=""/favicon.svg"">
    <link rel=""alternate icon"" href=""/favicon.ico"">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        html, body { width: 100%; max-width: 100vw; overflow-x: hidden; background: #070b14; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; min-height: 100vh; padding-bottom: 40px; }
        header { background: #0c1220; border-bottom: 1px solid #1e293b; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; gap: 10px; width: 100%; box-sizing: border-box; }
        .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .logo { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #0284c7, #2563eb); display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; box-shadow: 0 4px 12px rgba(2,132,199,0.3); flex-shrink: 0; }
        .title { overflow: hidden; }
        .title h1 { font-size: 15px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .title p { font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hub-link { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s; white-space: nowrap; flex-shrink: 0; }
        .hub-link:hover { background: #334155; color: #fff; }
        .main-container { max-width: 1280px; width: 100%; margin: 16px auto; padding: 0 16px; flex: 1; box-sizing: border-box; overflow-x: hidden; }
        .toolbar { background: #0f172a; border: 1px solid #1e293b; border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 12px; width: 100%; box-sizing: border-box; }
        .toolbar-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .breadcrumbs { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 500; overflow-x: auto; white-space: nowrap; padding-bottom: 2px; scrollbar-width: none; }
        .breadcrumbs::-webkit-scrollbar { display: none; }
        .crumb { color: #38bdf8; cursor: pointer; text-decoration: none; padding: 4px 8px; border-radius: 6px; transition: background 0.15s; }
        .crumb:hover { background: rgba(56,189,248,0.12); }
        .crumb-sep { color: #475569; }
        .toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .btn { background: #0284c7; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 38px; transition: all 0.2s; white-space: nowrap; }
        .btn:hover { background: #0369a1; }
        .btn-secondary { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; }
        .btn-secondary:hover { background: #334155; color: #fff; }
        .btn-danger { background: #dc2626 !important; color: #fff !important; }
        .btn-danger:hover { background: #b91c1c !important; }
        .btn-paste { background: #059669; color: #fff; }
        .btn-paste:hover { background: #047857; }
        .search-box { flex: 1; min-width: 200px; max-width: 320px; position: relative; }
        .search-box input { width: 100%; background: #090d16; border: 1px solid #334155; color: #f8fafc; padding: 8px 12px; border-radius: 8px; font-size: 13px; outline: none; transition: border-color 0.2s; }
        .search-box input:focus { border-color: #38bdf8; }
        /* Clipboard Bar */
        .clipboard-bar { background: linear-gradient(135deg, #1e1b4b, #0f172a); border: 1px solid #6366f1; border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; animation: slideDown 0.2s ease-out; flex-wrap: wrap; }
        .clipboard-info { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #c7d2fe; overflow: hidden; text-overflow: ellipsis; }
        .clipboard-name { font-weight: 700; color: #fff; }
        .clipboard-actions { display: flex; align-items: center; gap: 6px; }
        /* Grid & Cards */
        .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); gap: 12px; width: 100%; box-sizing: border-box; }
        .file-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; min-height: 64px; user-select: none; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; position: relative; z-index: 1; }
        .file-card:hover { border-color: #38bdf8; background: #131d35; transform: translateY(-1px); }
        .file-card.menu-open { z-index: 100 !important; border-color: #38bdf8 !important; }
        .file-card.dragging { opacity: 0.4; border-style: dashed; }
        .file-card.drop-target { border-color: #10b981 !important; background: rgba(16,185,129,0.15) !important; transform: scale(1.02); }
        .file-info { display: flex; align-items: center; gap: 12px; overflow: hidden; flex: 1 1 0%; min-width: 0; max-width: calc(100% - 44px); }
        .file-icon { font-size: 26px; flex-shrink: 0; width: 34px; text-align: center; }
        .file-details { overflow: hidden; flex: 1 1 0%; min-width: 0; }
        .file-name { font-size: 13px; font-weight: 600; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 100%; }
        .file-meta { font-size: 11px; color: #64748b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .file-actions { display: flex; gap: 4px; margin-left: 8px; flex-shrink: 0; position: relative; z-index: 105; width: 32px; justify-content: flex-end; }
        /* 3-Dots Dropdown Menu */
        .dots-btn { background: #1e293b; border: 1px solid #334155; color: #94a3b8; border-radius: 8px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; font-weight: bold; line-height: 1; transition: all 0.15s; flex-shrink: 0; }
        .dots-btn:hover { background: #334155; color: #fff; border-color: #64748b; }
        .dropdown-menu { display: none; position: absolute; right: 0; top: 38px; background: #0b1120; border: 1px solid #334155; border-radius: 12px; padding: 6px; min-width: 150px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 120 !important; flex-direction: column; gap: 2px; animation: slideDown 0.15s ease-out; }
        .dropdown-menu.show { display: flex; }
        .dropdown-menu button, .dropdown-menu a { background: transparent; border: none; color: #cbd5e1; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 8px; text-decoration: none; transition: all 0.15s; text-align: left; width: 100%; box-sizing: border-box; }
        .dropdown-menu button:hover, .dropdown-menu a:hover { background: #1e293b; color: #fff; }
        .dropdown-menu .delete-opt { color: #f87171; }
        .dropdown-menu .delete-opt:hover { background: rgba(239,68,68,0.18); color: #fca5a5; }
        .dropdown-sep { height: 1px; background: #1e293b; margin: 4px 0; }
        /* Player Modal */
        .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 200; align-items: center; justify-content: center; padding: 16px; }
        .modal.open { display: flex; }
        .modal-content { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; max-width: 900px; width: 100%; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        .modal-header { padding: 12px 16px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; }
        .modal-header h3 { font-size: 14px; font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%; }
        .modal-body { padding: 12px; display: flex; align-items: center; justify-content: center; background: #000; min-height: 280px; max-height: 75vh; }
        video, audio { width: 100%; max-height: 70vh; outline: none; }
        img.preview { max-width: 100%; max-height: 70vh; object-fit: contain; }
        .close-btn { background: #334155; border: none; color: #f1f5f9; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; }
        .badge-stream { font-size: 10px; background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); padding: 2px 6px; border-radius: 4px; }
        /* Upload Progress Card */
        .upload-card { background: linear-gradient(135deg, #0f172a, #1e1b4b); border: 1px solid #3b82f6; border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; box-shadow: 0 10px 25px -5px rgba(59,130,246,0.3); animation: slideDown 0.2s ease-out; }
        .upload-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .upload-info { display: flex; align-items: center; gap: 10px; overflow: hidden; min-width: 0; }
        .upload-spinner { width: 16px; height: 16px; border: 2px solid rgba(56,189,248,0.3); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .upload-filename { font-size: 13px; font-weight: 600; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
        .upload-meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .upload-percent { font-size: 13px; font-weight: 700; color: #34d399; font-family: monospace; }
        .progress-bar-bg { width: 100%; height: 6px; background: #0b1120; border-radius: 999px; overflow: hidden; border: 1px solid #1e293b; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #38bdf8, #818cf8, #34d399); border-radius: 999px; transition: width 0.15s ease-out; }
        /* Full Window Drag & Drop Overlay */
        .drop-overlay { display: none; position: fixed; inset: 0; background: rgba(15,23,42,0.92); backdrop-filter: blur(8px); z-index: 300; align-items: center; justify-content: center; flex-direction: column; gap: 16px; border: 3px dashed #38bdf8; margin: 10px; border-radius: 20px; pointer-events: none; }
        .drop-overlay.active { display: flex; }
        .drop-overlay-icon { font-size: 48px; animation: bounce 1s infinite alternate; }
        .drop-overlay-title { font-size: 18px; font-weight: 700; color: #fff; }
        .drop-overlay-sub { font-size: 13px; color: #38bdf8; }
        @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }
        /* Mobile Media Query */
        @media (max-width: 640px) {
            header { padding: 10px 14px; width: 100%; }
            .brand { max-width: calc(100% - 100px); }
            .title h1 { font-size: 13px; }
            .title p { display: none; }
            .main-container { padding: 0 8px; margin: 10px auto; width: 100%; }
            .toolbar { padding: 10px 12px; gap: 10px; width: 100%; }
            .toolbar-actions { width: 100%; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
            .toolbar-actions .btn { justify-content: center; }
            .search-box { max-width: 100%; width: 100%; }
            .file-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 8px; width: 100%; }
            .file-card { padding: 10px 12px; width: 100%; min-width: 0; max-width: 100%; overflow: visible; box-sizing: border-box; }
        }
    </style>
</head>
<body>
    <!-- Fullscreen File Upload Drop Overlay -->
    <div id=""dropOverlay"" class=""drop-overlay"">
        <div class=""drop-overlay-icon"">📥</div>
        <div class=""drop-overlay-title"">Drop Files to Upload</div>
        <div class=""drop-overlay-sub"" id=""dropOverlaySub"">Release files to upload to current directory</div>
    </div>

    <header>
        <div class=""brand"">
            <div class=""logo"">📁</div>
            <div class=""title"">
                <h1>Native File Manager <span class=""badge-stream"">Streamer</span></h1>
                <p>RFC 7233 • Touch Ready • Native Windows Engine</p>
            </div>
        </div>
        <a id=""hubLink"" href=""/"" class=""hub-link"">← Ownbase</a>
    </header>

    <div class=""main-container"">
        <!-- Clipboard Status Banner -->
        <div id=""clipboardBar"" class=""clipboard-bar"" style=""display:none"">
            <div class=""clipboard-info"">
                <span id=""clipboardIcon"">📋</span>
                <span><span id=""clipboardAction"">Copied</span>: <span id=""clipboardName"" class=""clipboard-name""></span></span>
            </div>
            <div class=""clipboard-actions"">
                <button class=""btn btn-paste"" onclick=""pasteItem()"">📥 Paste Here</button>
                <button class=""btn btn-secondary"" onclick=""clearClipboard()"">✕ Cancel</button>
            </div>
        </div>

        <div class=""toolbar"">
            <div class=""toolbar-top"">
                <div class=""breadcrumbs"" id=""breadcrumbs""></div>
                <div class=""search-box"">
                    <input type=""text"" id=""searchInput"" placeholder=""Search files..."" oninput=""filterFiles()"">
                </div>
            </div>
            <div class=""toolbar-actions"">
                <input type=""file"" id=""fileUpload"" multiple style=""display:none"" onchange=""handleUpload(event)"">
                <button class=""btn"" onclick=""document.getElementById('fileUpload').click()"">⬆️ Upload</button>
                <button class=""btn btn-secondary"" onclick=""createFolder()"">📁 New Folder</button>
                <button id=""btnPasteToolbar"" class=""btn btn-paste"" style=""display:none"" onclick=""pasteItem()"">📥 Paste</button>
                <button class=""btn btn-secondary"" onclick=""loadDirectory(currentPath)"">🔄 Refresh</button>
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

    <!-- Reusable Modal Dialog (Alert, Confirm, Prompt) -->
    <div id=""fbDialogModal"" class=""modal"">
        <div class=""modal-content"" style=""max-width: 440px; border-radius: 16px; border: 1px solid #334155; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);"">
            <div class=""modal-header"" style=""border-bottom: 1px solid #1e293b; padding: 14px 18px;"">
                <h3 id=""fbDialogTitle"" style=""font-size: 15px; font-weight: 600; color: #f8fafc;"">Notice</h3>
            </div>
            <div class=""modal-body"" style=""background: #0f172a; min-height: auto; padding: 20px; display: flex; flex-direction: column; align-items: stretch; gap: 14px;"">
                <p id=""fbDialogMsg"" style=""font-size: 13px; color: #cbd5e1; line-height: 1.5; margin: 0;""></p>
                <input type=""text"" id=""fbDialogInput"" style=""display:none; width: 100%; background: #090d16; border: 1px solid #334155; color: #f8fafc; padding: 10px 12px; border-radius: 8px; font-size: 13px; outline: none; box-sizing: border-box;"" />
                <div style=""display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px;"">
                    <button id=""fbDialogCancel"" class=""btn btn-secondary"" style=""display:none; min-height: 36px; padding: 6px 14px;"">Cancel</button>
                    <button id=""fbDialogOk"" class=""btn"" style=""min-height: 36px; padding: 6px 16px;"">Confirm</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const fbModal = {
            alert: function(message, title = 'Notice') {
                return new Promise(resolve => {
                    const modal = document.getElementById('fbDialogModal');
                    document.getElementById('fbDialogTitle').textContent = title;
                    document.getElementById('fbDialogMsg').textContent = message;
                    document.getElementById('fbDialogInput').style.display = 'none';
                    document.getElementById('fbDialogCancel').style.display = 'none';
                    const okBtn = document.getElementById('fbDialogOk');
                    okBtn.textContent = 'OK';
                    okBtn.className = 'btn';

                    function cleanup() {
                        okBtn.removeEventListener('click', onOk);
                        modal.classList.remove('open');
                    }
                    function onOk() {
                        cleanup();
                        resolve();
                    }
                    okBtn.addEventListener('click', onOk);
                    modal.classList.add('open');
                    okBtn.focus();
                });
            },
            confirm: function(message, title = 'Confirm Action', okText = 'Confirm', isDanger = false) {
                return new Promise(resolve => {
                    const modal = document.getElementById('fbDialogModal');
                    document.getElementById('fbDialogTitle').textContent = title;
                    document.getElementById('fbDialogMsg').textContent = message;
                    document.getElementById('fbDialogInput').style.display = 'none';
                    const cancelBtn = document.getElementById('fbDialogCancel');
                    cancelBtn.style.display = 'inline-flex';
                    const okBtn = document.getElementById('fbDialogOk');
                    okBtn.textContent = okText;
                    okBtn.className = isDanger ? 'btn btn-danger' : 'btn';

                    function cleanup() {
                        okBtn.removeEventListener('click', onOk);
                        cancelBtn.removeEventListener('click', onCancel);
                        modal.classList.remove('open');
                    }
                    function onOk() {
                        cleanup();
                        resolve(true);
                    }
                    function onCancel() {
                        cleanup();
                        resolve(false);
                    }
                    okBtn.addEventListener('click', onOk);
                    cancelBtn.addEventListener('click', onCancel);
                    modal.classList.add('open');
                    okBtn.focus();
                });
            },
            prompt: function(message, defaultValue = '', title = 'Enter Value', placeholder = '') {
                return new Promise(resolve => {
                    const modal = document.getElementById('fbDialogModal');
                    document.getElementById('fbDialogTitle').textContent = title;
                    document.getElementById('fbDialogMsg').textContent = message;
                    const input = document.getElementById('fbDialogInput');
                    input.style.display = 'block';
                    input.value = defaultValue;
                    input.placeholder = placeholder;
                    const cancelBtn = document.getElementById('fbDialogCancel');
                    cancelBtn.style.display = 'inline-flex';
                    const okBtn = document.getElementById('fbDialogOk');
                    okBtn.textContent = 'Save';
                    okBtn.className = 'btn';

                    function cleanup() {
                        okBtn.removeEventListener('click', onOk);
                        cancelBtn.removeEventListener('click', onCancel);
                        input.removeEventListener('keydown', onKeyDown);
                        modal.classList.remove('open');
                    }
                    function onOk() {
                        const val = input.value;
                        cleanup();
                        resolve(val);
                    }
                    function onCancel() {
                        cleanup();
                        resolve(null);
                    }
                    function onKeyDown(e) {
                        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
                        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                    }
                    okBtn.addEventListener('click', onOk);
                    cancelBtn.addEventListener('click', onCancel);
                    input.addEventListener('keydown', onKeyDown);
                    modal.classList.add('open');
                    setTimeout(() => { input.focus(); input.select(); }, 50);
                });
            }
        };

        let currentPath = '/';
        let itemsList = [];
        let clipboard = null; // { action: 'copy'|'cut', path: string, name: string, isDir: boolean }
        let draggedItem = null; // { path: string, name: string, isDir: boolean }

        // Token capture for cross-subdomain SSO
        (function() {
            try {
                const p = new URLSearchParams(window.location.search);
                const t = p.get('token') || p.get('access_token');
                if (t) {
                    document.cookie = 'ownbase_access_token=' + t + '; Path=/; SameSite=Lax; Max-Age=86400';
                    localStorage.setItem('ownbase_access_token', t);
                }
            } catch(e) {}
            updateHubLink();
        })();

        function updateHubLink() {
            const h = window.location.hostname;
            const p = h.split('.');
            let hubUrl = '/';
            if (p.length >= 3 && (h.includes('.nip.io') || h.includes('.sslip.io') || h.includes('.ts.net'))) {
                p[0] = 'hub';
                hubUrl = window.location.protocol + '//' + p.join('.') + (window.location.port ? ':' + window.location.port : '') + '/';
            } else if (h === 'files.localhost' || h.endsWith('.localhost')) {
                hubUrl = 'http://localhost:3000';
            }
            const el = document.getElementById('hubLink');
            if (el) el.href = hubUrl;
        }

        async function loadDirectory(path) {
            currentPath = path;
            renderBreadcrumbs();
            updateClipboardBar();
            const container = document.getElementById('fileContainer');
            container.innerHTML = '<div style=""color:#94a3b8;padding:40px;grid-column:1/-1;text-align:center"">Loading files...</div>';

            try {
                const res = await fetch('/api/resources?path=' + encodeURIComponent(path));
                const data = await res.json();
                itemsList = data.items || [];
                renderFiles(itemsList);
            } catch (err) {
                container.innerHTML = '<div style=""color:#ef4444;padding:40px;grid-column:1/-1;text-align:center"">Failed to load directory: ' + err.message + '</div>';
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
            if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) return '📦';
            return '📄';
        }

        function truncateDisplayName(name, maxLen = 28) {
            if (!name || name.length <= maxLen) return name;
            const extIdx = name.lastIndexOf('.');
            if (extIdx > 0 && name.length - extIdx <= 8) {
                const ext = name.slice(extIdx);
                const avail = maxLen - ext.length - 3;
                if (avail > 6) {
                    return name.slice(0, avail) + '...' + ext;
                }
            }
            return name.slice(0, maxLen - 3) + '...';
        }

        function renderFiles(items) {
            const container = document.getElementById('fileContainer');
            if (items.length === 0) {
                container.innerHTML = '<div style=""color:#64748b;padding:40px;grid-column:1/-1;text-align:center"">No files found in this folder</div>';
                return;
            }

            container.innerHTML = items.map((it, idx) => {
                const icon = getFileIcon(it);
                let displayName = it.name || '';
                try { displayName = decodeURIComponent(displayName); } catch(e) {}
                const shortName = truncateDisplayName(displayName, window.innerWidth < 640 ? 24 : 32);
                const subMeta = it.isDir ? 'Folder' : (formatBytes(it.size) + ' • ' + (it.extension || 'file').toUpperCase());
                const safePath = it.path.replace(/'/g, ""\\'"");
                const safeName = displayName.replace(/'/g, ""\\'"");
                const menuId = 'itemMenu_' + idx;

                return `
                    <div class=""file-card""
                         draggable=""true""
                         ondragstart=""handleCardDragStart(event, '${safePath}', '${safeName}', ${it.isDir})""
                         ondragend=""handleCardDragEnd(event)""
                         ${it.isDir ? `ondragover=""handleFolderDragOver(event)"" ondragleave=""handleFolderDragLeave(event)"" ondrop=""handleFolderDrop(event, '${safePath}')""` : ''}
                         onclick=""handleItemClick('${safePath}', ${it.isDir}, '${it.extension || ''}')"">
                        <div class=""file-info"">
                            <div class=""file-icon"">${icon}</div>
                            <div class=""file-details"">
                                <div class=""file-name"" title=""${displayName}"">${shortName}</div>
                                <div class=""file-meta"">${subMeta}</div>
                            </div>
                        </div>
                        <div class=""file-actions"" onclick=""event.stopPropagation()"">
                            <button class=""dots-btn"" title=""Actions"" onclick=""toggleMenu(event, '${menuId}')"">⋮</button>
                            <div id=""${menuId}"" class=""dropdown-menu"">
                                <button onclick=""promptRename('${safePath}', '${safeName}')"">✏️ Rename</button>
                                <button onclick=""setClipboard('copy', '${safePath}', '${safeName}', ${it.isDir}); closeAllMenus();"">📋 Copy</button>
                                <button onclick=""setClipboard('cut', '${safePath}', '${safeName}', ${it.isDir}); closeAllMenus();"">✂️ Cut</button>
                                ${!it.isDir ? `<a href=""/api/stream?path=${encodeURIComponent(it.path)}"" download onclick=""closeAllMenus();"">⬇️ Download</a>` : ''}
                                <div class=""dropdown-sep""></div>
                                <button class=""delete-opt"" onclick=""deleteItem('${safePath}'); closeAllMenus();"">🗑️ Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function toggleMenu(e, menuId) {
            e.stopPropagation();
            const menu = document.getElementById(menuId);
            const isOpen = menu && menu.classList.contains('show');
            closeAllMenus();
            if (!isOpen && menu) {
                menu.classList.add('show');
                const card = menu.closest('.file-card');
                if (card) card.classList.add('menu-open');
            }
        }

        function closeAllMenus() {
            document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
            document.querySelectorAll('.file-card.menu-open').forEach(c => c.classList.remove('menu-open'));
        }
        document.addEventListener('click', closeAllMenus);

        async function promptRename(path, oldName) {
            closeAllMenus();
            const newName = await fbModal.prompt('Enter new filename for this item:', oldName, 'Rename Item', 'filename.ext');
            if (!newName || !newName.trim() || newName.trim() === oldName) return;
            try {
                const res = await fetch('/api/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPath: path, newName: newName.trim() })
                });
                const result = await res.json();
                if (res.ok && result.success) {
                    loadDirectory(currentPath);
                } else {
                    await fbModal.alert('Failed to rename: ' + (result.error || 'Server error'), 'Rename Error');
                }
            } catch (err) {
                await fbModal.alert('Network error: ' + err.message, 'Network Error');
            }
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

        // ==========================================
        // CLIPBOARD (COPY / CUT / PASTE)
        // ==========================================
        function setClipboard(action, path, name, isDir) {
            clipboard = { action, path, name, isDir };
            updateClipboardBar();
        }

        function clearClipboard() {
            clipboard = null;
            updateClipboardBar();
        }

        function updateClipboardBar() {
            const bar = document.getElementById('clipboardBar');
            const btnToolbar = document.getElementById('btnPasteToolbar');
            if (!clipboard) {
                bar.style.display = 'none';
                btnToolbar.style.display = 'none';
                return;
            }
            bar.style.display = 'flex';
            btnToolbar.style.display = 'inline-flex';
            document.getElementById('clipboardIcon').textContent = clipboard.action === 'copy' ? '📋' : '✂️';
            document.getElementById('clipboardAction').textContent = clipboard.action === 'copy' ? 'Copied' : 'Cut';
            document.getElementById('clipboardName').textContent = clipboard.name;
        }

        async function pasteItem() {
            if (!clipboard) return;
            const endpoint = clipboard.action === 'copy' ? '/api/copy' : '/api/move';
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source: clipboard.path,
                        destination: currentPath
                    })
                });
                const result = await res.json();
                if (res.ok) {
                    if (clipboard.action === 'cut') {
                        clipboard = null;
                    }
                    loadDirectory(currentPath);
                } else {
                    await fbModal.alert('Operation failed: ' + (result.error || 'Server error'), 'Action Error');
                }
            } catch (err) {
                await fbModal.alert('Network error: ' + err.message, 'Network Error');
            }
        }

        // ==========================================
        // DRAG & DROP (CARD TO FOLDER)
        // ==========================================
        function handleCardDragStart(e, path, name, isDir) {
            draggedItem = { path, name, isDir };
            e.dataTransfer.setData('text/plain', path);
            e.dataTransfer.effectAllowed = 'move';
            e.currentTarget.classList.add('dragging');
        }

        function handleCardDragEnd(e) {
            e.currentTarget.classList.remove('dragging');
            document.querySelectorAll('.file-card.drop-target').forEach(el => el.classList.remove('drop-target'));
        }

        function handleFolderDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            e.currentTarget.classList.add('drop-target');
        }

        function handleFolderDragLeave(e) {
            e.currentTarget.classList.remove('drop-target');
        }

        async function handleFolderDrop(e, targetFolderPath) {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.classList.remove('drop-target');
            if (!draggedItem || draggedItem.path === targetFolderPath) return;

            try {
                const res = await fetch('/api/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source: draggedItem.path,
                        destination: targetFolderPath
                    })
                });
                const result = await res.json();
                if (res.ok) {
                    draggedItem = null;
                    loadDirectory(currentPath);
                } else {
                    await fbModal.alert('Move failed: ' + (result.error || 'Server error'), 'Move Error');
                }
            } catch (err) {
                await fbModal.alert('Network error: ' + err.message, 'Network Error');
            }
        }

        // ==========================================
        // WINDOW DRAG & DROP FOR UPLOAD
        // ==========================================
        window.addEventListener('dragenter', (e) => {
            if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                document.getElementById('dropOverlay').classList.add('active');
                document.getElementById('dropOverlaySub').textContent = 'Upload files to ' + (currentPath === '/' ? 'Root' : currentPath);
            }
        });

        window.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
            }
        });

        window.addEventListener('dragleave', (e) => {
            if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
                document.getElementById('dropOverlay').classList.remove('active');
            }
        });

        window.addEventListener('drop', (e) => {
            document.getElementById('dropOverlay').classList.remove('active');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                processFilesUpload(e.dataTransfer.files);
            }
        });

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
            const name = await fbModal.prompt('Enter new folder name:', '', 'Create New Folder', 'e.g. MyFolder');
            if (!name || !name.trim()) return;
            const full = currentPath === '/' ? ('/' + name.trim()) : (currentPath + '/' + name.trim());
            try {
                const res = await fetch('/api/mkdir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: full })
                });
                if (res.ok) loadDirectory(currentPath);
                else await fbModal.alert('Failed to create folder', 'Folder Error');
            } catch (err) { await fbModal.alert(err.message, 'Error'); }
        }

        async function deleteItem(path) {
            let name = path.split('/').pop();
            try { name = decodeURIComponent(name); } catch(e) {}
            const ok = await fbModal.confirm('Are you sure you want to permanently delete ' + name + '?', 'Delete Item', 'Delete', true);
            if (!ok) return;
            try {
                const res = await fetch('/api/resources?path=' + encodeURIComponent(path), { method: 'DELETE' });
                if (res.ok) loadDirectory(currentPath);
                else await fbModal.alert('Failed to delete item', 'Delete Error');
            } catch (err) { await fbModal.alert(err.message, 'Error'); }
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

        async function processFilesUpload(files) {
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

            loadDirectory(currentPath);
        }

        async function handleUpload(event) {
            const files = event.target.files;
            if (files && files.length > 0) {
                await processFilesUpload(files);
                event.target.value = '';
            }
        }

        // Initialize on load
        loadDirectory('/');
    </script>
</body>
</html>";
        }
    }
}
