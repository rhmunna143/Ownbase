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
    for (const r of routes) {
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

      const isProtected = r.requiresAuth === true || r.subdomain === 'ai';
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
                  upstreams: [{ dial: '127.0.0.1:3001' }],
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
                              body: '<html><body style="font-family:sans-serif;padding:2rem;background:#0f172a;color:#f8fafc"><h2>Access Restricted</h2><p>Authentication required to access this service on LAN/remote network.</p><a href="/" style="color:#38bdf8">Sign in to Ownbase</a></body></html>',
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
          upstreams: [{ dial: '127.0.0.1:3001' }],
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
          upstreams: [{ dial: '127.0.0.1:3001' }],
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

  public async testRoute(host: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
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
          resolve({ success: (res.statusCode || 0) < 500, statusCode: res.statusCode });
        }
      );

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Connection timed out' });
      });
      req.end();
    });
  }
}

export const caddyManager = new CaddyManager(new PrismaManager());
