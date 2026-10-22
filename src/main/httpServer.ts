import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import cookie from 'cookie';
import { app } from 'electron';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { ProcessSupervisor } from './supervisor';
import { CaddyManager } from './caddy';
import { TailscaleManager } from './tailscale';
import { LifecycleManager } from './lifecycle';
import { FileManager } from './fileManager';
import { logger } from './logger';
import { BootstrapStep, SystemInfo } from '../shared/types';
import {
  matchRoute,
  generateOpenApiSpec,
  getEndpointCatalog,
  SetupRequestSchema,
  LoginRequestSchema,
  CreateUserRequestSchema,
  CreateApiKeyRequestSchema,
  CreateRouteRequestSchema,
  AuthenticatedUser,
  Role,
} from '../shared/contract';
import { AuthService } from './auth/authService';
import { AuditService } from './auth/audit';
import { SetupService } from './auth/setup';
import { AuthGuard } from './auth/guard';
import { loginThrottle } from './auth/throttle';
import { TableBrowser } from './db/browser';

export class WebApiServer {
  private server: http.Server | null = null;
  private port: number = 3001;
  private fileManager: FileManager;
  private authService: AuthService;
  private auditService: AuditService;
  private setupService: SetupService;
  private authGuard: AuthGuard;
  private tableBrowser: TableBrowser;

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
    this.authService = new AuthService(this.prismaManager);
    this.auditService = new AuditService(this.prismaManager);
    this.setupService = new SetupService(this.prismaManager, this.authService, this.auditService);
    this.authGuard = new AuthGuard(this.authService);
    this.tableBrowser = new TableBrowser(this.prismaManager);
  }

  public getPort(): number {
    return this.port;
  }

  public getFileManager(): FileManager {
    return this.fileManager;
  }

  public getAuthService(): AuthService {
    return this.authService;
  }

  public getAuthGuard(): AuthGuard {
    return this.authGuard;
  }

  public getTableBrowser(): TableBrowser {
    return this.tableBrowser;
  }

  public getAuditService(): AuditService {
    return this.auditService;
  }

  public getSetupService(): SetupService {
    return this.setupService;
  }

  public start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        // HTTP Hardening & Security Headers (PRD Item 1.12)
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;");
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Set-Cookie');

        // Universal CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        const pathname = parsedUrl.pathname;

        try {
          // ==========================================
          // 1. STATIC ASSETS (Next.js out/ web app)
          // ==========================================
          if (!pathname.startsWith('/api')) {
            const served = await this.serveStaticFile(req, res, pathname);
            if (served) return;

            // Fallback 404 for unhandled static paths
            this.sendJson(res, { error: `Not found: ${req.method} ${pathname}` }, 404);
            return;
          }

          // ==========================================
          // 2. CONTRACT ROUTE MATCHING (PRD Item 1.1)
          // "A route not in the table does not exist"
          // ==========================================
          const { route, params } = matchRoute(req.method || 'GET', pathname);
          if (!route) {
            this.sendJson(res, { error: `Not found: ${req.method} ${pathname}` }, 404);
            return;
          }

          // ==========================================
          // 3. CENTRALIZED RBAC GUARD (PRD Item 1.6)
          // ==========================================
          const decision = await this.authGuard.evaluate(req, route);
          if (!decision.allowed) {
            this.sendJson(res, { error: decision.error || 'Unauthorized' }, decision.statusCode || 401);
            return;
          }

          const clientIp = this.getClientIp(req);

          // ==========================================
          // 4. ROUTE DISPATCH & HANDLERS
          // ==========================================

          // --- PUBLIC PROBES & SETUP ---
          if (route.path === '/api/v1/health') {
            this.sendJson(res, { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
            return;
          }

          if (route.path === '/api/v1/setup/status') {
            this.sendJson(res, await this.setupService.getStatus());
            return;
          }

          if (route.path === '/api/v1/setup') {
            const body = await this.parseJsonBody(req);
            const parsed = SetupRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid setup payload', details: parsed.error.issues }, 400);
              return;
            }
            const isLoopback = this.isLoopbackRequest(req);
            const result = await this.setupService.executeSetup({
              username: parsed.data.username,
              password: parsed.data.password,
              isLoopback,
              setupToken: parsed.data.setupToken,
              ipAddress: clientIp,
            });
            if (!result.success) {
              this.sendJson(res, { error: result.error }, 400);
              return;
            }
            this.sendJson(res, result, 201);
            return;
          }

          // --- AUTHENTICATION & TOKENS ---
          if (route.path === '/api/v1/auth/login') {
            const body = await this.parseJsonBody(req);
            const parsed = LoginRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid login payload', details: parsed.error.issues }, 400);
              return;
            }

            // Login throttle check (PRD Item 1.5)
            const throttleCheck = loginThrottle.check(clientIp, parsed.data.username);
            if (!throttleCheck.allowed) {
              res.setHeader('Retry-After', String(throttleCheck.retryAfterSeconds || 30));
              this.sendJson(
                res,
                { error: `Too many failed attempts. Try again in ${throttleCheck.retryAfterSeconds}s.` },
                429
              );
              return;
            }

            const releaseSlot = await loginThrottle.acquireHashSlot();
            try {
              const client = this.prismaManager.getClient();
              const user = client && (client as any).user
                ? await (client as any).user.findUnique({ where: { username: parsed.data.username } })
                : null;

              let valid = false;
              if (user && user.isActive) {
                valid = await this.authService.verifyPassword(user.passwordHash, parsed.data.password);
              }

              if (!valid || !user) {
                loginThrottle.recordFailure(clientIp, parsed.data.username);
                await this.auditService.record({
                  action: 'auth.login',
                  status: 'failure',
                  ipAddress: clientIp,
                  details: { username: parsed.data.username, reason: 'Invalid credentials' },
                });
                this.sendJson(res, { error: 'Invalid username or password' }, 401);
                return;
              }

              loginThrottle.recordSuccess(clientIp, parsed.data.username);
              const authUser: AuthenticatedUser = {
                id: user.id,
                username: user.username,
                role: user.role as Role,
              };

              const accessToken = await this.authService.generateAccessToken(authUser);
              const refreshToken = await this.authService.generateRefreshToken(user.id);

              res.setHeader(
                'Set-Cookie',
                `ownbase_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
              );

              await this.auditService.record({
                actorId: user.id,
                actorName: user.username,
                action: 'auth.login',
                status: 'success',
                ipAddress: clientIp,
              });

              this.sendJson(res, { accessToken, refreshToken, user: authUser });
            } finally {
              releaseSlot();
            }
            return;
          }

          if (route.path === '/api/v1/auth/refresh') {
            const body = await this.parseJsonBody(req);
            let rawToken = body?.refreshToken;
            if (!rawToken && req.headers.cookie) {
              const cookies = cookie.parse(req.headers.cookie);
              rawToken = cookies['ownbase_refresh'];
            }

            if (!rawToken) {
              this.sendJson(res, { error: 'Refresh token required' }, 400);
              return;
            }

            const rotated = await this.authService.rotateRefreshToken(rawToken);
            if (!rotated) {
              this.sendJson(res, { error: 'Invalid or expired refresh token' }, 401);
              return;
            }

            res.setHeader(
              'Set-Cookie',
              `ownbase_refresh=${rotated.newRefreshToken}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
            );
            this.sendJson(res, rotated);
            return;
          }

          if (route.path === '/api/v1/auth/logout') {
            const body = await this.parseJsonBody(req);
            let rawToken = body?.refreshToken;
            if (!rawToken && req.headers.cookie) {
              const cookies = cookie.parse(req.headers.cookie);
              rawToken = cookies['ownbase_refresh'];
            }

            if (rawToken) {
              await this.authService.revokeRefreshToken(rawToken);
            }

            res.setHeader('Set-Cookie', 'ownbase_refresh=; Path=/api/v1/auth; HttpOnly; Max-Age=0');
            this.sendJson(res, { success: true });
            return;
          }

          if (route.path === '/api/v1/auth/me') {
            this.sendJson(res, { user: decision.user });
            return;
          }

          if (route.path === '/api/v1/auth/ws-ticket') {
            const ticket = this.authGuard.issueWsTicket(decision.user!);
            this.sendJson(res, { ticket });
            return;
          }

          // --- SYSTEM TELEMETRY & STATUS ---
          if (route.path === '/api/v1/system-info') {
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

          if (route.path === '/api/v1/postgres-status') {
            this.sendJson(res, this.postgresManager.getStatus());
            return;
          }

          if (route.path === '/api/v1/migration-status') {
            this.sendJson(res, this.prismaManager.getStatus());
            return;
          }

          if (route.path === '/api/v1/bootstrap-steps') {
            try {
              const tsStatus = await this.tailscaleManager.getStatus();
              const steps = this.getBootstrapSteps();
              const tsStep = steps.find((s) => s.id === 'tailscale-mesh');
              if (tsStep) {
                if (tsStatus.connected) {
                  tsStep.status = 'success';
                  tsStep.detail = tsStatus.ip ? `Connected (Mesh IP: ${tsStatus.ip})` : 'Connected to mesh network';
                  tsStep.timestamp = new Date().toISOString();
                } else if (tsStep.status === 'success') {
                  tsStep.status = 'pending';
                  tsStep.detail = 'Tailscale CLI ready (configure Auth Key to connect)';
                  tsStep.timestamp = new Date().toISOString();
                }
              }
            } catch {}
            this.sendJson(res, this.getBootstrapSteps());
            return;
          }

          if (route.path === '/api/v1/ping-database') {
            const result = await this.prismaManager.ping();
            this.sendJson(res, result);
            return;
          }

          if (route.path === '/api/v1/process-statuses') {
            this.sendJson(res, this.supervisor.getAllStatuses());
            return;
          }

          if (route.path === '/api/v1/logs') {
            this.sendJson(res, logger.getLogs());
            return;
          }

          // --- SERVICES & PROCESS SUPERVISOR ---
          if (route.path === '/api/v1/services' && req.method === 'GET') {
            const services = await this.prismaManager.getServices();
            for (const s of services) {
              this.supervisor.registerService(s);
            }
            this.sendJson(res, services);
            return;
          }

          if (route.path === '/api/v1/services' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const svc = await this.prismaManager.createService(body);
            this.supervisor.registerService(svc);
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'service.create',
              entity: 'service',
              entityId: svc.id,
              ipAddress: clientIp,
              status: 'success',
              details: { name: svc.name, type: svc.type },
            });
            this.sendJson(res, svc, 201);
            return;
          }

          if (route.path === '/api/v1/services/:id/start') {
            const resStart = await this.supervisor.startService(params.id);
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'service.start',
              entity: 'service',
              entityId: params.id,
              ipAddress: clientIp,
              status: resStart.success ? 'success' : 'failure',
            });
            this.sendJson(res, resStart);
            return;
          }

          if (route.path === '/api/v1/services/:id/stop') {
            const resStop = await this.supervisor.stopService(params.id);
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'service.stop',
              entity: 'service',
              entityId: params.id,
              ipAddress: clientIp,
              status: resStop.success ? 'success' : 'failure',
            });
            this.sendJson(res, resStop);
            return;
          }

          if (route.path === '/api/v1/services/:id/restart') {
            const resRestart = await this.supervisor.restartService(params.id);
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'service.restart',
              entity: 'service',
              entityId: params.id,
              ipAddress: clientIp,
              status: resRestart.success ? 'success' : 'failure',
            });
            this.sendJson(res, resRestart);
            return;
          }

          if (route.path === '/api/v1/services/:id/logs') {
            this.sendJson(res, this.supervisor.getServiceLogs(params.id));
            return;
          }

          // --- ROUTING & CADDY EDGE INGRESS ---
          if (route.path === '/api/v1/routes' && req.method === 'GET') {
            this.sendJson(res, await this.prismaManager.getRoutes());
            return;
          }

          if (route.path === '/api/v1/routes' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = CreateRouteRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid route payload', details: parsed.error.issues }, 400);
              return;
            }
            let serviceId: string = parsed.data.serviceId || 'default-service-id';
            const client = this.prismaManager.getClient();
            const isCustomOrFallback =
              !parsed.data.serviceId ||
              parsed.data.serviceId === 'custom' ||
              parsed.data.serviceId === 'default-service-id' ||
              parsed.data.serviceId === 'ownbase-hub';

            if (isCustomOrFallback) {
              let targetSvc = client && (client as any).service ? await (client as any).service.findFirst() : null;
              if (!targetSvc) {
                targetSvc = await (client as any).service.create({
                  data: {
                    name: 'Ownbase Web Hub',
                    type: 'ownbase',
                    executable: 'node.exe',
                    port: 3001,
                    status: 'running',
                    autoStart: true,
                    description: 'Central server management portal and web dashboard',
                  },
                });
              }
              serviceId = targetSvc.id;
            } else {
              const existingSvc = await (client as any).service.findUnique({ where: { id: serviceId } }).catch(() => null);
              if (!existingSvc) {
                const firstSvc = await (client as any).service.findFirst().catch(() => null);
                if (firstSvc) serviceId = firstSvc.id;
              }
            }

            try {
              const r = await this.prismaManager.createRoute({
                serviceId,
                subdomain: parsed.data.subdomain,
                targetPort: parsed.data.targetPort,
                tlsEnabled: parsed.data.tlsEnabled,
                customDomain: parsed.data.customDomain,
              });
              await this.caddyManager.registerRoute(r);
              await this.auditService.record({
                actorId: decision.user?.id,
                actorName: decision.user?.username,
                action: 'route.create',
                entity: 'route',
                entityId: r.id,
                ipAddress: clientIp,
                status: 'success',
                details: { subdomain: r.subdomain, port: r.targetPort, customDomain: r.customDomain },
              });
              this.sendJson(res, r, 201);
              return;
            } catch (createErr: any) {
              const errMsg = createErr.message || 'Failed to create route in database';
              const userFriendly = errMsg.includes('Unique constraint failed')
                ? `Route subdomain '${parsed.data.subdomain}' is already in use. Please choose a different subdomain.`
                : errMsg;
              this.sendJson(res, { error: userFriendly }, 400);
              return;
            }
          }

          if (route.path === '/api/v1/routes/:id' && req.method === 'DELETE') {
            try {
              const client = this.prismaManager.getClient();
              await client.route.delete({ where: { id: params.id } });
              await this.caddyManager.removeRoute(params.id);
              await this.auditService.record({
                actorId: decision.user?.id,
                actorName: decision.user?.username,
                action: 'route.delete',
                entity: 'route',
                entityId: params.id,
                ipAddress: clientIp,
                status: 'success',
              });
              this.sendJson(res, { success: true });
            } catch {
              this.sendJson(res, { success: false }, 400);
            }
            return;
          }

          if (route.path === '/api/v1/caddy/sync') {
            const result = await this.caddyManager.syncAllRoutes();
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'caddy.sync',
              ipAddress: clientIp,
              status: result.success ? 'success' : 'failure',
              details: { count: result.count },
            });
            this.sendJson(res, result);
            return;
          }

          if (route.path === '/api/v1/caddy/status') {
            this.sendJson(res, await this.caddyManager.getStatus());
            return;
          }

          if (route.path === '/api/v1/caddy/test') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, await this.caddyManager.testRoute(body.host, body.port || 80));
            return;
          }

          // --- TAILSCALE MESH ---
          if (route.path === '/api/v1/tailscale/status') {
            const status = await this.tailscaleManager.getStatus();
            const tsStep = this.getBootstrapSteps().find((s) => s.id === 'tailscale-mesh');
            if (tsStep) {
              if (status.connected) {
                tsStep.status = 'success';
                tsStep.detail = status.ip ? `Connected (Mesh IP: ${status.ip})` : 'Connected to mesh network';
                tsStep.timestamp = new Date().toISOString();
              } else if (tsStep.status === 'success') {
                tsStep.status = 'pending';
                tsStep.detail = 'Tailscale CLI ready (configure Auth Key to connect)';
                tsStep.timestamp = new Date().toISOString();
              }
            }
            this.sendJson(res, status);
            return;
          }

          if (route.path === '/api/v1/tailscale/connect') {
            const body = await this.parseJsonBody(req);
            const tsRes = await this.tailscaleManager.connect(body.authKey, body.hostname);
            if (tsRes.success) {
              const tsStep = this.getBootstrapSteps().find((s) => s.id === 'tailscale-mesh');
              if (tsStep) {
                tsStep.status = 'success';
                tsStep.detail = tsRes.ip ? `Connected (Mesh IP: ${tsRes.ip})` : 'Connected to mesh network';
                tsStep.timestamp = new Date().toISOString();
              }
            }
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'tailscale.connect',
              ipAddress: clientIp,
              status: tsRes.success ? 'success' : 'failure',
            });
            this.sendJson(res, tsRes);
            return;
          }

          if (route.path === '/api/v1/tailscale/disconnect') {
            const tsRes = await this.tailscaleManager.disconnect();
            if (tsRes.success) {
              const tsStep = this.getBootstrapSteps().find((s) => s.id === 'tailscale-mesh');
              if (tsStep) {
                tsStep.status = 'pending';
                tsStep.detail = 'Tailscale CLI ready (configure Auth Key to connect)';
                tsStep.timestamp = new Date().toISOString();
              }
            }
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'tailscale.disconnect',
              ipAddress: clientIp,
              status: tsRes.success ? 'success' : 'failure',
            });
            this.sendJson(res, tsRes);
            return;
          }

          // --- LIFECYCLE & POWER ---
          if (route.path === '/api/v1/lifecycle/status') {
            this.sendJson(res, this.lifecycleManager.getStatus());
            return;
          }

          if (route.path === '/api/v1/lifecycle/autostart') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, await this.lifecycleManager.setAutoStart(body.enabled, body.openAsHidden));
            return;
          }

          if (route.path === '/api/v1/lifecycle/power-blocker') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, await this.lifecycleManager.setPowerSaveBlocker(body.enabled));
            return;
          }

          // --- FILES & MEDIA ---
          if (route.path === '/api/v1/files/list') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.sendJson(res, this.fileManager.listFiles(subPath));
            return;
          }

          if (route.path === '/api/v1/files/stream') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.fileManager.streamMedia(subPath, req, res);
            return;
          }

          if (route.path === '/api/v1/files/download') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.fileManager.downloadFile(subPath, res);
            return;
          }

          if (route.path === '/api/v1/files/content') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.sendJson(res, { content: this.fileManager.readFileContent(subPath) });
            return;
          }

          if (route.path === '/api/v1/files/mkdir') {
            const body = await this.parseJsonBody(req);
            const ok = this.fileManager.createDirectory(body.targetPath || '', body.folderName || 'New Folder');
            this.sendJson(res, { success: ok });
            return;
          }

          if (route.path === '/api/v1/files/rename') {
            const body = await this.parseJsonBody(req);
            const ok = this.fileManager.renameItem(body.oldPath, body.newName);
            this.sendJson(res, { success: ok });
            return;
          }

          if (route.path === '/api/v1/files/delete') {
            const body = req.method === 'DELETE'
              ? { path: parsedUrl.searchParams.get('path') || '' }
              : await this.parseJsonBody(req);
            const ok = this.fileManager.deleteItem(body.path);
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'file.delete',
              ipAddress: clientIp,
              status: ok ? 'success' : 'failure',
              details: { path: body.path },
            });
            this.sendJson(res, { success: ok });
            return;
          }

          if (route.path === '/api/v1/files/upload') {
            const targetPath = parsedUrl.searchParams.get('targetPath') || '';
            const filename = parsedUrl.searchParams.get('filename') || `upload_${Date.now()}`;
            const buffer = await this.readRawBody(req);
            const savedPath = this.fileManager.saveFileBuffer(targetPath, filename, buffer);
            this.sendJson(res, { success: true, path: savedPath });
            return;
          }

          if (route.path === '/api/v1/services/upload-binary') {
            const rawFilename = (req.headers['x-filename'] as string) ||
              parsedUrl.searchParams.get('filename') ||
              `app_${Date.now()}.exe`;
            const baseName = path.basename(rawFilename).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
            const cleanFilename = baseName.toLowerCase().endsWith('.exe') || baseName.toLowerCase().endsWith('.bat') || baseName.toLowerCase().endsWith('.cmd')
              ? baseName
              : `${baseName}.exe`;

            const binDir = path.join(process.cwd(), 'extraResources', 'bin');
            if (!fs.existsSync(binDir)) {
              try { fs.mkdirSync(binDir, { recursive: true }); } catch {}
            }

            const buffer = await this.readRawBody(req);
            const targetFilePath = path.join(binDir, cleanFilename);
            fs.writeFileSync(targetFilePath, buffer);
            logger.info('supervisor', `Uploaded custom binary "${cleanFilename}" to ${binDir}`);
            this.sendJson(res, {
              success: true,
              filename: cleanFilename,
              path: targetFilePath,
              sizeBytes: buffer.length,
            }, 201);
            return;
          }

          if (route.path === '/api/v1/system/drives') {
            let drives: any[] = [];
            try {
              const { execSync } = require('child_process');
              const psCmd = `powershell.exe -NoProfile -Command "Get-Volume | Where-Object { $_.DriveLetter -ne $null } | Select-Object DriveLetter, FileSystemLabel, FileSystem, Size, SizeRemaining | ConvertTo-Json -Compress"`;
              const out = execSync(psCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
              if (out) {
                let parsed = JSON.parse(out);
                if (!Array.isArray(parsed)) parsed = [parsed];
                drives = parsed.map((item: any) => {
                  const size = Number(item.Size || 0);
                  const remaining = Number(item.SizeRemaining || 0);
                  return {
                    driveLetter: `${item.DriveLetter}:`,
                    label: item.FileSystemLabel || 'Local Disk',
                    fileSystem: item.FileSystem || 'NTFS',
                    totalBytes: String(item.Size || 0),
                    freeBytes: String(item.SizeRemaining || 0),
                    isSystemDrive: item.DriveLetter.toUpperCase() === (process.env.SystemDrive || 'C:').replace(':', '').toUpperCase(),
                    freePercentage: size > 0 ? Math.round((remaining * 100) / size) : 0,
                  };
                });
              }
            } catch {}
            if (drives.length === 0) {
              drives = [{
                driveLetter: 'C:',
                label: 'Windows OS',
                fileSystem: 'NTFS',
                totalBytes: '107374182400',
                freeBytes: '53687091200',
                isSystemDrive: true,
                freePercentage: 50,
              }];
            }
            this.sendJson(res, drives);
            return;
          }

          if (route.path === '/api/v1/system/storage-allocation' && req.method === 'GET') {
            const appData = (app && typeof app.getPath === 'function')
              ? app.getPath('userData')
              : path.join(process.env.APPDATA || '.', 'native-windows-server-hub');
            const systemDrive = process.env.SystemDrive || 'C:';
            this.sendJson(res, {
              selectedDrive: systemDrive,
              storageRoot: path.join(appData, 'storage'),
              mediaRoot: path.join(appData, 'storage', 'Photos'),
              backupsRoot: path.join(appData, 'backups'),
            });
            return;
          }

          if (route.path === '/api/v1/system/storage-allocation' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const selectedDrive = body.selectedDrive ? `${body.selectedDrive.replace(':', '')}:` : (process.env.SystemDrive || 'C:');
            const storageRoot = body.storageRoot || path.join(process.cwd(), 'data', 'storage');
            const mediaRoot = body.mediaRoot || path.join(storageRoot, 'Photos');
            const backupsRoot = body.backupsRoot || path.join(process.cwd(), 'data', 'backups');

            for (const d of [storageRoot, mediaRoot, backupsRoot]) {
              if (d && !fs.existsSync(d)) {
                try { fs.mkdirSync(d, { recursive: true }); } catch {}
              }
            }

            this.sendJson(res, {
              success: true,
              storageAllocation: {
                selectedDrive,
                storageRoot,
                mediaRoot,
                backupsRoot,
              },
            });
            return;
          }

          if (route.path === '/api/v1/system/ssh-status') {
            let isInstalled = false;
            let isRunning = false;
            try {
              const { execSync } = require('child_process');
              const statusOut = execSync('powershell.exe -NoProfile -Command "(Get-Service sshd -ErrorAction SilentlyContinue).Status"', { encoding: 'utf-8', timeout: 3000 }).trim();
              if (statusOut) {
                isInstalled = true;
                isRunning = statusOut.toLowerCase() === 'running';
              }
            } catch {}
            this.sendJson(res, {
              installed: isInstalled,
              running: isRunning,
              port: 22,
              host: '127.0.0.1',
            });
            return;
          }

          if (route.path === '/api/v1/system/ssh-toggle' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const enable = body.enable !== false;
            try {
              const { execSync } = require('child_process');
              if (enable) {
                const serviceExists = execSync('powershell.exe -NoProfile -Command "[bool](Get-Service sshd -ErrorAction SilentlyContinue)"', { encoding: 'utf-8', timeout: 4000 }).trim();
                if (serviceExists.toLowerCase() !== 'true') {
                  try {
                    execSync('powershell.exe -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList \\"-NoProfile -Command Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Start-Service sshd; Set-Service -Name sshd -StartupType Automatic; ssh-keygen -A\\""', { timeout: 15000 });
                  } catch {
                    this.sendJson(res, {
                      success: false,
                      error: 'OpenSSH Server requires Administrator privilege to install. Run the command below in an elevated PowerShell terminal.',
                      requiresAdmin: true,
                      command: 'Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Start-Service sshd; Set-Service -Name sshd -StartupType Automatic',
                    });
                    return;
                  }
                } else {
                  execSync('powershell.exe -NoProfile -Command "ssh-keygen -A -ErrorAction SilentlyContinue; Start-Service sshd -ErrorAction SilentlyContinue; Set-Service -Name sshd -StartupType Automatic -ErrorAction SilentlyContinue"', { timeout: 8000 });
                }
              } else {
                execSync('powershell.exe -NoProfile -Command "Stop-Service sshd -ErrorAction SilentlyContinue"', { timeout: 8000 });
              }

              const checkOut = execSync('powershell.exe -NoProfile -Command "(Get-Service sshd -ErrorAction SilentlyContinue).Status"', { encoding: 'utf-8', timeout: 3000 }).trim();
              const isRunning = checkOut.toLowerCase() === 'running';

              this.sendJson(res, {
                success: enable ? isRunning : !isRunning,
                running: isRunning,
                error: (enable && !isRunning) ? 'Failed to start sshd service. Windows Administrator privilege may be required.' : undefined,
                command: (enable && !isRunning) ? 'Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Start-Service sshd' : undefined,
              });
            } catch (err: any) {
              this.sendJson(res, {
                success: false,
                error: err.message || 'Error configuring SSH service',
                command: 'Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Start-Service sshd',
              }, 200);
            }
            return;
          }

          if (route.path === '/api/v1/system/firewall-rules' && req.method === 'POST') {
            try {
              const { execSync } = require('child_process');
              const cmd = `powershell.exe -NoProfile -Command "New-NetFirewallRule -DisplayName 'Ownbase Server' -Direction Inbound -LocalPort 80,443,2019,3000,3001,5432,6379,7681,8080,8090,8384,9000,11434 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue"`;
              execSync(cmd, { timeout: 8000 });
              this.sendJson(res, { success: true, message: 'Windows Firewall inbound rule applied for Ownbase server ports' });
            } catch (err: any) {
              this.sendJson(res, { success: false, error: err.message }, 500);
            }
            return;
          }

          // --- PHOTOS GALLERY ---
          if (route.path === '/api/v1/photos/timeline') {
            const favoritesOnly = parsedUrl.searchParams.get('favoritesOnly') === 'true';
            const typeFilter = (parsedUrl.searchParams.get('type') as any) || 'all';
            const photosData = this.fileManager.getPhotosTimeline({
              favoritesOnly,
              type: typeFilter,
            });
            this.sendJson(res, photosData);
            return;
          }

          if (route.path === '/api/v1/photos/media') {
            const subPath = parsedUrl.searchParams.get('path') || '';
            this.fileManager.streamMedia(subPath, req, res);
            return;
          }

          if (route.path === '/api/v1/photos/favorites' || route.path === '/api/v1/photos/favorite') {
            const body = await this.parseJsonBody(req);
            const isFav = this.fileManager.toggleFavorite(body.path);
            this.sendJson(res, { success: true, isFavorite: isFav });
            return;
          }

          // --- TABLE BROWSER (Item 1.7) ---
          if (route.path === '/api/v1/db/tables') {
            this.sendJson(res, { tables: this.tableBrowser.getPermittedTables() });
            return;
          }

          if (route.path === '/api/v1/db/tables/:table/rows') {
            const tableName = params.table;
            const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
            const pageSize = parseInt(parsedUrl.searchParams.get('pageSize') || '25', 10);
            const orderBy = parsedUrl.searchParams.get('orderBy') || undefined;
            const orderDir = (parsedUrl.searchParams.get('orderDir') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';

            try {
              const result = await this.tableBrowser.queryTable(tableName, {
                page,
                pageSize,
                orderBy,
                orderDir,
              });
              this.sendJson(res, result);
            } catch (err: any) {
              this.sendJson(res, { error: err.message }, 400);
            }
            return;
          }

          // --- AUDIT LOGS ---
          if (route.path === '/api/v1/audit/logs') {
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
            const logs = await this.auditService.getRecentLogs(limit);
            this.sendJson(res, logs);
            return;
          }

          // --- USERS MANAGEMENT (ROOT only) ---
          if (route.path === '/api/v1/users' && req.method === 'GET') {
            const client = this.prismaManager.getClient();
            const users = await (client as any).user.findMany({
              select: {
                id: true,
                username: true,
                role: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { createdAt: 'asc' },
            });
            this.sendJson(res, users);
            return;
          }

          if (route.path === '/api/v1/users' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = CreateUserRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid user payload', details: parsed.error.issues }, 400);
              return;
            }

            const client = this.prismaManager.getClient();
            const existing = await (client as any).user.findUnique({
              where: { username: parsed.data.username },
            });
            if (existing) {
              this.sendJson(res, { error: `User '${parsed.data.username}' already exists` }, 409);
              return;
            }

            const passwordHash = await this.authService.hashPassword(parsed.data.password);
            const created = await (client as any).user.create({
              data: {
                username: parsed.data.username,
                passwordHash,
                role: parsed.data.role,
                isActive: true,
              },
              select: { id: true, username: true, role: true, isActive: true, createdAt: true },
            });

            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'user.create',
              entity: 'user',
              entityId: created.id,
              ipAddress: clientIp,
              status: 'success',
              details: { username: created.username, role: created.role },
            });

            this.sendJson(res, created, 201);
            return;
          }

          // --- API KEYS MANAGEMENT (ROOT only) ---
          if (route.path === '/api/v1/api-keys' && req.method === 'GET') {
            const client = this.prismaManager.getClient();
            const keys = await (client as any).apiKey.findMany({
              select: {
                id: true,
                name: true,
                prefix: true,
                role: true,
                expiresAt: true,
                lastUsedAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
            });
            this.sendJson(res, keys);
            return;
          }

          if (route.path === '/api/v1/api-keys' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = CreateApiKeyRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid api key payload', details: parsed.error.issues }, 400);
              return;
            }

            const keyData = await this.authService.createApiKey(
              decision.user!.id,
              parsed.data.name,
              parsed.data.role,
              parsed.data.expiresInDays
            );

            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'api_key.create',
              entity: 'api_key',
              entityId: keyData.id,
              ipAddress: clientIp,
              status: 'success',
              details: { name: keyData.name, prefix: keyData.prefix, role: keyData.role },
            });

            this.sendJson(res, keyData, 201);
            return;
          }

          if (route.path === '/api/v1/api-keys/:id' && req.method === 'DELETE') {
            const client = this.prismaManager.getClient();
            await (client as any).apiKey.delete({ where: { id: params.id } });
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'api_key.revoke',
              entity: 'api_key',
              entityId: params.id,
              ipAddress: clientIp,
              status: 'success',
            });
            this.sendJson(res, { success: true });
            return;
          }

          // --- OPENAPI & DOCS ---
          if (route.path === '/api/v1/openapi.json') {
            const host = req.headers.host || `127.0.0.1:${this.port}`;
            this.sendJson(res, generateOpenApiSpec(host));
            return;
          }

          if (route.path === '/api/v1/docs/endpoints') {
            this.sendJson(res, getEndpointCatalog());
            return;
          }

          // Fallback 404
          this.sendJson(res, { error: `Not found: ${req.method} ${pathname}` }, 404);
        } catch (err: any) {
          logger.error('web-api', `Error handling ${req.method} ${pathname}: ${err.message}`);
          this.sendJson(res, { error: err.message || 'Internal Server Error' }, 500);
        }
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        logger.success('web-api', `Ownbase Web API listening on http://0.0.0.0:${this.port}`);
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

  private isLoopbackRequest(req: http.IncomingMessage): boolean {
    const ip = req.socket.remoteAddress;
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || !ip;
  }

  private getClientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || '127.0.0.1';
  }

  private sendJson(res: http.ServerResponse, data: any, statusCode = 200) {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(json);
  }

  private parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = '';
      let bytes = 0;
      const MAX_JSON_BYTES = 1048576; // 1 MB limit (PRD Item 1.12)

      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_JSON_BYTES) {
          req.destroy();
          reject(new Error('Payload Too Large: JSON request body exceeds 1 MB limit'));
          return;
        }
        data += chunk;
      });

      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });

      req.on('error', (err) => reject(err));
    });
  }

  private readRawBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      req.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      req.on('error', (err) => reject(err));
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

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
      targetFile = path.join(targetFile, 'index.html');
    }

    if (!fs.existsSync(targetFile) && fs.existsSync(`${targetFile}.html`)) {
      targetFile = `${targetFile}.html`;
    }

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
