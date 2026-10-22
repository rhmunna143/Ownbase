import http from 'http';
import os from 'os';
import { logger } from './logger';
import { PrismaManager } from './prisma';
import { RouteRecord, CaddyStatus } from '../shared/types';

export class CaddyManager {
  private adminUrl: string;
  private prismaManager: PrismaManager;

  constructor(prismaManager: PrismaManager, adminUrl = 'http://127.0.0.1:2019') {
    this.prismaManager = prismaManager;
    this.adminUrl = adminUrl;
  }

  private request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: any
  ): Promise<{ statusCode: number; data: any }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.adminUrl);
      const postData = body ? JSON.stringify(body) : undefined;

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
          },
          timeout: 4000,
        },
        (res) => {
          let chunks = '';
          res.on('data', (d) => (chunks += d));
          res.on('end', () => {
            let data: any = chunks;
            try {
              data = chunks ? JSON.parse(chunks) : null;
            } catch {
              data = chunks;
            }
            resolve({ statusCode: res.statusCode || 200, data });
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout communicating with Caddy Admin API at ${this.adminUrl}`));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  public async getStatus(): Promise<CaddyStatus> {
    try {
      // Check Admin API liveness via root /config/ endpoint
      const ping = await this.request('GET', '/config/');
      const isListening = ping.statusCode >= 200 && ping.statusCode < 300;
      if (!isListening) {
        return {
          adminApiUrl: this.adminUrl,
          isListening: false,
          activeRoutesCount: 0,
        };
      }

      // Check route count if srv0 exists
      let count = 0;
      try {
        const routesRes = await this.request('GET', '/config/apps/http/servers/srv0/routes');
        if (routesRes.statusCode === 200 && Array.isArray(routesRes.data)) {
          count = routesRes.data.length;
        }
      } catch {
        count = 0;
      }

      return {
        adminApiUrl: this.adminUrl,
        isListening: true,
        activeRoutesCount: count,
      };
    } catch (err: any) {
      return {
        adminApiUrl: this.adminUrl,
        isListening: false,
        activeRoutesCount: 0,
        error: err.message,
      };
    }
  }

  public async ensureServerInitialized(): Promise<boolean> {
    try {
      const check = await this.request('GET', '/config/apps/http/servers/srv0');
      if (check.statusCode === 200 && check.data) {
        return true;
      }
    } catch {
      // Not initialized yet
    }

    logger.info('caddy', 'Initializing Caddy HTTP server container srv0 via /load...');
    return await this.syncAllRoutes().then((res) => res.success);
  }

  public getLocalIpv4Addresses(): string[] {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
          ips.push(net.address);
        }
      }
    }
    return ips;
  }

  public async registerRoute(route: RouteRecord): Promise<boolean> {
    logger.info('caddy', `Registering route for subdomain "${route.subdomain}" -> port ${route.targetPort}...`);
    const res = await this.syncAllRoutes();
    return res.success;
  }

  public async removeRoute(routeId: string): Promise<boolean> {
    logger.info('caddy', `Removing dynamic route route-${routeId} from Caddy...`);
    const res = await this.syncAllRoutes();
    return res.success;
  }

  public async syncAllRoutes(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      const routes = await this.prismaManager.getRoutes().catch(() => []);
      const activeRoutes = routes.filter((r) => r.isActive);
      const localIps = this.getLocalIpv4Addresses();

      logger.info('caddy', `Synchronizing ${activeRoutes.length} service routes, Web API bridge, and Catch-All Ownbase Server...`);

      const caddyRoutes: any[] = [];

      // 1. Service subdomains (e.g. files, ai, s3)
      for (const route of activeRoutes) {
        if (route.subdomain === 'proxy') continue; // Handled by Catch-All Hub and API bridge

        const hosts = [
          `${route.subdomain}.localhost`,
          `${route.subdomain}.local`,
        ];

        for (const ip of localIps) {
          hosts.push(`${route.subdomain}.${ip}.nip.io`);
          hosts.push(`${route.subdomain}.${ip}.sslip.io`);
        }

        if (route.customDomain) {
          hosts.push(route.customDomain);
        }

        caddyRoutes.push({
          '@id': `route-${route.id}`,
          match: [{ host: hosts }],
          handle: [
            {
              handler: 'reverse_proxy',
              headers: {
                request: {
                  set: {
                    Host: ['{http.reverse_proxy.upstream.hostport}'],
                  },
                },
              },
              upstreams: [
                {
                  dial: `${route.targetHost}:${route.targetPort}`,
                },
              ],
            },
          ],
          terminal: true,
        });
      }

      // 2. Web API Bridge Route (/api/* -> 127.0.0.1:3001)
      caddyRoutes.push({
        '@id': 'route-api-bridge',
        match: [{ path: ['/api/*', '/api'] }],
        handle: [
          {
            handler: 'reverse_proxy',
            headers: {
              request: {
                set: {
                  Host: ['127.0.0.1:3001'],
                },
              },
            },
            upstreams: [
              {
                dial: '127.0.0.1:3001',
              },
            ],
          },
        ],
        terminal: true,
      });

      // 3. Photos Service Subdomain (photos.localhost, photos.<IP>.nip.io)
      const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
      const hubDial = isDev ? '127.0.0.1:3000' : '127.0.0.1:3001';

      const photoHosts = ['photos.localhost', 'photos.local'];
      for (const ip of localIps) {
        photoHosts.push(`photos.${ip}.nip.io`);
        photoHosts.push(`photos.${ip}.sslip.io`);
      }

      caddyRoutes.push({
        '@id': 'route-photos-hub',
        match: [{ host: photoHosts }],
        handle: [
          {
            handler: 'reverse_proxy',
            headers: {
              request: {
                set: {
                  Host: [hubDial],
                },
              },
            },
            upstreams: [
              {
                dial: hubDial,
              },
            ],
          },
        ],
        terminal: true,
      });

      // 4. Catch-All Route: Any incoming IP (LAN / Tailscale) or domain -> Server Gateway Hub
      caddyRoutes.push({
        '@id': 'route-hub-dashboard',
        handle: [
          {
            handler: 'reverse_proxy',
            headers: {
              request: {
                set: {
                  Host: ['{http.reverse_proxy.upstream.hostport}'],
                },
              },
            },
            upstreams: [
              {
                dial: hubDial,
              },
            ],
          },
        ],
        terminal: true,
      });

      const fullConfig = {
        apps: {
          http: {
            servers: {
              srv0: {
                listen: [':80'],
                routes: caddyRoutes,
              },
            },
          },
        },
      };

      const res = await this.request('POST', '/load', fullConfig);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logger.success('caddy', `Caddy routes synchronized: ${activeRoutes.length} services + Web API + Ownbase Server Dashboard on port 80.`);
        return { success: true, count: activeRoutes.length };
      }

      throw new Error(`Caddy /load API error (${res.statusCode}): ${JSON.stringify(res.data)}`);
    } catch (err: any) {
      logger.error('caddy', `Route synchronization failed: ${err.message}`);
      return { success: false, count: 0, error: err.message };
    }
  }

  public async testRoute(
    host: string,
    port = 80
  ): Promise<{ success: boolean; status?: number; latencyMs: number; error?: string }> {
    const start = Date.now();
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/',
          method: 'GET',
          headers: {
            Host: host,
          },
          timeout: 3000,
        },
        (res) => {
          const latencyMs = Date.now() - start;
          resolve({
            success: (res.statusCode || 0) < 500,
            status: res.statusCode,
            latencyMs,
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          success: false,
          latencyMs: Date.now() - start,
          error: err.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          latencyMs: Date.now() - start,
          error: 'Connection timed out',
        });
      });

      req.end();
    });
  }

  private getCaddyGatewayHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Caddy Gateway - Ownbase</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { background: #080c14; color: #f1f5f9; padding: 40px 20px; display: flex; justify-content: center; min-height: 100vh; }
        .container { max-width: 800px; width: 100%; }
        header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; border-bottom: 1px solid #1e293b; padding-bottom: 20px; }
        .brand { display: flex; align-items: center; gap: 14px; }
        .logo { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #2563eb, #7c3aed); display: flex; align-items: center; justify-content: center; font-size: 22px; }
        h1 { font-size: 18px; font-weight: 700; color: #fff; }
        .badge { font-size: 10px; font-family: monospace; padding: 3px 8px; border-radius: 12px; background: rgba(37,99,235,0.15); color: #60a5fa; border: 1px solid rgba(37,99,235,0.3); }
        .status-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #34d399; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); padding: 4px 10px; border-radius: 20px; }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: #34d399; box-shadow: 0 0 6px #34d399; }
        .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 24px; }
        .card h2 { font-size: 14px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #1e293b; }
        td { padding: 14px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; }
        tr:last-child td { border-bottom: none; }
        .domain { font-family: monospace; color: #38bdf8; font-weight: 600; }
        .upstream { font-family: monospace; color: #a5b4fc; }
        .btn-open { display: inline-flex; align-items: center; gap: 4px; background: #1e293b; color: #cbd5e1; text-decoration: none; padding: 5px 12px; border-radius: 6px; font-size: 11.5px; font-weight: 500; border: 1px solid #334155; }
        .btn-open:hover { background: #334155; color: #fff; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .metric { background: #090e1a; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; }
        .metric-title { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; }
        .metric-val { font-size: 16px; font-weight: 700; color: #f8fafc; margin-top: 4px; font-family: monospace; }
        footer { text-align: center; font-size: 11px; color: #64748b; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="brand">
                <div class="logo">🌐</div>
                <div>
                    <h1>Caddy Dynamic Gateway <span class="badge">v2.8.4</span></h1>
                    <div style="color: #64748b; font-size: 11px; margin-top: 2px;">Ownbase Dynamic Reverse Proxy & Mesh Gateway</div>
                </div>
            </div>
            <div class="status-pill">
                <span class="dot"></span>
                <span>Active on Port 80 & 2019</span>
            </div>
        </header>

        <div class="grid">
            <div class="metric">
                <div class="metric-title">Dynamic Routing Engine</div>
                <div class="metric-val">Zero-Reload REST API</div>
            </div>
            <div class="metric">
                <div class="metric-title">Mesh VPN Status</div>
                <div class="metric-val">WireGuard Encrypted</div>
            </div>
        </div>

        <div class="card">
            <h2>Configured Reverse Proxy Routes</h2>
            <table>
                <thead>
                    <tr>
                        <th>Host Domain</th>
                        <th>Target Upstream</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><span class="domain">files.localhost</span></td>
                        <td><span class="upstream">127.0.0.1:8080</span></td>
                        <td><span style="color: #34d399;">● Online</span></td>
                        <td><a href="http://files.localhost" class="btn-open">Open Drive ↗</a></td>
                    </tr>
                    <tr>
                        <td><span class="domain">ai.localhost</span></td>
                        <td><span class="upstream">127.0.0.1:11434</span></td>
                        <td><span style="color: #34d399;">● Online</span></td>
                        <td><a href="http://ai.localhost" class="btn-open">Open AI Hub ↗</a></td>
                    </tr>
                    <tr>
                        <td><span class="domain">proxy.localhost</span></td>
                        <td><span class="upstream">127.0.0.1:2019</span></td>
                        <td><span style="color: #34d399;">● Online</span></td>
                        <td><a href="http://localhost:3000" class="btn-open">Server Dashboard ↗</a></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div style="text-align: center;">
            <a href="http://localhost:3000" style="color: #38bdf8; text-decoration: none; font-size: 12px; font-weight: 500;">← Return to Ownbase Dashboard</a>
        </div>

        <footer>
            Ownbase • Dynamic Reverse Proxy Engine
        </footer>
    </div>
</body>
</html>`;
  }
}
