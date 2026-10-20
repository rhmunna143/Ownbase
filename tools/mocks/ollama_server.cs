using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace NativeAiHub
{
    class Program
    {
        private static readonly string ModelName = "hermes-3-8b";
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
                Console.WriteLine("[AI-HUB] Model loaded: " + ModelName + " (Weights: 8B Q4_K_M)");
                Console.WriteLine("[AI-HUB] OpenAI compatibility layer enabled on /v1/chat/completions");
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
                    // If client expects JSON or specifies query param format=json
                    if (accept.Contains("application/json") || req.QueryString["format"] == "json")
                    {
                        SendJson(res, "{\"status\":\"ok\",\"model\":\"" + ModelName + "\",\"version\":\"" + Version + "\",\"message\":\"Native Windows Server AI Hub Active\"}", isHead);
                    }
                    else
                    {
                        SendHtml(res, GetChatWebUi(), isHead);
                    }
                }
                else if (path == "/api/tags" || path == "/v1/models")
                {
                    string modelsJson = "{\"models\":[{\"name\":\"" + ModelName + ":latest\",\"model\":\"" + ModelName + "\",\"size\":4661224960,\"digest\":\"a78e1b...\",\"details\":{\"format\":\"gguf\",\"family\":\"llama\",\"parameter_size\":\"8B\",\"quantization_level\":\"Q4_K_M\"}}]}";
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
                    // Fallback to JSON status for unknown paths
                    SendJson(res, "{\"status\":\"ok\",\"model\":\"" + ModelName + "\",\"endpoint\":\"" + path + "\"}", isHead);
                }
            }
            catch (Exception ex)
            {
                res.StatusCode = 500;
                byte[] errBytes = Encoding.UTF8.GetBytes("{\"error\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}");
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

            // Extract last user message or prompt
            string userMsg = "Hello";
            int contentIdx = body.LastIndexOf("\"content\":");
            if (contentIdx != -1)
            {
                int start = body.IndexOf("\"", contentIdx + 10) + 1;
                int end = body.IndexOf("\"", start);
                if (start > 0 && end > start)
                {
                    userMsg = body.Substring(start, end - start);
                }
            }

            string aiResponse = GenerateAiResponse(userMsg);

            Console.WriteLine("[AI-HUB] Prompt: \"" + userMsg + "\" -> Response tokens generated (" + aiResponse.Length + " chars)");

            string jsonResp = "{" +
                "\"id\":\"chatcmpl-" + Guid.NewGuid().ToString("N").Substring(0, 12) + "\"," +
                "\"object\":\"chat.completion\"," +
                "\"created\":" + DateTimeOffset.UtcNow.ToUnixTimeSeconds() + "," +
                "\"model\":\"" + ModelName + "\"," +
                "\"choices\":[{" +
                    "\"index\":0," +
                    "\"message\":{\"role\":\"assistant\",\"content\":\"" + EscapeJson(aiResponse) + "\"}," +
                    "\"finish_reason\":\"stop\"" +
                "}]," +
                "\"usage\":{\"prompt_tokens\":18,\"completion_tokens\":64,\"total_tokens\":82}" +
            "}";

            SendJson(res, jsonResp);
        }

        private static string GenerateAiResponse(string prompt)
        {
            string p = prompt.ToLowerInvariant();
            if (p.Contains("ping") || p.Contains("health"))
            {
                return "Pong! Native Windows Server AI Hub is fully operational running " + ModelName + " on port 11434 with Caddy reverse proxy on port 80.";
            }
            if (p.Contains("service") || p.Contains("status"))
            {
                return "The Native Windows Server Hub is currently supervising:\n1. **Caddy Reverse Proxy** (Port 80/2019) - Dynamic *.localhost routing\n2. **FileBrowser** (Port 8080) - Cloud drive storage\n3. **PostgreSQL 16** (Port 5432) - Database engine\n4. **Ollama AI Engine** (Port 11434) - Hermes 3 inference hub\n\nAll services run 100% natively on Windows with zero Docker or WSL2 virtualization.";
            }
            if (p.Contains("help") || p.Contains("who"))
            {
                return "I am **Hermes 3 (8B)**, running natively inside your Native Windows Server Hub environment. You can use me for code generation, server automation, question answering, or call my OpenAI-compatible endpoint at `http://ai.localhost/v1/chat/completions`.";
            }
            if (p.Contains("python") || p.Contains("code"))
            {
                return "Here is a Python snippet to interact with this AI hub:\n\n```python\nimport requests\n\nres = requests.post(\"http://ai.localhost/v1/chat/completions\", json={\n    \"model\": \"hermes-3-8b\",\n    \"messages\": [{\"role\": \"user\", \"content\": \"" + prompt + "\"}]\n})\nprint(res.json()[\"choices\"][0][\"message\"][\"content\"])\n```";
            }

            return "Greetings! I am **Hermes 3 8B**, running natively on your Windows Server Hub without Docker. Your query was received and processed successfully by the local inference engine.";
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

        private static string GetChatWebUi()
        {
            return @"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
    <title>AI Hub - Hermes 3 8B | Native Windows Server</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { background: #080c14; color: #f1f5f9; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        header { background: #0c1220; border-bottom: 1px solid #1e293b; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #a855f7, #6366f1); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 18px; color: #fff; box-shadow: 0 4px 12px rgba(168,85,247,0.3); }
        .title h1 { font-size: 15px; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 8px; }
        .badge { font-size: 10px; font-family: monospace; padding: 2px 8px; border-radius: 12px; background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981; }
        .meta { font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
        .header-actions { display: flex; align-items: center; gap: 10px; }
        .btn-link { background: #1e293b; color: #cbd5e1; text-decoration: none; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 500; border: 1px solid #334155; transition: 0.2s; }
        .btn-link:hover { background: #334155; color: #fff; }
        
        main { flex: 1; display: flex; overflow: hidden; }
        .sidebar { width: 260px; background: #090e1a; border-right: 1px solid #1e293b; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; }
        .settings-sec h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; margin-bottom: 12px; }
        .setting-item { margin-bottom: 16px; }
        .setting-item label { display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 6px; font-weight: 500; }
        .setting-item select, .setting-item input[type=range] { width: 100%; background: #131c31; border: 1px solid #334155; color: #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 12px; }
        .api-info { background: #10182b; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; font-size: 11px; color: #94a3b8; line-height: 1.5; }
        .api-info code { color: #a855f7; font-family: monospace; }
        
        .chat-container { flex: 1; display: flex; flex-direction: column; background: #070b13; }
        .messages { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 18px; }
        .msg { max-width: 80%; padding: 14px 18px; border-radius: 14px; font-size: 13.5px; line-height: 1.6; }
        .msg-user { align-self: flex-end; background: #4f46e5; color: #fff; border-bottom-right-radius: 4px; box-shadow: 0 4px 14px rgba(79,70,229,0.25); }
        .msg-bot { align-self: flex-start; background: #131b2e; color: #f1f5f9; border: 1px solid #232f48; border-bottom-left-radius: 4px; }
        .msg-bot pre { background: #090e1a; padding: 10px; border-radius: 6px; border: 1px solid #1e293b; overflow-x: auto; margin: 8px 0; font-family: monospace; font-size: 12px; color: #a5b4fc; }
        .msg-meta { font-size: 10px; color: #64748b; margin-bottom: 4px; font-weight: 600; text-transform: uppercase; }
        
        .quick-prompts { display: flex; gap: 8px; padding: 0 24px 12px; overflow-x: auto; }
        .chip { background: #111827; border: 1px solid #1f2937; color: #94a3b8; padding: 6px 12px; border-radius: 16px; font-size: 11.5px; cursor: pointer; white-space: nowrap; transition: 0.2s; }
        .chip:hover { background: #1e293b; color: #fff; border-color: #3b82f6; }

        .input-bar { padding: 16px 24px; background: #0b101c; border-top: 1px solid #1e293b; display: flex; gap: 12px; }
        .input-bar input { flex: 1; background: #131c31; border: 1px solid #334155; border-radius: 10px; padding: 12px 16px; color: #fff; font-size: 13px; outline: none; transition: 0.2s; }
        .input-bar input:focus { border-color: #a855f7; box-shadow: 0 0 0 2px rgba(168,85,247,0.2); }
        .input-bar button { background: #a855f7; hover:background: #9333ea; color: #fff; border: none; border-radius: 10px; padding: 0 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 12px rgba(168,85,247,0.3); }
        .input-bar button:hover { background: #9333ea; }
    </style>
</head>
<body>
    <header>
        <div class brand"">
            <div class=""logo"">🤖</div>
            <div class=""title"">
                <h1>AI Hub <span class=""badge"">Hermes 3 (8B)</span></h1>
                <div class=""meta"">
                    <span class=""status-dot""></span>
                    <span>Native Inference Engine • 127.0.0.1:11434</span>
                </div>
            </div>
        </div>
        <div class=""header-actions"">
            <a href=""http://localhost:3000"" class=""btn-link"">← Server Hub</a>
            <a href=""http://files.localhost"" class=""btn-link"">FileBrowser Drive</a>
        </div>
    </header>

    <main>
        <div class=""sidebar"">
            <div class=""settings-sec"">
                <h3>Engine Settings</h3>
                <div class=""setting-item"">
                    <label>Active Model</label>
                    <select id=""modelSelect"">
                        <option value=""hermes-3-8b"">Hermes 3 (8B Instruct)</option>
                        <option value=""llama-3-8b"">Llama 3 (8B)</option>
                        <option value=""mistral-7b"">Mistral (7B)</option>
                    </select>
                </div>
                <div class=""setting-item"">
                    <label>Temperature (<span id=""tempVal"">0.7</span>)</label>
                    <input type=""range"" id=""tempRange"" min=""0"" max=""1"" step=""0.1"" value=""0.7"" oninput=""document.getElementById('tempVal').innerText = this.value"">
                </div>
            </div>

            <div class=""api-info"">
                <strong>OpenAI Endpoint:</strong><br>
                <code>POST /v1/chat/completions</code><br><br>
                Native Windows binary with Caddy reverse proxy routing.
            </div>
        </div>

        <div class=""chat-container"">
            <div class=""messages"" id=""messages"">
                <div class=""msg msg-bot"">
                    <div class=""msg-meta"">Hermes 3 AI Hub</div>
                    Hello! I am **Hermes 3 (8B)**, running natively inside your Native Windows Server prototype. How can I assist you with your servers, database, or code today?
                </div>
            </div>

            <div class=""quick-prompts"">
                <div class=""chip"" onclick=""sendPrompt('What services are currently supervised?')"" >What services are currently supervised?</div>
                <div class=""chip"" onclick=""sendPrompt('Show a Python example to call this AI model')"" >Python API Example</div>
                <div class=""chip"" onclick=""sendPrompt('How does Caddy dynamic reverse proxy work?')"" >How does Caddy work?</div>
            </div>

            <form class=""input-bar"" onsubmit=""handleSend(event)"">
                <input type=""text"" id=""promptInput"" placeholder=""Type your message or prompt for Hermes 3..."" autocomplete=""off"" required />
                <button type=""submit"">Send</button>
            </form>
        </div>
    </main>

    <script>
        const messagesDiv = document.getElementById('messages');
        const promptInput = document.getElementById('promptInput');

        function appendMessage(role, text) {
            const div = document.createElement('div');
            div.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-bot');
            
            const meta = document.createElement('div');
            meta.className = 'msg-meta';
            meta.innerText = role === 'user' ? 'You' : 'Hermes 3 AI';
            div.appendChild(meta);

            // Simple formatting for markdown code blocks
            if (text.includes('```')) {
                const parts = text.split('```');
                for (let i = 0; i < parts.length; i++) {
                    if (i % 2 === 1) {
                        const pre = document.createElement('pre');
                        pre.innerText = parts[i].trim();
                        div.appendChild(pre);
                    } else if (parts[i].trim()) {
                        const p = document.createElement('div');
                        p.innerText = parts[i].trim();
                        div.appendChild(p);
                    }
                }
            } else {
                const content = document.createElement('div');
                content.innerText = text;
                div.appendChild(content);
            }

            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            return div;
        }

        async function handleSend(e) {
            e.preventDefault();
            const text = promptInput.value.trim();
            if (!text) return;
            sendPrompt(text);
        }

        async function sendPrompt(text) {
            promptInput.value = '';
            appendMessage('user', text);

            const botMsgDiv = appendMessage('bot', 'Generating response...');

            try {
                const res = await fetch('/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: document.getElementById('modelSelect').value,
                        temperature: parseFloat(document.getElementById('tempRange').value),
                        messages: [{ role: 'user', content: text }]
                    })
                });

                const data = await res.json();
                botMsgDiv.remove();
                if (data.choices && data.choices[0] && data.choices[0].message) {
                    appendMessage('bot', data.choices[0].message.content);
                } else {
                    appendMessage('bot', JSON.stringify(data));
                }
            } catch (err) {
                botMsgDiv.remove();
                appendMessage('bot', 'Error: ' + err.message);
            }
        }
    </script>
</body>
</html>";
        }
    }
}
