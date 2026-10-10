import http from 'http';
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
    const initConfig = {
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [':80'],
              routes: [],
            },
          },
        },
      },
    };

    const res = await this.request('POST', '/load', initConfig);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      logger.success('caddy', 'Caddy HTTP server srv0 initialized successfully.');
      return true;
    }
    throw new Error(`Failed to initialize Caddy HTTP server: ${JSON.stringify(res.data)}`);
  }

  public async registerRoute(route: RouteRecord): Promise<boolean> {
    await this.ensureServerInitialized();

    const hosts = [`${route.subdomain}.localhost`];
    if (route.customDomain) {
      hosts.push(route.customDomain);
    }

    const payload = {
      '@id': `route-${route.id}`,
      match: [
        {
          host: hosts,
        },
      ],
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
    };

    logger.info('caddy', `POSTing dynamic route payload to Caddy REST API for ${hosts.join(', ')} -> ${route.targetHost}:${route.targetPort}`);

    // Remove existing if present to avoid duplicate ID
    try {
      await this.request('DELETE', `/id/route-${route.id}`);
    } catch {}

    const res = await this.request('POST', '/config/apps/http/servers/srv0/routes', payload);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      logger.success('caddy', `Route for ${hosts.join(', ')} dynamically registered in Caddy without server restart.`);
      return true;
    }

    throw new Error(`Caddy API error (${res.statusCode}): ${JSON.stringify(res.data)}`);
  }

  public async removeRoute(routeId: string): Promise<boolean> {
    logger.info('caddy', `Removing dynamic route route-${routeId} from Caddy...`);
    try {
      const res = await this.request('DELETE', `/id/route-${routeId}`);
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch (err: any) {
      logger.warn('caddy', `Could not delete route-${routeId} from Caddy: ${err.message}`);
      return false;
    }
  }

  public async syncAllRoutes(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      await this.ensureServerInitialized();
      const routes = await this.prismaManager.getRoutes();
      const activeRoutes = routes.filter((r) => r.isActive);

      logger.info('caddy', `Synchronizing ${activeRoutes.length} routes from PostgreSQL to Caddy Admin API...`);
      for (const route of activeRoutes) {
        await this.registerRoute(route);
      }

      return { success: true, count: activeRoutes.length };
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
}
