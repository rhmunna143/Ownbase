using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace OwnbaseMocks
{
    class RedisServer
    {
        private static Dictionary<string, string> store = new Dictionary<string, string>();
        private static object syncRoot = new object();

        static void Main(string[] args)
        {
            int port = 6379;
            for (int i = 0; i < args.Length; i++)
            {
                if ((args[i] == "--port" || args[i] == "-p") && i + 1 < args.Length)
                {
                    int.TryParse(args[i + 1], out port);
                }
            }

            TcpListener tcpListener = null;
            try
            {
                tcpListener = new TcpListener(IPAddress.Any, port);
                tcpListener.Start();
                Console.WriteLine("[REDIS] Redis/Memurai Mock Server v7.2.0 listening on port " + port);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[REDIS-ERROR] Could not start TCP listener: " + ex.Message);
                return;
            }

            while (true)
            {
                try
                {
                    TcpClient client = tcpListener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem((state) => HandleClient(client));
                }
                catch
                {
                    break;
                }
            }
        }

        static void HandleClient(TcpClient client)
        {
            using (client)
            using (NetworkStream stream = client.GetStream())
            {
                byte[] buffer = new byte[8192];
                while (client.Connected)
                {
                    int bytesRead = 0;
                    try
                    {
                        bytesRead = stream.Read(buffer, 0, buffer.Length);
                    }
                    catch { break; }

                    if (bytesRead <= 0) break;

                    string received = Encoding.UTF8.GetString(buffer, 0, bytesRead);

                    // Check if browser HTTP request
                    if (received.StartsWith("GET ") || received.StartsWith("HEAD ") || received.StartsWith("POST "))
                    {
                        string httpResp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n"
                            + "Ownbase Redis In-Memory Cache v7.2.0 (Active & Healthy)\r\n";
                        byte[] httpBytes = Encoding.UTF8.GetBytes(httpResp);
                        stream.Write(httpBytes, 0, httpBytes.Length);
                        stream.Flush();
                        break;
                    }

                    // Simple Redis RESP protocol handling
                    string upper = received.Trim().ToUpperInvariant();
                    if (upper.Contains("PING"))
                    {
                        byte[] resp = Encoding.UTF8.GetBytes("+PONG\r\n");
                        stream.Write(resp, 0, resp.Length);
                    }
                    else if (upper.Contains("INFO"))
                    {
                        string info = "# Server\r\nredis_version:7.2.0\r\nos:Windows\r\ntcp_port:6379\r\nuptime_in_seconds:3600\r\nconnected_clients:1\r\n";
                        string resp = "$" + info.Length + "\r\n" + info + "\r\n";
                        byte[] respBytes = Encoding.UTF8.GetBytes(resp);
                        stream.Write(respBytes, 0, respBytes.Length);
                    }
                    else if (upper.Contains("COMMAND"))
                    {
                        byte[] resp = Encoding.UTF8.GetBytes("*0\r\n");
                        stream.Write(resp, 0, resp.Length);
                    }
                    else
                    {
                        byte[] resp = Encoding.UTF8.GetBytes("+OK\r\n");
                        stream.Write(resp, 0, resp.Length);
                    }
                    stream.Flush();
                }
            }
        }
    }
}
