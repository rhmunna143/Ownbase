import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { ProcessSupervisor } from './supervisor';
import { CaddyManager } from './caddy';
import { TailscaleManager } from './tailscale';
import { LifecycleManager } from './lifecycle';
import { FileManager } from './fileManager';
import { API_ENDPOINTS, getOpenApiSpec } from './openApiSpec';
import { logger } from './logger';
import { BootstrapStep, SystemInfo } from '../shared/types';

export class WebApiServer {
  private server: http.Server | null = null;
  private port: number = 3001;
  private fileManager: FileManager;

  constructor(
    private postgresManager: PostgresManager,
    private prismaManager: PrismaManager,
    private supervisor: ProcessSupervisor,
    private caddyManager: CaddyManager,
    private tailscaleManager: TailscaleManager,
    private lifecycleManager: LifecycleManager,
    private getBootstrapSteps: () => BootstrapStep[],
    port: number = 3001
  ) {
    this.port = port;
    this.fileManager = new FileManager();
  }

  public getPort(): number {
    return this.port;
  }

  public getFileManager(): FileManager {
    return this.fileManager;
  }

  public start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        // Universal CORS headers for web & mobile clients
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        const pathname = parsedUrl.pathname;

        try {
          // ==========================================
          // 1. SYSTEM & SUPERVISOR APIS
          // ==========================================
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

          // ==========================================
          // 2. FILE EXPLORER & MOBILE MEDIA STREAMING
          // ==========================================
          if (pathname === '/api/files/list' && req.method === 'GET') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            const list = this.fileManager.listFiles(subPath);
            this.sendJson(res, list);
            return;
          }

          if (pathname === '/api/files/stream' && req.method === 'GET') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.fileManager.streamMedia(subPath, req, res);
            return;
          }

          if (pathname === '/api/files/download' && req.method === 'GET') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.fileManager.downloadFile(subPath, res);
            return;
          }

          if (pathname === '/api/files/content' && req.method === 'GET') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            const text = this.fileManager.readFileContent(subPath);
            this.sendJson(res, { content: text });
            return;
          }

          if (pathname === '/api/files/mkdir' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const ok = this.fileManager.createDirectory(body.targetPath || '', body.folderName || 'New Folder');
            this.sendJson(res, { success: ok });
            return;
          }

          if (pathname === '/api/files/rename' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const ok = this.fileManager.renameItem(body.oldPath, body.newName);
            this.sendJson(res, { success: ok });
            return;
          }

          if (pathname === '/api/files/delete' && (req.method === 'DELETE' || req.method === 'POST')) {
            const body = req.method === 'DELETE'
              ? { path: parsedUrl.searchParams.get('path') || '' }
              : await this.parseJsonBody(req);
            const ok = this.fileManager.deleteItem(body.path);
            this.sendJson(res, { success: ok });
            return;
          }

          if (pathname === '/api/files/upload' && req.method === 'POST') {
            const targetPath = parsedUrl.searchParams.get('targetPath') || '';
            const filename = parsedUrl.searchParams.get('filename') || `upload_${Date.now()}`;
            const buffer = await this.readRawBody(req);
            const savedPath = this.fileManager.saveFileBuffer(targetPath, filename, buffer);
            this.sendJson(res, { success: true, path: savedPath });
            return;
          }

          // ==========================================
          // 3. GOOGLE PHOTOS & MEMORIES GALLERY
          // ==========================================
          if (pathname === '/api/photos/timeline' && req.method === 'GET') {
            const favoritesOnly = parsedUrl.searchParams.get('favoritesOnly') === 'true';
            const typeFilter = parsedUrl.searchParams.get('type') as any || 'all';
            const photosData = this.fileManager.getPhotosTimeline({
              favoritesOnly,
              type: typeFilter,
            });
            this.sendJson(res, photosData);
            return;
          }

          if (pathname === '/api/photos/media' && req.method === 'GET') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.fileManager.streamMedia(subPath, req, res);
            return;
          }

          if (pathname === '/api/photos/favorite' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const isFav = this.fileManager.toggleFavorite(body.path);
            this.sendJson(res, { success: true, isFavorite: isFav });
            return;
          }

          // ==========================================
          // 4. OPENAPI 3.0 & INTERACTIVE DOCS
          // ==========================================
          if (pathname === '/api/openapi.json' && req.method === 'GET') {
            const host = req.headers.host || `127.0.0.1:${this.port}`;
            this.sendJson(res, getOpenApiSpec(host));
            return;
          }

          if (pathname === '/api/docs/endpoints' && req.method === 'GET') {
            this.sendJson(res, API_ENDPOINTS);
            return;
          }

          // ==========================================
          // 5. STATIC WEB APP SERVING (Next.js out/ for mobile & remote clients)
          // ==========================================
          if (!pathname.startsWith('/api')) {
            const served = await this.serveStaticFile(req, res, pathname);
            if (served) return;
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

      // Bind to 0.0.0.0 so phones on local Wi-Fi / LAN and Tailscale mesh can connect directly
      this.server.listen(this.port, '0.0.0.0', () => {
        logger.success('web-api', `Native Windows Server Web API & Mobile Gateway listening on http://0.0.0.0:${this.port}`);
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
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

  private readRawBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      req.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
  }

  private async serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<boolean> {
    const candidateDirs = [
      path.join(process.cwd(), 'out'),
      path.join(__dirname, '..', '..', 'out'),
      path.join(__dirname, '..', '..', '..', 'out'),
    ];

    try {
      if (app && typeof app.getAppPath === 'function') {
        candidateDirs.unshift(path.join(app.getAppPath(), 'out'));
      }
    } catch {}

    let outDir: string | null = null;
    for (const d of candidateDirs) {
      if (fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html'))) {
        outDir = d;
        break;
      }
    }

    if (!outDir) return false;

    // Clean pathname
    let relPath = pathname.replace(/^\/+/, '');
    const host = (req.headers.host || '').toLowerCase();
    if ((!relPath || relPath === '/') && host.startsWith('photos.')) {
      if (fs.existsSync(path.join(outDir, 'photos', 'index.html'))) {
        relPath = 'photos/index.html';
      } else if (fs.existsSync(path.join(outDir, 'photos.html'))) {
        relPath = 'photos.html';
      } else {
        relPath = 'index.html';
      }
    } else if (!relPath || relPath === '/') {
      relPath = 'index.html';
    }

    let targetFile = path.join(outDir, relPath);

    // If target is directory, look for index.html
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
      targetFile = path.join(targetFile, 'index.html');
    }

    // Try HTML extension fallback (e.g. /about -> /about.html)
    if (!fs.existsSync(targetFile) && fs.existsSync(`${targetFile}.html`)) {
      targetFile = `${targetFile}.html`;
    }

    // SPA fallback to index.html
    if (!fs.existsSync(targetFile)) {
      targetFile = path.join(outDir, 'index.html');
    }

    if (fs.existsSync(targetFile) && !fs.statSync(targetFile).isDirectory()) {
      const mime = this.fileManager.getMimeType(targetFile);
      const stat = fs.statSync(targetFile);

      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
        'Cache-Control': relPath.startsWith('_next/static') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });

      fs.createReadStream(targetFile).pipe(res);
      return true;
    }

    return false;
  }
}
