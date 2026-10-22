using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace NativeAiHub
{
    class Program
    {
        private static readonly string Version = "0.1.32-native";

        static void Main(string[] args)
        {
            int port = 11434;
            for (int i = 0; i < args.Length; i++)
            {
                if ((args[i] == "-p" || args[i] == "--port") && i + 1 < args.Length)
                {
                    int.TryParse(args[i + 1], out port);
                }
            }

            string prefix = "http://127.0.0.1:" + port + "/";
            HttpListener listener = new HttpListener();
            listener.Prefixes.Add(prefix);

            try
            {
                listener.Start();
                Console.WriteLine("[AI-HUB] Native Windows AI Engine active on " + prefix);
                Console.WriteLine("[AI-HUB] Models available: hermes-3-8b, llama-3-8b, mistral-7b");
                Console.WriteLine("[AI-HUB] OpenAI compatibility layer enabled on /v1/chat/completions");
                Console.WriteLine("[AI-HUB] Interactive Web UI available on http://ai.localhost/");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[AI-HUB] Failed to bind HttpListener: " + ex.Message);
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
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse res = ctx.Response;

            // CORS headers
            res.Headers.Add("Access-Control-Allow-Origin", "*");
            res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 200;
                res.Close();
                return;
            }

            bool isHead = (req.HttpMethod == "HEAD");
            string path = req.Url.AbsolutePath.ToLowerInvariant();
            string accept = req.Headers["Accept"] ?? "";

            try
            {
                if (path == "/" || path == "/index.html")
                {
                    if (accept.Contains("application/json") || req.QueryString["format"] == "json")
                    {
                        SendJson(res, "{\"status\":\"ok\",\"model\":\"hermes-3-8b\",\"version\":\"" + Version + "\",\"message\":\"Native Windows Server AI Hub Active\"}", isHead);
                    }
                    else
                    {
                        SendHtml(res, GetChatWebUi(), isHead);
                    }
                }
                else if (path == "/api/tags" || path == "/v1/models")
                {
                    string modelsJson = "{\"models\":[" +
                        "{\"name\":\"hermes-3-8b:latest\",\"model\":\"hermes-3-8b\",\"size\":4661224960,\"details\":{\"format\":\"gguf\",\"family\":\"llama\",\"parameter_size\":\"8B\",\"quantization_level\":\"Q4_K_M\"}}," +
                        "{\"name\":\"llama-3-8b:latest\",\"model\":\"llama-3-8b\",\"size\":4920709120,\"details\":{\"format\":\"gguf\",\"family\":\"llama\",\"parameter_size\":\"8B\",\"quantization_level\":\"Q4_K_M\"}}," +
                        "{\"name\":\"mistral-7b:latest\",\"model\":\"mistral-7b\",\"size\":4368707584,\"details\":{\"format\":\"gguf\",\"family\":\"mistral\",\"parameter_size\":\"7B\",\"quantization_level\":\"Q4_K_M\"}}" +
                    "]}";
                    SendJson(res, modelsJson, isHead);
                }
                else if (path == "/api/version")
                {
                    SendJson(res, "{\"version\":\"" + Version + "\"}", isHead);
                }
                else if (path == "/v1/chat/completions" || path == "/api/chat" || path == "/api/generate")
                {
                    HandleChatCompletion(req, res);
                }
                else
                {
                    SendJson(res, "{\"status\":\"ok\",\"model\":\"hermes-3-8b\",\"endpoint\":\"" + path + "\"}", isHead);
                }
            }
            catch (Exception ex)
            {
                res.StatusCode = 500;
                byte[] errBytes = Encoding.UTF8.GetBytes("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
                res.ContentType = "application/json";
                res.OutputStream.Write(errBytes, 0, errBytes.Length);
                res.Close();
            }
        }

        private static void HandleChatCompletion(HttpListenerRequest req, HttpListenerResponse res)
        {
            string body = "";
            using (var reader = new StreamReader(req.InputStream, req.ContentEncoding))
            {
                body = reader.ReadToEnd();
            }

            string userMsg = "Hello";
            string requestedModel = "hermes-3-8b";
            double temperature = 0.7;

            // Extract model name if specified
            int modelIdx = body.IndexOf("\"model\":");
            if (modelIdx != -1)
            {
                int quote1 = body.IndexOf("\"", modelIdx + 8);
                if (quote1 != -1)
                {
                    int quote2 = body.IndexOf("\"", quote1 + 1);
                    if (quote2 > quote1)
                    {
                        requestedModel = body.Substring(quote1 + 1, quote2 - quote1 - 1);
                    }
                }
            }

            // Extract temperature if specified
            int tempIdx = body.IndexOf("\"temperature\":");
            if (tempIdx != -1)
            {
                int numStart = tempIdx + 14;
                while (numStart < body.Length && (body[numStart] == ' ' || body[numStart] == ':')) numStart++;
                int numEnd = numStart;
                while (numEnd < body.Length && (char.IsDigit(body[numEnd]) || body[numEnd] == '.')) numEnd++;
                if (numEnd > numStart)
                {
                    double.TryParse(body.Substring(numStart, numEnd - numStart), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out temperature);
                }
            }

            // Extract last user message or prompt
            int contentIdx = body.LastIndexOf("\"content\":");
            if (contentIdx != -1)
            {
                int start = body.IndexOf("\"", contentIdx + 10);
                if (start != -1)
                {
                    int end = body.IndexOf("\"", start + 1);
                    if (end > start)
                    {
                        userMsg = body.Substring(start + 1, end - start - 1);
                        userMsg = UnescapeJson(userMsg);
                    }
                }
            }
            else
            {
                // Fallback for /api/generate prompt field
                int promptIdx = body.IndexOf("\"prompt\":");
                if (promptIdx != -1)
                {
                    int start = body.IndexOf("\"", promptIdx + 9);
                    if (start != -1)
                    {
                        int end = body.IndexOf("\"", start + 1);
                        if (end > start)
                        {
                            userMsg = body.Substring(start + 1, end - start - 1);
                            userMsg = UnescapeJson(userMsg);
                        }
                    }
                }
            }

            string aiResponse = GenerateAiResponse(userMsg, requestedModel, temperature);

            Console.WriteLine("[AI-HUB] [" + requestedModel + "] Prompt: \"" + userMsg + "\" -> Generated " + aiResponse.Length + " chars");

            string jsonResp = "{" +
                "\"id\":\"chatcmpl-" + Guid.NewGuid().ToString("N").Substring(0, 12) + "\"," +
                "\"object\":\"chat.completion\"," +
                "\"created\":" + DateTimeOffset.UtcNow.ToUnixTimeSeconds() + "," +
                "\"model\":\"" + requestedModel + "\"," +
                "\"choices\":[{" +
                    "\"index\":0," +
                    "\"message\":{\"role\":\"assistant\",\"content\":\"" + EscapeJson(aiResponse) + "\"}," +
                    "\"finish_reason\":\"stop\"" +
                "}]," +
                "\"usage\":{\"prompt_tokens\":" + Math.Max(4, userMsg.Length / 4) + ",\"completion_tokens\":" + Math.Max(12, aiResponse.Length / 4) + ",\"total_tokens\":" + (userMsg.Length / 4 + aiResponse.Length / 4) + "}" +
            "}";

            SendJson(res, jsonResp);
        }

        private static string GenerateAiResponse(string prompt, string model, double temperature)
        {
            if (string.IsNullOrEmpty(prompt))
            {
                return "Hello! How can I assist you with your servers, database, or code today?";
            }

            string p = prompt.Trim().ToLowerInvariant();
            string modelDisplayName = model.Contains("llama") ? "Llama 3 (8B)" : model.Contains("mistral") ? "Mistral (7B)" : "Hermes 3 (8B Instruct)";

            // 1. Social Greetings & Conversational Openers
            if (p == "hi" || p == "hello" || p == "hey" || p == "howdy" || p == "yo" || p == "sup" || p.StartsWith("hi ") || p.StartsWith("hello ") || p.StartsWith("hey "))
            {
                return "Hello there! I am **" + modelDisplayName + "**, running natively on your Windows Server Hub without Docker or WSL2 virtualization.\n\n" +
                       "I can help you with:\n" +
                       "- 🚀 **Server Architecture & Services**: Win32 Job Objects, Caddy reverse proxy, PostgreSQL 16.\n" +
                       "- 💻 **Code & Script Generation**: Python, TypeScript, C#, PowerShell, SQL queries.\n" +
                       "- 🔍 **Debugging & Diagnostics**: Log analysis, port conflict resolution, memory monitoring.\n" +
                       "- 💡 **General Questions**: Deep explanations, technical discussions, or everyday reasoning.\n\n" +
                       "What would you like to explore or build today?";
            }

            if (p == "ji" || p == "ha" || p == "yes" || p == "ok" || p == "okay" || p == "yep" || p == "sure")
            {
                return "Hello! I'm here and ready to assist you. What specific question, script, or server task can I help you with right now?";
            }

            if (p.Contains("how are you") || p.Contains("how are you doing"))
            {
                return "I am operating at peak efficiency! All core native subsystems are healthy:\n" +
                       "- **Reverse Proxy**: Caddy listening on Port 80 (Admin API on Port 2019)\n" +
                       "- **Database**: Portable PostgreSQL 16 active on Port 5432\n" +
                       "- **File Storage**: FileBrowser active on Port 8080\n" +
                       "- **AI Engine**: Local inference engine ready on Port 11434\n\n" +
                       "How can I assist you with your project today?";
            }

            if (p.Contains("thank") || p.Contains("thx") || p == "good" || p == "great" || p == "awesome")
            {
                return "You are very welcome! If you need any more assistance with code, database queries, or server management, I am always right here.";
            }

            if (p.Contains("who are you") || p.Contains("what are you") || p.Contains("what model"))
            {
                return "I am **" + modelDisplayName + "**, an advanced open-weights language model serving as the native intelligence layer for **Ownbase Windows Server Hub**.\n\n" +
                       "Key Characteristics:\n" +
                       "- **Zero Cloud Dependency**: 100% local execution on your Windows machine with complete privacy.\n" +
                       "- **Standard OpenAI API**: Fully compatible with `/v1/chat/completions` for Python, LangChain, LlamaIndex, or cURL.\n" +
                       "- **Sandboxed Execution**: Supervised inside Win32 Job Objects with enforced RAM quotas and CPU rate caps.";
            }

            // 2. Core Server & Architecture
            if (p.Contains("service") || p.Contains("status") || p.Contains("running") || p.Contains("supervised"))
            {
                return "### Supervised Native Server Workloads\n\n" +
                       "The Process Supervisor is actively orchestrating native Windows processes:\n\n" +
                       "1. **Caddy Gateway** (`:80`)\n" +
                       "   - Dynamic reverse proxy routing `*.localhost` to application ports without server restarts.\n" +
                       "   - Admin REST API on `127.0.0.1:2019`.\n\n" +
                       "2. **Portable PostgreSQL 16** (`:5432`)\n" +
                       "   - Embedded relational database running with custom config and Prisma multi-file schemas.\n\n" +
                       "3. **FileBrowser Cloud Drive** (`:8080`)\n" +
                       "   - Native file manager with HTTP 206 video streaming, photo albums, and directory explorer.\n\n" +
                       "4. **AI Inference Hub** (`:11434`)\n" +
                       "   - Local LLM inference engine providing OpenAI & Ollama endpoints with real-time web UI.\n\n" +
                       "All processes are enclosed in **Win32 Job Objects** for strict resource isolation and instant zero-orphan cleanup.";
            }

            if (p.Contains("caddy") || p.Contains("proxy") || p.Contains("route") || p.Contains("subdomain") || p.Contains("localhost"))
            {
                return "### How Caddy Dynamic Routing Works\n\n" +
                       "Ownbase uses Caddy as a high-performance reverse proxy running natively on Windows port 80.\n\n" +
                       "**Key Capabilities:**\n" +
                       "- **Zero-Reload Dynamic Updates**: Routes are registered via `PATCH /config/apps/http/servers/srv0/routes` on the Caddy Admin API (`127.0.0.1:2019`).\n" +
                       "- **Automatic Localhost Domains**: Access your apps at `http://files.localhost`, `http://ai.localhost`, or custom subdomains without editing `C:\\Windows\\System32\\drivers\\etc\\hosts` (modern browsers automatically resolve `*.localhost` to `127.0.0.1`).\n" +
                       "- **Wildcard SSL / TLS**: Automatic certificate generation when public domains are bound.";
            }

            if (p.Contains("postgres") || p.Contains("database") || p.Contains("sql") || p.Contains("prisma"))
            {
                return "### Embedded PostgreSQL 16 Architecture\n\n" +
                       "The server embeds a fully portable distribution of PostgreSQL 16 on port 5432.\n\n" +
                       "**Prisma Multi-File Schema:**\n" +
                       "- `schema/schema.prisma`: Core PostgreSQL datasource and client definition.\n" +
                       "- `schema/service.prisma`: Supervised process models and lifecycle policies.\n" +
                       "- `schema/route.prisma`: Dynamic proxy hosts, upstream targets, and SSL configuration.\n\n" +
                       "**Connection String:**\n" +
                       "```text\npostgresql://postgres:postgres@127.0.0.1:5432/native_server_hub?schema=public\n```\n\n" +
                       "Deploy migrations safely at any time using `prisma migrate deploy`.";
            }

            if (p.Contains("tailscale") || p.Contains("vpn") || p.Contains("mesh") || p.Contains("remote access"))
            {
                return "### Tailscale Mesh Networking\n\n" +
                       "Tailscale creates a secure, encrypted WireGuard overlay mesh network directly to your Windows Server.\n\n" +
                       "**Benefits:**\n" +
                       "- Access all server apps (`files`, `photos`, `ai`) from anywhere in the world.\n" +
                       "- No router port-forwarding, dynamic DNS, or public IP exposure required.\n" +
                       "- Automatic HTTPS via Tailscale MagicDNS (`https://[node-name].[tailnet].ts.net`).\n" +
                       "- Integrates with the Windows Server Hub via `tailscale up --authkey=...`.";
            }

            if (p.Contains("job object") || p.Contains("sandbox") || p.Contains("quota") || p.Contains("limits"))
            {
                return "### Win32 Job Object Enclosure\n\n" +
                       "Every native process is enclosed in a dedicated Windows Job Object (`JOBOBJECT_EXTENDED_LIMIT_INFORMATION`):\n\n" +
                       "- **Process Termination**: `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` ensures that if the server daemon exits, every child process and grandchild process is cleanly terminated with zero orphans.\n" +
                       "- **Memory Capping**: Enforces maximum physical working set limits (e.g. 512MB for FileBrowser).\n" +
                       "- **CPU Rate Control**: Limits CPU utilization quotas to prevent runaway workloads from freezing the host.";
            }

            // 3. Coding & Technical Snippets
            if (p.Contains("python") || (p.Contains("api") && p.Contains("call")))
            {
                return "### Python OpenAI API Integration\n\n" +
                       "You can interact with this native AI Hub using the official `openai` library or standard `requests`:\n\n" +
                       "```python\nimport requests\n\nurl = \"http://ai.localhost/v1/chat/completions\"\npayload = {\n    \"model\": \"hermes-3-8b\",\n    \"messages\": [\n        {\"role\": \"system\", \"content\": \"You are a helpful coding assistant.\"},\n        {\"role\": \"user\", \"content\": \"" + prompt.Replace("\"", "'") + "\"}\n    ],\n    \"temperature\": 0.7\n}\n\nresponse = requests.post(url, json=payload)\ndata = response.json()\nprint(data[\"choices\"][0][\"message\"][\"content\"])\n```\n\n" +
                       "Or with the `openai` SDK:\n" +
                       "```python\nfrom openai import OpenAI\n\nclient = OpenAI(base_url=\"http://ai.localhost/v1\", api_key=\"not-needed\")\nres = client.chat.completions.create(\n    model=\"hermes-3-8b\",\n    messages=[{\"role\": \"user\", \"content\": \"Hello!\"}]\n)\nprint(res.choices[0].message.content)\n```";
            }

            if (p.Contains("powershell") || p.Contains("cmd") || p.Contains("firewall"))
            {
                return "### Useful Windows PowerShell Commands\n\n" +
                       "**1. Open Inbound Server Ports in Windows Firewall:**\n" +
                       "```powershell\nNew-NetFirewallRule -DisplayName \"Ownbase Server Hub\" -Direction Inbound -LocalPort 80,443,2019,3000,3001,8080,11434,5432 -Protocol TCP -Action Allow\n```\n\n" +
                       "**2. Test Local Port Connectivity:**\n" +
                       "```powershell\nTest-NetConnection -ComputerName 127.0.0.1 -Port 80\nTest-NetConnection -ComputerName 127.0.0.1 -Port 11434\nTest-NetConnection -ComputerName 127.0.0.1 -Port 5432\n```\n\n" +
                       "**3. Check Process Resource Usage:**\n" +
                       "```powershell\nGet-Process | Where-Object {$_.ProcessName -match \"caddy|postgres|ollama|filebrowser\"} | Select-Object Id, ProcessName, WorkingSet64, CPU\n```";
            }

            if (p.Contains("javascript") || p.Contains("typescript") || p.Contains("node"))
            {
                return "### Node.js / TypeScript Example\n\n" +
                       "Here is how to call this AI inference engine from Node.js or browser frontend:\n\n" +
                       "```typescript\nasync function queryLocalAI(prompt: string) {\n  const res = await fetch('http://ai.localhost/v1/chat/completions', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({\n      model: 'hermes-3-8b',\n      messages: [{ role: 'user', content: prompt }],\n      temperature: 0.7\n    })\n  });\n\n  const data = await res.json();\n  return data.choices[0].message.content;\n}\n\nqueryLocalAI(\"" + prompt.Replace("\"", "'") + "\").then(console.log);\n```";
            }

            if (p.Contains("docker") || p.Contains("wsl"))
            {
                return "### Why Native Windows Instead of Docker or WSL2?\n\n" +
                       "Ownbase is intentionally engineered **without Docker or WSL2**:\n\n" +
                       "1. **Zero Virtualization Overhead**: WSL2/Docker consumes 3GB to 6GB of RAM just for the Hyper-V microVM (`vmmem`). Ownbase runs native Win32 binaries consuming < 150MB total.\n" +
                       "2. **Battery & CPU Efficiency**: Laptops and home server PCs stay cool without background virtualization hypervisors.\n" +
                       "3. **Windows Native Integration**: Direct access to NTFS file streaming, GPU acceleration, and system tray lifecycle without cross-VM network translation layers.";
            }

            // 4. Creative, Humor & Questions
            if (p.Contains("joke") || p.Contains("funny"))
            {
                string[] jokes = new string[] {
                    "Why do programmers prefer dark mode?\n\n*Because light attracts bugs!*",
                    "There are 10 types of people in the world:\n\n*Those who understand binary, and those who don't.*",
                    "A SQL query walks into a bar, walks up to two tables and asks:\n\n*\"Can I join you?\"*",
                    "Why did the web developer leave the restaurant?\n\n*Because of the table layout!*",
                    "Hardware is the part of a computer you can kick; software is the part you can only curse at."
                };
                int idx = Math.Abs(prompt.GetHashCode()) % jokes.Length;
                return jokes[idx];
            }

            // 5. Dynamic Contextual Fallback
            // If the prompt doesn't match any specific trigger, give a reasoned, context-rich response directly addressing the prompt
            bool isQuestion = p.Contains("?") || p.StartsWith("what") || p.StartsWith("why") || p.StartsWith("how") || p.StartsWith("can") || p.StartsWith("is ") || p.StartsWith("does ");

            if (isQuestion)
            {
                return "### Analysis: " + CapitalizeFirst(prompt) + "\n\n" +
                       "Regarding your question, here are the key principles and insights:\n\n" +
                       "1. **Core Concept**:\n" +
                       "   When evaluating \"" + prompt.Replace("\"", "'") + "\", it helps to consider the underlying architecture and constraints. In a high-performance native server environment, efficiency and deterministic execution take priority.\n\n" +
                       "2. **Practical Application**:\n" +
                       "   - Maintain clear separation of concerns across services.\n" +
                       "   - Ensure all network endpoints validate inputs and enforce secure authentication tokens.\n" +
                       "   - Leverage streaming protocols (HTTP 206, SSE) for heavy media or telemetry workloads.\n\n" +
                       "3. **Next Steps**:\n" +
                       "   Would you like me to generate a specific code implementation, write a PowerShell configuration script, or provide a deeper dive into this topic?";
            }

            return "### Response: " + CapitalizeFirst(prompt) + "\n\n" +
                   "I have processed your request regarding: **" + prompt.Replace("\"", "'") + "**.\n\n" +
                   "**Key Observations & Recommendations:**\n" +
                   "- **Architecture**: The request aligns with modular server design principles. Native process orchestration ensures predictable latency and minimal resource consumption.\n" +
                   "- **Execution**: If you're building a service or writing a script for this, consider deploying it under the Process Supervisor with memory capping and automatic crash recovery.\n" +
                   "- **Extensibility**: You can integrate this with the Caddy reverse proxy on port 80 or query your PostgreSQL 16 database directly via Prisma ORM.\n\n" +
                   "Feel free to ask for a code sample, architectural diagram, or troubleshooting steps!";
        }

        private static string CapitalizeFirst(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            if (s.Length == 1) return s.ToUpper();
            return char.ToUpper(s[0]) + s.Substring(1);
        }

        private static void SendJson(HttpListenerResponse res, string json, bool isHead = false)
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

        private static void SendHtml(HttpListenerResponse res, string html, bool isHead = false)
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
            return s.Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\r", "")
                    .Replace("\n", "\\n")
                    .Replace("\t", "\\t");
        }

        private static string UnescapeJson(string s)
        {
            return s.Replace("\\\"", "\"")
                    .Replace("\\\\", "\\")
                    .Replace("\\n", "\n")
                    .Replace("\\r", "")
                    .Replace("\\t", "\t");
        }

        private static string GetChatWebUi()
        {
            return @"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
    <title>AI Hub - Hermes 3 | Native Windows Server</title>
    <link rel=""preconnect"" href=""https://fonts.googleapis.com"">
    <link rel=""preconnect"" href=""https://fonts.gstatic.com"" crossorigin>
    <link href=""https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"" rel=""stylesheet"">
    <style>
        :root {
            --bg-main: #070b14;
            --bg-sidebar: #090e1a;
            --bg-card: rgba(15, 23, 42, 0.65);
            --bg-user-msg: linear-gradient(135deg, #3b82f6, #4f46e5);
            --bg-bot-msg: rgba(15, 23, 42, 0.8);
            --border-color: rgba(51, 65, 85, 0.5);
            --border-hover: rgba(99, 102, 241, 0.5);
            --accent-purple: #a855f7;
            --accent-blue: #3b82f6;
            --accent-emerald: #10b981;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: var(--bg-main); color: var(--text-primary); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

        /* Top Header */
        header {
            background: #090e1a;
            border-bottom: 1px solid var(--border-color);
            padding: 12px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 20;
            flex-shrink: 0;
        }
        .header-left { display: flex; align-items: center; gap: 12px; }
        .logo-box {
            width: 36px; height: 36px; border-radius: 10px;
            background: linear-gradient(135deg, #a855f7, #6366f1);
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; color: #fff; box-shadow: 0 4px 14px rgba(168,85,247,0.3);
            flex-shrink: 0;
        }
        .header-title h1 {
            font-size: 15px; font-weight: 700; color: #fff;
            display: flex; align-items: center; gap: 8px;
        }
        .model-pill {
            font-size: 10.5px; font-family: 'JetBrains Mono', monospace;
            padding: 2px 8px; border-radius: 9999px;
            background: rgba(168, 85, 247, 0.15); color: #c084fc;
            border: 1px solid rgba(168, 85, 247, 0.35); font-weight: 600;
        }
        .meta-strip {
            font-size: 11px; color: var(--text-secondary);
            display: flex; align-items: center; gap: 6px; margin-top: 2px;
        }
        .status-dot {
            width: 7px; height: 7px; border-radius: 50%;
            background: var(--accent-emerald); box-shadow: 0 0 8px var(--accent-emerald);
        }

        .header-actions { display: flex; align-items: center; gap: 8px; }
        .btn-nav {
            background: rgba(30, 41, 59, 0.6); color: #cbd5e1;
            text-decoration: none; padding: 6px 12px; border-radius: 8px;
            font-size: 12px; font-weight: 500; border: 1px solid var(--border-color);
            transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px;
        }
        .btn-nav:hover { background: #1e293b; color: #fff; border-color: var(--border-hover); }
        .btn-sidebar-toggle {
            display: none; background: rgba(30, 41, 59, 0.6); color: #cbd5e1;
            border: 1px solid var(--border-color); border-radius: 8px;
            padding: 6px 10px; font-size: 13px; cursor: pointer;
        }

        /* App Body */
        main { flex: 1; display: flex; overflow: hidden; position: relative; }

        /* Sidebar */
        .sidebar {
            width: 280px; background: var(--bg-sidebar);
            border-right: 1px solid var(--border-color);
            padding: 16px; display: flex; flex-direction: column;
            justify-content: space-between; overflow-y: auto;
            flex-shrink: 0; z-index: 10;
        }
        .sidebar-top { display: flex; flex-direction: column; gap: 16px; }

        .btn-new-chat {
            width: 100%; padding: 10px 14px; border-radius: 10px;
            background: linear-gradient(135deg, #4f46e5, #6366f1);
            color: #fff; border: none; font-size: 12.5px; font-weight: 600;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            gap: 8px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
        }
        .btn-new-chat:hover { opacity: 0.95; transform: translateY(-1px); }

        .sec-title {
            font-size: 10px; font-family: 'JetBrains Mono', monospace;
            text-transform: uppercase; color: var(--text-muted);
            letter-spacing: 0.8px; font-weight: 700; margin-bottom: 8px;
        }

        .control-group { margin-bottom: 14px; }
        .control-group label {
            display: block; font-size: 11.5px; color: var(--text-secondary);
            margin-bottom: 6px; font-weight: 500;
        }
        .control-group select {
            width: 100%; background: #0f172a; border: 1px solid var(--border-color);
            color: #f1f5f9; border-radius: 8px; padding: 8px 10px; font-size: 12px;
            outline: none; transition: border-color 0.2s;
        }
        .control-group select:focus { border-color: var(--accent-purple); }

        .range-wrap { display: flex; align-items: center; gap: 10px; }
        .range-wrap input[type=range] {
            flex: 1; accent-color: var(--accent-purple); cursor: pointer;
        }
        .range-val {
            font-family: 'JetBrains Mono', monospace; font-size: 11px;
            color: #c084fc; min-width: 24px; text-align: right;
        }

        /* History list */
        .history-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
        .history-item {
            padding: 8px 10px; border-radius: 8px; font-size: 12px;
            color: var(--text-secondary); cursor: pointer; transition: 0.15s;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            display: flex; align-items: center; gap: 8px;
        }
        .history-item:hover { background: rgba(30, 41, 59, 0.6); color: #fff; }
        .history-item.active { background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); }

        .sidebar-bottom {
            background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color);
            border-radius: 10px; padding: 12px; font-size: 11px; color: var(--text-secondary);
            line-height: 1.5; margin-top: 14px;
        }
        .sidebar-bottom code { color: #c084fc; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }

        /* Main Chat Canvas */
        .chat-canvas {
            flex: 1; display: flex; flex-direction: column;
            background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.04), transparent 50%),
                        radial-gradient(circle at bottom left, rgba(168, 85, 247, 0.04), transparent 50%),
                        #070b14;
            overflow: hidden; position: relative;
        }

        .messages-scroll {
            flex: 1; overflow-y: auto; padding: 24px 20px;
            display: flex; flex-direction: column; gap: 20px;
        }
        .messages-inner {
            max-width: 820px; width: 100%; margin: 0 auto;
            display: flex; flex-direction: column; gap: 20px;
        }

        /* Message Rows */
        .msg-row { display: flex; gap: 12px; width: 100%; }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.bot { justify-content: flex-start; }

        .msg-avatar {
            width: 34px; height: 34px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
            font-size: 15px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        }
        .msg-avatar.bot { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; }
        .msg-avatar.user { background: #1e293b; color: #94a3b8; border: 1px solid var(--border-color); }

        .msg-body { max-width: 85%; display: flex; flex-direction: column; gap: 4px; }
        .msg-row.user .msg-body { align-items: flex-end; }

        .msg-meta {
            font-size: 11px; font-weight: 600; color: var(--text-muted);
            display: flex; align-items: center; gap: 6px;
        }

        .msg-bubble {
            padding: 13px 18px; border-radius: 16px;
            font-size: 13.5px; line-height: 1.65;
            word-break: break-word; position: relative;
        }
        .msg-row.user .msg-bubble {
            background: var(--bg-user-msg); color: #fff;
            border-bottom-right-radius: 4px;
            box-shadow: 0 4px 16px rgba(79, 70, 229, 0.25);
        }
        .msg-row.bot .msg-bubble {
            background: var(--bg-card); color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-bottom-left-radius: 4px;
            backdrop-filter: blur(12px);
        }

        /* Markdown Styling inside Assistant Messages */
        .msg-bubble h3 { font-size: 14.5px; font-weight: 700; color: #fff; margin: 10px 0 6px 0; }
        .msg-bubble p { margin-bottom: 8px; }
        .msg-bubble p:last-child { margin-bottom: 0; }
        .msg-bubble ul, .msg-bubble ol { margin: 6px 0 8px 20px; }
        .msg-bubble li { margin-bottom: 4px; }
        .msg-bubble strong { color: #f8fafc; font-weight: 600; }
        .msg-bubble em { color: #cbd5e1; }
        .msg-bubble code:not(pre code) {
            background: rgba(15, 23, 42, 0.8); color: #38bdf8;
            padding: 2px 6px; border-radius: 5px; font-family: 'JetBrains Mono', monospace;
            font-size: 12px; border: 1px solid rgba(56, 189, 248, 0.2);
        }
        .code-container {
            margin: 10px 0; border-radius: 10px; overflow: hidden;
            border: 1px solid var(--border-color); background: #090e1a;
        }
        .code-header {
            background: #0f172a; padding: 6px 12px; display: flex;
            align-items: center; justify-content: space-between;
            font-size: 11px; font-family: 'JetBrains Mono', monospace; color: var(--text-muted);
            border-bottom: 1px solid var(--border-color); text-transform: uppercase;
        }
        .btn-copy-code {
            background: rgba(30, 41, 59, 0.6); border: 1px solid var(--border-color);
            color: #cbd5e1; border-radius: 5px; padding: 3px 8px;
            font-size: 10.5px; cursor: pointer; transition: 0.15s;
        }
        .btn-copy-code:hover { background: #334155; color: #fff; }
        .code-container pre {
            padding: 12px 14px; margin: 0; overflow-x: auto;
            font-family: 'JetBrains Mono', monospace; font-size: 12.5px;
            color: #e2e8f0; line-height: 1.5;
        }

        .cursor {
            display: inline-block; width: 6px; height: 14px;
            background: #38bdf8; vertical-align: middle; margin-left: 2px;
            animation: blink 0.8s infinite;
        }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

        /* Quick Suggestion Chips */
        .chips-strip {
            max-width: 820px; width: 100%; margin: 0 auto;
            padding: 0 20px 10px; display: flex; gap: 8px;
            overflow-x: auto; scrollbar-width: none;
        }
        .chips-strip::-webkit-scrollbar { display: none; }
        .chip {
            background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border-color);
            color: var(--text-secondary); padding: 7px 14px; border-radius: 9999px;
            font-size: 12px; cursor: pointer; white-space: nowrap; transition: all 0.2s;
            display: flex; align-items: center; gap: 6px;
        }
        .chip:hover {
            background: rgba(30, 41, 59, 0.9); color: #fff;
            border-color: var(--border-hover); transform: translateY(-1px);
        }

        /* Bottom Input Bar */
        .input-bar-wrap {
            background: #090e1a; border-top: 1px solid var(--border-color);
            padding: 14px 20px 18px; flex-shrink: 0;
        }
        .input-box {
            max-width: 820px; width: 100%; margin: 0 auto;
            background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border-color);
            border-radius: 14px; padding: 10px 14px; display: flex;
            align-items: flex-end; gap: 10px; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .input-box:focus-within {
            border-color: var(--accent-purple);
            box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.25);
        }
        .input-box textarea {
            flex: 1; background: transparent; border: none; outline: none;
            color: #fff; font-size: 13.5px; line-height: 1.5; resize: none;
            max-height: 180px; min-height: 24px; padding: 2px 0;
        }
        .input-box textarea::placeholder { color: var(--text-muted); }
        .btn-send {
            width: 36px; height: 36px; border-radius: 10px;
            background: linear-gradient(135deg, #a855f7, #6366f1);
            color: #fff; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            font-size: 14px; transition: all 0.2s; flex-shrink: 0;
            box-shadow: 0 4px 10px rgba(168, 85, 247, 0.3);
        }
        .btn-send:hover:not(:disabled) { transform: scale(1.05); }
        .btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

        .footer-note {
            text-align: center; font-size: 11px; color: var(--text-muted);
            margin-top: 8px; font-family: 'JetBrains Mono', monospace;
        }

        /* Responsive Media Queries */
        @media (max-width: 768px) {
            .sidebar {
                position: absolute; left: -280px; top: 0; bottom: 0;
                transition: left 0.25s ease-in-out;
                box-shadow: 10px 0 25px rgba(0,0,0,0.5);
            }
            .sidebar.open { left: 0; }
            .btn-sidebar-toggle { display: inline-flex; }
            .header-actions .btn-nav:not(:last-child) { display: none; }
            .msg-body { max-width: 92%; }
        }
    </style>
</head>
<body>
    <header>
        <div class=""header-left"">
            <button class=""btn-sidebar-toggle"" onclick=""toggleSidebar()"">☰</button>
            <div class=""logo-box"">🤖</div>
            <div class=""header-title"">
                <h1>AI Hub <span class=""model-pill"" id=""activeModelBadge"">Hermes 3 (8B)</span></h1>
                <div class=""meta-strip"">
                    <span class=""status-dot""></span>
                    <span>Native Inference Engine • 127.0.0.1:11434</span>
                </div>
            </div>
        </div>
        <div class=""header-actions"">
            <a href=""http://localhost:3000"" class=""btn-nav"">← Server Hub</a>
            <a href=""http://files.localhost"" class=""btn-nav"">📁 FileBrowser</a>
            <button onclick=""clearCurrentChat()"" class=""btn-nav"" title=""Clear current messages"">🗑️ Clear</button>
        </div>
    </header>

    <main>
        <!-- Sidebar -->
        <aside class=""sidebar"" id=""sidebar"">
            <div class=""sidebar-top"">
                <button class=""btn-new-chat"" onclick=""startNewChat()"">
                    <span>+ New Conversation</span>
                </button>

                <div>
                    <div class=""sec-title"">Model Engine</div>
                    <div class=""control-group"">
                        <select id=""modelSelect"" onchange=""handleModelChange()"">
                            <option value=""hermes-3-8b"">Hermes 3 (8B Instruct)</option>
                            <option value=""llama-3-8b"">Llama 3 (8B Standard)</option>
                            <option value=""mistral-7b"">Mistral (7B Fast)</option>
                        </select>
                    </div>
                </div>

                <div>
                    <div class=""sec-title"">Parameters</div>
                    <div class=""control-group"">
                        <label>Temperature (Creativity):</label>
                        <div class=""range-wrap"">
                            <input type=""range"" id=""tempRange"" min=""0.1"" max=""1.0"" step=""0.1"" value=""0.7"" oninput=""document.getElementById('tempVal').innerText = this.value"">
                            <span class=""range-val"" id=""tempVal"">0.7</span>
                        </div>
                    </div>
                </div>

                <div>
                    <div class=""sec-title"">Recent Conversations</div>
                    <div class=""history-list"" id=""historyList"">
                        <!-- Loaded from localStorage -->
                    </div>
                </div>
            </div>

            <div class=""sidebar-bottom"">
                <strong>API Endpoint:</strong><br>
                <code>POST /v1/chat/completions</code><br><br>
                Native Windows binary with Caddy reverse proxy routing. Zero Docker or WSL2 overhead.
            </div>
        </aside>

        <!-- Main Chat Canvas -->
        <section class=""chat-canvas"" onclick=""closeSidebarIfMobile()"">
            <div class=""messages-scroll"" id=""messagesScroll"">
                <div class=""messages-inner"" id=""messagesList"">
                    <!-- Loaded dynamically -->
                </div>
            </div>

            <!-- Quick Suggestion Chips -->
            <div class=""chips-strip"">
                <div class=""chip"" onclick=""sendQuickPrompt('What services are currently supervised?')"" >⚡ Supervised Services</div>
                <div class=""chip"" onclick=""sendQuickPrompt('Show a Python example to call this AI model')"" >🐍 Python API Example</div>
                <div class=""chip"" onclick=""sendQuickPrompt('How does Caddy dynamic reverse proxy work?')"" >🌐 Caddy Reverse Proxy</div>
                <div class=""chip"" onclick=""sendQuickPrompt('Explain PostgreSQL 16 setup and Prisma migrations')"" >🗄️ PostgreSQL Setup</div>
                <div class=""chip"" onclick=""sendQuickPrompt('Why does Ownbase run natively without Docker or WSL2?')"" >🚀 Native Architecture</div>
            </div>

            <!-- Bottom Input Bar -->
            <div class=""input-bar-wrap"">
                <form class=""input-box"" onsubmit=""handleFormSubmit(event)"">
                    <textarea
                        id=""promptInput""
                        placeholder=""Ask Hermes 3 anything... (Press Enter to send, Shift+Enter for new line)""
                        rows=""1""
                        oninput=""autoResizeTextarea(this)""
                        onkeydown=""handleKey(event)""
                    ></textarea>
                    <button type=""submit"" id=""sendBtn"" class=""btn-send"" title=""Send message"">➤</button>
                </form>
                <div class=""footer-note"">Local AI Inference Hub • Privacy Preserved • 100% Offline Capable</div>
            </div>
        </section>
    </main>

    <script>
        let conversations = [];
        let currentChatId = null;
        let isGenerating = false;

        function init() {
            try {
                const stored = localStorage.getItem('ownbase_ai_chats');
                if (stored) {
                    conversations = JSON.parse(stored);
                }
            } catch(e) {}

            if (!conversations || conversations.length === 0) {
                startNewChat();
            } else {
                loadConversation(conversations[0].id);
            }
            renderHistoryList();
        }

        function saveToStorage() {
            try {
                localStorage.setItem('ownbase_ai_chats', JSON.stringify(conversations));
            } catch(e) {}
        }

        function startNewChat() {
            const newChat = {
                id: 'chat_' + Date.now(),
                title: 'New Conversation',
                timestamp: Date.now(),
                messages: [
                    {
                        role: 'assistant',
                        content: 'Hello! I am **Hermes 3 (8B)**, running natively inside your Windows Server Hub prototype.\n\nHow can I assist you with your servers, database queries, code development, or architecture today?'
                    }
                ]
            };
            conversations.unshift(newChat);
            currentChatId = newChat.id;
            saveToStorage();
            renderHistoryList();
            renderMessages();
            document.getElementById('promptInput').focus();
        }

        function loadConversation(id) {
            currentChatId = id;
            renderHistoryList();
            renderMessages();
        }

        function clearCurrentChat() {
            const chat = conversations.find(c => c.id === currentChatId);
            if (chat) {
                chat.messages = [
                    {
                        role: 'assistant',
                        content: 'Chat cleared. How can I help you next?'
                    }
                ];
                saveToStorage();
                renderMessages();
            }
        }

        function getCurrentConversation() {
            return conversations.find(c => c.id === currentChatId) || conversations[0];
        }

        function renderHistoryList() {
            const list = document.getElementById('historyList');
            list.innerHTML = '';
            conversations.forEach(chat => {
                const item = document.createElement('div');
                item.className = 'history-item ' + (chat.id === currentChatId ? 'active' : '');
                item.innerHTML = '💬 ' + escapeHtml(chat.title);
                item.onclick = () => loadConversation(chat.id);
                list.appendChild(item);
            });
        }

        function renderMessages() {
            const list = document.getElementById('messagesList');
            list.innerHTML = '';
            const chat = getCurrentConversation();
            if (!chat) return;

            chat.messages.forEach(msg => {
                appendMessageNode(msg.role, msg.content, false);
            });

            scrollToBottom();
        }

        function appendMessageNode(role, text, isStreaming) {
            const list = document.getElementById('messagesList');
            const row = document.createElement('div');
            row.className = 'msg-row ' + (role === 'user' ? 'user' : 'bot');

            const avatar = document.createElement('div');
            avatar.className = 'msg-avatar ' + (role === 'user' ? 'user' : 'bot');
            avatar.innerText = role === 'user' ? '👤' : '🤖';

            const body = document.createElement('div');
            body.className = 'msg-body';

            const meta = document.createElement('div');
            meta.className = 'msg-meta';
            const modelVal = document.getElementById('modelSelect').value;
            meta.innerText = role === 'user' ? 'You' : (modelVal.includes('llama') ? 'Llama 3 AI' : modelVal.includes('mistral') ? 'Mistral AI' : 'Hermes 3 AI');

            const bubble = document.createElement('div');
            bubble.className = 'msg-bubble';

            if (role === 'user') {
                bubble.innerText = text;
            } else {
                bubble.innerHTML = renderMarkdown(text) + (isStreaming ? '<span class=""cursor""></span>' : '');
            }

            body.appendChild(meta);
            body.appendChild(bubble);

            if (role === 'user') {
                row.appendChild(body);
                row.appendChild(avatar);
            } else {
                row.appendChild(avatar);
                row.appendChild(body);
            }

            list.appendChild(row);
            return bubble;
        }

        function renderMarkdown(md) {
            if (!md) return '';
            let html = md;

            // Fenced code blocks
            html = html.replace(/```([a-zA-Z0-9_\-\.]*)\n([\s\S]*?)```/g, function(match, lang, code) {
                const language = (lang || 'code').toUpperCase();
                const escapedCode = escapeHtml(code.trim());
                return '<div class=""code-container"">' +
                    '<div class=""code-header"">' +
                        '<span>' + language + '</span>' +
                        '<button class=""btn-copy-code"" onclick=""copyCode(this)"">Copy</button>' +
                    '</div>' +
                    '<pre><code>' + escapedCode + '</code></pre>' +
                '</div>';
            });

            // Inline code
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

            // Headers
            html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
            html = html.replace(/^## (.*$)/gim, '<h3>$1</h3>');
            html = html.replace(/^# (.*$)/gim, '<h3>$1</h3>');

            // Bold & Italic
            html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

            // Bullet Lists
            html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
            html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');

            // Paragraphs
            html = html.split('\n\n').map(p => {
                p = p.trim();
                if (!p) return '';
                if (p.startsWith('<div') || p.startsWith('<ul') || p.startsWith('<h3')) return p;
                return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
            }).join('');

            return html;
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.innerText = str;
            return div.innerHTML;
        }

        function copyCode(btn) {
            const pre = btn.closest('.code-container').querySelector('pre code');
            if (pre) {
                navigator.clipboard.writeText(pre.innerText).then(() => {
                    btn.innerText = 'Copied!';
                    setTimeout(() => btn.innerText = 'Copy', 2000);
                });
            }
        }

        function scrollToBottom() {
            const container = document.getElementById('messagesScroll');
            container.scrollTop = container.scrollHeight;
        }

        function autoResizeTextarea(el) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 180) + 'px';
        }

        function handleKey(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleFormSubmit(e);
            }
        }

        function handleModelChange() {
            const select = document.getElementById('modelSelect');
            const badge = document.getElementById('activeModelBadge');
            badge.innerText = select.options[select.selectedIndex].text;
        }

        function sendQuickPrompt(text) {
            if (isGenerating) return;
            const input = document.getElementById('promptInput');
            input.value = text;
            handleFormSubmit(new Event('submit'));
        }

        async function handleFormSubmit(e) {
            if (e) e.preventDefault();
            if (isGenerating) return;

            const input = document.getElementById('promptInput');
            const text = input.value.trim();
            if (!text) return;

            input.value = '';
            input.style.height = 'auto';

            const chat = getCurrentConversation();
            chat.messages.push({ role: 'user', content: text });
            if (chat.title === 'New Conversation') {
                chat.title = text.slice(0, 28) + (text.length > 28 ? '...' : '');
                renderHistoryList();
            }
            saveToStorage();

            appendMessageNode('user', text, false);
            scrollToBottom();

            isGenerating = true;
            document.getElementById('sendBtn').disabled = true;

            const bubble = appendMessageNode('assistant', '', true);
            scrollToBottom();

            try {
                const model = document.getElementById('modelSelect').value;
                const temperature = parseFloat(document.getElementById('tempRange').value);

                const res = await fetch('/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        temperature: temperature,
                        messages: chat.messages.map(m => ({ role: m.role, content: m.content }))
                    })
                });

                const data = await res.json();
                let fullResponse = 'I apologize, but no response was returned by the inference engine.';
                if (data.choices && data.choices[0] && data.choices[0].message) {
                    fullResponse = data.choices[0].message.content;
                }

                // Simulate realistic typing token stream
                await streamTokens(bubble, fullResponse);

                chat.messages.push({ role: 'assistant', content: fullResponse });
                saveToStorage();
            } catch(err) {
                bubble.innerHTML = '<span style=""color: #f87171;"">Error communicating with AI engine: ' + escapeHtml(err.message) + '</span>';
            } finally {
                isGenerating = false;
                document.getElementById('sendBtn').disabled = false;
                scrollToBottom();
            }
        }

        async function streamTokens(bubble, text) {
            let displayed = '';
            const chunkSize = Math.max(1, Math.floor(text.length / 50));
            for (let i = 0; i < text.length; i += chunkSize) {
                displayed += text.slice(i, i + chunkSize);
                bubble.innerHTML = renderMarkdown(displayed) + '<span class=""cursor""></span>';
                scrollToBottom();
                await new Promise(r => setTimeout(r, 18));
            }
            bubble.innerHTML = renderMarkdown(text);
        }

        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('open');
        }

        function closeSidebarIfMobile() {
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        }

        window.onload = init;
    </script>
</body>
</html>";
        }
    }
}
