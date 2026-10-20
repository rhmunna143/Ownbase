import http from 'http';
import os from 'os';
import { logger } from '../core/logger';
import { PrismaManager } from '../db/prisma';
import { RouteRecord, CaddyStatus } from '../../shared/types';

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

  public buildCaddyRouteConfig(route: RouteRecord, localIp?: string) {
    const hostMatches: string[] = [];

    // 1. *.localhost subdomain
    hostMatches.push(`${route.subdomain}.localhost`);

    // 2. Local LAN IP nip.io wildcard
    if (localIp && localIp !== '127.0.0.1') {
      hostMatches.push(`${route.subdomain}.${localIp}.nip.io`);
    }

    // 3. Custom domain if provided
    if (route.customDomain) {
      hostMatches.push(route.customDomain.trim());
    }

    return {
      match: [
        {
          host: hostMatches,
        },
      ],
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [
            {
              dial: `127.0.0.1:${route.targetPort}`,
            },
          ],
        },
      ],
      terminal: true,
    };
  }

  public async syncAllRoutes(): Promise<{ success: boolean; count: number; error?: string }> {
    logger.info('caddy', 'Synchronizing all application routes to Caddy reverse proxy...');

    try {
      const routes = await this.prismaManager.getRoutes();

      // Determine local IP for .nip.io mapping
      const interfaces = os.networkInterfaces();
      let localIp = '127.0.0.1';
      for (const name of Object.keys(interfaces)) {
        const netList = interfaces[name];
        if (!netList) continue;
        for (const net of netList) {
          if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
            if (!name.toLowerCase().includes('tailscale')) {
              localIp = net.address;
              break;
            }
          }
        }
      }

      // Build Caddy routes
      const caddyRoutes: any[] = [];

      // Add API and frontend proxy routes
      caddyRoutes.push({
        match: [{ path: ['/api/*', '/_next/*', '/favicon.ico'] }],
        handle: [
          {
            handler: 'reverse_proxy',
            upstreams: [{ dial: '127.0.0.1:3001' }],
          },
        ],
      });

      // Default root path to frontend
      caddyRoutes.push({
        match: [{ path: ['/'] }],
        handle: [
          {
            handler: 'reverse_proxy',
            upstreams: [{ dial: '127.0.0.1:3001' }],
          },
        ],
      });

      for (const r of routes) {
        caddyRoutes.push(this.buildCaddyRouteConfig(r, localIp));
      }

      const fullCaddyConfig = {
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

      const res = await this.request('POST', '/load', fullCaddyConfig);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logger.success('caddy', `Loaded ${caddyRoutes.length} active routes into Caddy Admin.`);
        return { success: true, count: routes.length };
      } else {
        const errMsg = `Caddy returned HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`;
        logger.error('caddy', errMsg);
        return { success: false, count: 0, error: errMsg };
      }
    } catch (err: any) {
      logger.error('caddy', `Route synchronization failed: ${err.message}`);
      return { success: false, count: 0, error: err.message };
    }
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
