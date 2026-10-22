using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Diagnostics;

namespace OwnbaseMocks
{
    class TerminalServer
    {
        static void Main(string[] args)
        {
            int port = 7681;
            for (int i = 0; i < args.Length; i++)
            {
                if ((args[i] == "--port" || args[i] == "-p") && i + 1 < args.Length)
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
                Console.WriteLine("[TERMINAL] Web Terminal Server listening at " + prefix);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[TERMINAL-ERROR] Failed to start listener: " + ex.Message);
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
                if (path == "/api/exec" && ctx.Request.HttpMethod == "POST")
                {
                    string command = "";
                    using (var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding))
                    {
                        command = reader.ReadToEnd();
                    }

                    string output = ExecuteCommand(command);
                    byte[] data = Encoding.UTF8.GetBytes(output);
                    ctx.Response.ContentType = "text/plain; charset=utf-8";
                    ctx.Response.OutputStream.Write(data, 0, data.Length);
                    ctx.Response.Close();
                    return;
                }

                // Serve web terminal UI
                string html = @"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <title>Ownbase Web Terminal</title>
    <style>
        body { margin: 0; background: #070b14; color: #38bdf8; font-family: Consolas, monospace; display: flex; flex-direction: column; height: 100vh; }
        header { background: #0c1322; padding: 12px 18px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 14px; font-weight: bold; color: #f8fafc; }
        .badge { background: #0369a1; color: #e0f2fe; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
        #output { flex: 1; padding: 16px; overflow-y: auto; white-space: pre-wrap; font-size: 13px; line-height: 1.4; color: #cbd5e1; }
        .input-row { display: flex; background: #0c1322; padding: 12px; border-top: 1px solid #1e293b; }
        .prompt { color: #10b981; font-weight: bold; margin-right: 8px; }
        input { flex: 1; background: transparent; border: none; color: #f8fafc; font-family: inherit; font-size: 13px; outline: none; }
    </style>
</head>
<body>
    <header>
        <span class=""logo"">Ownbase Interactive Web Terminal</span>
        <span class=""badge"">PowerShell Live</span>
    </header>
    <div id=""output"">Windows PowerShell&#10;Copyright (C) Microsoft Corporation. All rights reserved.&#10;&#10;Ownbase Server Web Console initialized. Type any command below:&#10;</div>
    <div class=""input-row"">
        <span class=""prompt"">PS C:\&gt;</span>
        <input type=""text"" id=""cmd"" autofocus placeholder=""Type command (e.g. dir, hostname, Get-Process)...""/>
    </div>
    <script>
        const input = document.getElementById('cmd');
        const output = document.getElementById('output');
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const cmd = input.value.trim();
                if (!cmd) return;
                output.innerText += '\nPS C:\> ' + cmd + '\n';
                input.value = '';
                try {
                    const res = await fetch('/api/exec', { method: 'POST', body: cmd });
                    const text = await res.text();
                    output.innerText += text;
                } catch (err) {
                    output.innerText += 'Error: ' + err.message + '\n';
                }
                output.scrollTop = output.scrollHeight;
            }
        });
    </script>
</body>
</html>";
                byte[] bytes = Encoding.UTF8.GetBytes(html);
                ctx.Response.ContentType = "text/html; charset=utf-8";
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                ctx.Response.Close();
            }
            catch {}
        }

        static string ExecuteCommand(string cmd)
        {
            try
            {
                var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command " + cmd)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var proc = Process.Start(psi))
                {
                    string stdout = proc.StandardOutput.ReadToEnd();
                    string stderr = proc.StandardError.ReadToEnd();
                    proc.WaitForExit(3000);
                    return stdout + (string.IsNullOrEmpty(stderr) ? "" : "\n" + stderr);
                }
            }
            catch (Exception ex)
            {
                return "Failed to execute: " + ex.Message + "\n";
            }
        }
    }
}
