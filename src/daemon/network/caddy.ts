import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../core/logger';
import { paths } from '../core/paths';
import { PrismaManager } from '../db/prisma';
import { RouteRecord, CaddyStatus } from '../../shared/types';
import { hostBuilder, RouteIntent } from '../core/hostBuilder';

export class CaddyManager {
  private adminUrl: string;
  private prismaManager: PrismaManager;
  private lastConfigHash: string = '';
  private autosavePath: string;
  private daemonPort: number = 3001;

  public setDaemonPort(port: number) {
    this.daemonPort = port;
  }

  constructor(prismaManager: PrismaManager, adminUrl = 'http://127.0.0.1:2019') {
    this.prismaManager = prismaManager;
    this.adminUrl = adminUrl;
    this.autosavePath = path.join(paths.dataDir, 'caddy.autosave.json');

    // Subscribe to dynamic network changes (DHCP renewal, IP changes)
    hostBuilder.onNetworkChange(() => {
      logger.info('caddy', 'Network interfaces changed; triggering automatic Caddy route synchronization.');
      this.syncAllRoutes().catch((err) => {
        logger.error('caddy', `Automatic re-sync on network change failed: ${err.message}`);
      });
    });
  }

  private request(
    method: 'GET' | 'POST' | 'DELETE',
    reqPath: string,
    body?: any
  ): Promise<{ statusCode: number; data: any }> {
    return new Promise((resolve, reject) => {
      const url = new URL(reqPath, this.adminUrl);
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
          timeout: 5000,
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
      const res = await this.request('GET', '/config/');
      const isListening = res.statusCode >= 200 && res.statusCode < 300;

      let routeCount = 0;
      if (res.data?.apps?.http?.servers) {
        for (const sName of Object.keys(res.data.apps.http.servers)) {
          const s = res.data.apps.http.servers[sName];
          if (Array.isArray(s.routes)) {
            routeCount += s.routes.length;
          }
        }
      }

      return {
        isListening,
        adminApiUrl: this.adminUrl,
        activeRoutesCount: routeCount,
      };
    } catch (err: any) {
      return {
        isListening: false,
        adminApiUrl: this.adminUrl,
        activeRoutesCount: 0,
        error: err.message,
      };
    }
  }

  /**
   * Generates the complete Caddy JSON configuration and computes its SHA-256 hash.
   */
  public generateFullConfig(routes: any[]): { config: any; hash: string } {
    const caddyRoutes: any[] = [];

    // 1. User & Service Routes (Evaluated first with terminal: true)
    const allRoutes = [...routes];
    if (!allRoutes.some((r) => r.subdomain === 'photos')) {
      const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
      allRoutes.push({
        subdomain: 'photos',
        targetPort: isDev ? 3000 : this.daemonPort,
        targetHost: '127.0.0.1',
        exposeLocal: true,
        exposeLan: true,
        exposeMesh: true,
        tlsEnabled: true,
      });
    }

    const restrictedHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Ownbase • Access Restricted</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#070b12;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#0d1322;border:1px solid #1e293b;border-radius:20px;padding:32px 24px;max-width:420px;width:100%;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)}.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px}h2{font-size:18px;font-weight:700;color:#fff;margin-bottom:8px}p{font-size:13px;color:#94a3b8;line-height:1.5;margin-bottom:24px}.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:12px 20px;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;border-radius:12px;font-size:13px;font-weight:600;text-decoration:none;box-shadow:0 4px 14px rgba(37,99,235,0.3);transition:opacity 0.2s}.btn:hover{opacity:0.9}.note{margin-top:14px;font-size:11px;color:#64748b}</style></head><body><div class="card"><div class="badge">🔒 Authentication Required</div><h2>Access Restricted</h2><p>Sign in to your Ownbase server to access this service on your local network or remote connection.</p><a id="loginBtn" href="/" class="btn">Sign In to Ownbase Hub</a><div class="note">Subdomain access requires an active Ownbase session</div></div><script>(function(){var h=window.location.hostname;var p=h.split('.');var hubUrl='/';if(p.length>=3){p[0]='hub';hubUrl=window.location.protocol+'//'+p.join('.')+(window.location.port?':'+window.location.port:'')+'/'}var target=hubUrl+'?redirect='+encodeURIComponent(window.location.href);document.getElementById('loginBtn').href=target;})();</script></body></html>`;

    for (const r of allRoutes) {
      if (r.isActive === false) continue;

      const customDomains: string[] = [];
      if (r.customDomain) customDomains.push(r.customDomain);
      if (Array.isArray(r.hosts)) {
        for (const h of r.hosts) {
          if (h.hostname) customDomains.push(h.hostname);
        }
      }

      const intent: RouteIntent = {
        subdomain: r.subdomain,
        targetPort: r.targetPort,
        targetHost: r.targetHost || '127.0.0.1',
        customDomains,
        exposeLocal: r.exposeLocal ?? true,
        exposeLan: r.exposeLan ?? true,
        exposeMesh: r.exposeMesh ?? true,
        tlsEnabled: r.tlsEnabled ?? true,
      };

      // All service subdomains on LAN/remote MUST be protected unless explicitly marked requiresAuth: false or is hub
      const isProtected = r.subdomain !== 'hub' && r.subdomain !== 'proxy' && r.requiresAuth !== false;
      const built = hostBuilder.build(intent);

      if (built.caddyMatchers.length > 0) {
        if (isProtected) {
          // Separate local loopback (no auth needed) vs LAN / remote matchers (forward-auth required)
          const localMatchers = built.caddyMatchers.filter((m) => m.endsWith('.localhost') || m === 'localhost');
          const lanMatchers = built.caddyMatchers.filter((m) => !m.endsWith('.localhost') && m !== 'localhost');

          // 1. Local loopback route
          if (localMatchers.length > 0) {
            caddyRoutes.push({
              '@id': `route-${r.subdomain}`,
              match: [{ host: localMatchers }],
              handle: [
                {
                  handler: 'reverse_proxy',
                  headers: {
                    request: {
                      set: {
                        Host: ['{http.reverse_proxy.upstream.hostport}'],
                        'X-Forwarded-Host': ['{http.request.host}'],
                        'X-Forwarded-Proto': ['{http.request.scheme}'],
                      },
                    },
                  },
                  upstreams: [{ dial: `${r.targetHost || '127.0.0.1'}:${r.targetPort}` }],
                },
              ],
              terminal: true,
            });
          }

          // 2. LAN / remote route with forward_auth protection (PRD Criterion A3)
          if (lanMatchers.length > 0) {
            caddyRoutes.push({
              '@id': `route-${r.subdomain}-lan-protected`,
              match: [{ host: lanMatchers }],
              handle: [
                {
                  handler: 'reverse_proxy',
                  upstreams: [{ dial: `127.0.0.1:${this.daemonPort}` }],
                  rewrite: {
                    method: 'GET',
                    uri: '/api/v1/auth/verify',
                  },
                  headers: {
                    request: {
                      set: {
                        'X-Forwarded-Host': ['{http.request.host}'],
                        'X-Forwarded-Uri': ['{http.request.uri}'],
                        'X-Forwarded-Method': ['{http.request.method}'],
                      },
                    },
                  },
                  handle_response: [
                    {
                      match: {
                        status_code: [200, 201, 204],
                      },
                      routes: [
                        {
                          handle: [
                            {
                              handler: 'reverse_proxy',
                              headers: {
                                request: {
                                  set: {
                                    Host: ['{http.reverse_proxy.upstream.hostport}'],
                                    'X-Forwarded-Host': ['{http.request.host}'],
                                    'X-Forwarded-Proto': ['{http.request.scheme}'],
                                  },
                                },
                              },
                              upstreams: [{ dial: `${r.targetHost || '127.0.0.1'}:${r.targetPort}` }],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      match: {
                        status_code: [401, 403],
                      },
                      routes: [
                        {
                          handle: [
                            {
                              handler: 'static_response',
                              status_code: 401,
                              headers: {
                                'Content-Type': ['text/html; charset=utf-8'],
                              },
                              body: restrictedHtml,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
              terminal: true,
            });
          }
        } else {
          // Standard unprotected route
          caddyRoutes.push({
            '@id': `route-${r.subdomain}`,
            match: [{ host: built.caddyMatchers }],
            handle: [
              {
                handler: 'reverse_proxy',
                headers: {
                  request: {
                    set: {
                      Host: ['{http.reverse_proxy.upstream.hostport}'],
                      'X-Forwarded-Host': ['{http.request.host}'],
                      'X-Forwarded-Proto': ['{http.request.scheme}'],
                    },
                  },
                },
                upstreams: [
                  {
                    dial: `${r.targetHost || '127.0.0.1'}:${r.targetPort}`,
                  },
                ],
              },
            ],
            terminal: true,
          });
        }
      }
    }

    // 2. Core Platform Routes: /api/*, /ws, /_next/*, /favicon.ico -> Daemon Gateway
    caddyRoutes.push({
      '@id': 'core-gateway-api',
      match: [{ path: ['/api/*', '/ws', '/_next/*', '/favicon.ico'] }],
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [{ dial: `127.0.0.1:${this.daemonPort}` }],
        },
      ],
    });

    // 3. Core Dashboard Catch-All SPA Root -> Daemon Gateway
    caddyRoutes.push({
      '@id': 'core-dashboard-root',
      match: [{ path: ['/*'] }],
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [{ dial: `127.0.0.1:${this.daemonPort}` }],
        },
      ],
    });

    const fullConfig = {
      admin: {
        listen: '127.0.0.1:2019',
      },
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

    const configStr = JSON.stringify(fullConfig);
    const hash = crypto.createHash('sha256').update(configStr).digest('hex');

    return { config: fullConfig, hash };
  }

  /**
   * Synchronizes all application routes to Caddy.
   * Only posts to /load when the config hash has changed.
   * Persists the config to caddy.autosave.json.
   */
  public async syncAllRoutes(force = false): Promise<{ success: boolean; count: number; hash: string; error?: string }> {
    logger.info('caddy', 'Computing full Caddy reverse proxy configuration...');

    try {
      const routes = await this.prismaManager.getRoutes();
      const { config, hash } = this.generateFullConfig(routes);

      if (!force && this.lastConfigHash === hash) {
        logger.debug('caddy', `Caddy configuration unchanged (hash: ${hash.slice(0, 10)}); skipping /load.`);
        return { success: true, count: routes.length, hash };
      }

      logger.info('caddy', `Applying updated Caddy configuration (hash: ${hash.slice(0, 10)})...`);

      const res = await this.request('POST', '/load', config);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        this.lastConfigHash = hash;

        // Persist autosave config
        try {
          fs.writeFileSync(this.autosavePath, JSON.stringify(config, null, 2), 'utf8');
        } catch (saveErr: any) {
          logger.warn('caddy', `Failed to write caddy autosave file: ${saveErr.message}`);
        }

        logger.success('caddy', `Loaded Caddy configuration with ${routes.length} active routes.`);
        return { success: true, count: routes.length, hash };
      } else {
        const errMsg = `Caddy Admin API returned HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`;
        logger.error('caddy', errMsg);
        return { success: false, count: 0, hash, error: errMsg };
      }
    } catch (err: any) {
      logger.error('caddy', `Route synchronization failed: ${err.message}`);
      return { success: false, count: 0, hash: '', error: err.message };
    }
  }

  public getLastConfigHash(): string {
    return this.lastConfigHash;
  }

  public getAutosavePath(): string {
    return this.autosavePath;
  }

  public async testRoute(host: string): Promise<{ success: boolean; statusCode?: number; status?: number; latencyMs: number; error?: string }> {
    const startTime = Date.now();
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: 80,
          path: '/',
          method: 'HEAD',
          headers: { Host: host },
          timeout: 3000,
        },
        (res) => {
          const latencyMs = Math.max(1, Date.now() - startTime);
          const status = res.statusCode || 200;
          resolve({ success: status < 500, statusCode: status, status, latencyMs });
        }
      );

      req.on('error', (err) => {
        const latencyMs = Math.max(1, Date.now() - startTime);
        resolve({ success: false, statusCode: 502, status: 502, latencyMs, error: err.message });
      });
      req.on('timeout', () => {
        req.destroy();
        const latencyMs = Math.max(1, Date.now() - startTime);
        resolve({ success: false, statusCode: 504, status: 504, latencyMs, error: 'Connection timed out' });
      });
      req.end();
    });
  }
}

export const caddyManager = new CaddyManager(new PrismaManager());
