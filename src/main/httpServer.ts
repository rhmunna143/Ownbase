import http from 'http';
import os from 'os';
import { app } from 'electron';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { ProcessSupervisor } from './supervisor';
import { CaddyManager } from './caddy';
import { TailscaleManager } from './tailscale';
import { LifecycleManager } from './lifecycle';
import { logger } from './logger';
import { BootstrapStep, SystemInfo } from '../shared/types';

export class WebApiServer {
  private server: http.Server | null = null;
  private port: number = 3001;

  constructor(
    private postgresManager: PostgresManager,
    private prismaManager: PrismaManager,
    private supervisor: ProcessSupervisor,
    private caddyManager: CaddyManager,
    private tailscaleManager: TailscaleManager,
    private lifecycleManager: LifecycleManager,
    private getBootstrapSteps: () => BootstrapStep[]
  ) {}

  public start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        // Universal CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        const pathname = parsedUrl.pathname;

        try {
          if (pathname === '/api/system-info' && req.method === 'GET') {
            const interfaces = os.networkInterfaces();
            let localIp = '127.0.0.1';
            let tailscaleIp: string | undefined = undefined;
            const allIps: string[] = [];

            for (const name of Object.keys(interfaces)) {
              const netList = interfaces[name];
              if (!netList) continue;
              for (const net of netList) {
                if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
                  allIps.push(net.address);
                  if (name.toLowerCase().includes('tailscale') || net.address.startsWith('100.')) {
                    tailscaleIp = net.address;
                  } else if (localIp === '127.0.0.1') {
                    localIp = net.address;
                  }
                }
              }
            }

            const info: SystemInfo = {
              platform: os.platform(),
              arch: os.arch(),
              release: os.release(),
              nodeVersion: process.versions.node,
              electronVersion: process.versions.electron,
              appDataDir: (app && typeof app.getPath === 'function') ? app.getPath('userData') : process.cwd(),
              appVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : '0.1.0',
              totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
              freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
              localIp,
              tailscaleIp,
              allIps,
            };
            this.sendJson(res, info);
            return;
          }

          if (pathname === '/api/postgres-status' && req.method === 'GET') {
            this.sendJson(res, this.postgresManager.getStatus());
            return;
          }

          if (pathname === '/api/migration-status' && req.method === 'GET') {
            this.sendJson(res, this.prismaManager.getStatus());
            return;
          }

          if (pathname === '/api/bootstrap-steps' && req.method === 'GET') {
            this.sendJson(res, this.getBootstrapSteps());
            return;
          }

          if (pathname === '/api/ping-database' && req.method === 'POST') {
            const result = await this.prismaManager.ping();
            this.sendJson(res, result);
            return;
          }

          if (pathname === '/api/execute-query' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            try {
              const client = this.prismaManager.getClient();
              const result = await client.$queryRawUnsafe(body.sql);
              this.sendJson(res, { success: true, data: result });
            } catch (err: any) {
              this.sendJson(res, { success: false, error: err.message });
            }
            return;
          }

          if (pathname === '/api/services' && req.method === 'GET') {
            const services = await this.prismaManager.getServices();
            for (const s of services) {
              this.supervisor.registerService(s);
            }
            this.sendJson(res, services);
            return;
          }

          if (pathname === '/api/services' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const svc = await this.prismaManager.createService(body);
            this.supervisor.registerService(svc);
            this.sendJson(res, svc);
            return;
          }

          const serviceActionMatch = pathname.match(/^\/api\/services\/([^\/]+)\/(start|stop|restart|logs)$/);
          if (serviceActionMatch) {
            const [, serviceId, action] = serviceActionMatch;
            if (action === 'start' && req.method === 'POST') {
              const resStart = await this.supervisor.startService(serviceId);
              this.sendJson(res, resStart);
              return;
            }
            if (action === 'stop' && req.method === 'POST') {
              const resStop = await this.supervisor.stopService(serviceId);
              this.sendJson(res, resStop);
              return;
            }
            if (action === 'restart' && req.method === 'POST') {
              const resRestart = await this.supervisor.restartService(serviceId);
              this.sendJson(res, resRestart);
              return;
            }
            if (action === 'logs' && req.method === 'GET') {
              this.sendJson(res, this.supervisor.getServiceLogs(serviceId));
              return;
            }
          }

          if (pathname === '/api/process-statuses' && req.method === 'GET') {
            this.sendJson(res, this.supervisor.getAllStatuses());
            return;
          }

          if (pathname === '/api/routes' && req.method === 'GET') {
            this.sendJson(res, await this.prismaManager.getRoutes());
            return;
          }

          if (pathname === '/api/routes' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const r = await this.prismaManager.createRoute(body);
            await this.caddyManager.registerRoute(r);
            this.sendJson(res, r);
            return;
          }

          const routeDeleteMatch = pathname.match(/^\/api\/routes\/([^\/]+)$/);
          if (routeDeleteMatch && req.method === 'DELETE') {
            const routeId = routeDeleteMatch[1];
            try {
              const client = this.prismaManager.getClient();
              await client.route.delete({ where: { id: routeId } });
              await this.caddyManager.removeRoute(routeId);
              this.sendJson(res, { success: true });
            } catch {
              this.sendJson(res, { success: false });
            }
            return;
          }

          if (pathname === '/api/caddy/sync' && req.method === 'POST') {
            const result = await this.caddyManager.syncAllRoutes();
            this.sendJson(res, result);
            return;
          }

          if (pathname === '/api/caddy/status' && req.method === 'GET') {
            this.sendJson(res, await this.caddyManager.getStatus());
            return;
          }

          if (pathname === '/api/caddy/test' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, await this.caddyManager.testRoute(body.host, body.port || 80));
            return;
          }

          if (pathname === '/api/tailscale/status' && req.method === 'GET') {
            this.sendJson(res, await this.tailscaleManager.getStatus());
            return;
          }

          if (pathname === '/api/tailscale/connect' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, await this.tailscaleManager.connect(body.authKey, body.hostname));
            return;
          }

          if (pathname === '/api/tailscale/disconnect' && req.method === 'POST') {
            this.sendJson(res, await this.tailscaleManager.disconnect());
            return;
          }

          if (pathname === '/api/lifecycle/status' && req.method === 'GET') {
            this.sendJson(res, this.lifecycleManager.getStatus());
            return;
          }

          if (pathname === '/api/lifecycle/autostart' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, await this.lifecycleManager.setAutoStart(body.enabled, body.openAsHidden));
            return;
          }

          if (pathname === '/api/lifecycle/power-blocker' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, await this.lifecycleManager.setPowerSaveBlocker(body.enabled));
            return;
          }

          if (pathname === '/api/logs' && req.method === 'GET') {
            this.sendJson(res, logger.getLogs());
            return;
          }

          // Fallback 404
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Not found: ${req.method} ${pathname}` }));
        } catch (err: any) {
          logger.error('web-api', `Error handling ${req.method} ${pathname}: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        logger.success('web-api', `Native Windows Server Web API Bridge listening on http://127.0.0.1:${this.port}/api`);
        resolve(true);
      });

      this.server.on('error', (err) => {
        logger.error('web-api', `Web API server error: ${err.message}`);
        resolve(false);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private sendJson(res: http.ServerResponse, data: any, statusCode = 200) {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(json);
  }

  private parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  }
}
