import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import cookie from 'cookie';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import { eventBus } from '../core/events';
import { safeResolvePath } from '../core/pathGuard';
import { powerManager } from '../core/power';
import { PostgresManager } from '../db/postgres';
import { PrismaManager } from '../db/prisma';
import { ProcessSupervisor } from '../supervisor/supervisor';
import { CaddyManager } from '../network/caddy';
import { TailscaleManager } from '../network/tailscale';
import { FileManager } from '../files/fileManager';
import { BootstrapStep, SystemInfo } from '../../shared/types';
import {
  matchRoute,
  generateOpenApiSpec,
  getEndpointCatalog,
  SetupRequestSchema,
  LoginRequestSchema,
  CreateUserRequestSchema,
  CreateApiKeyRequestSchema,
  CreateRouteRequestSchema,
  CreateAppRequestSchema,
  DeployAppRequestSchema,
  RollbackAppRequestSchema,
  InstallCatalogRequestSchema,
  TlsPreflightRequestSchema,
  CreateTcpProxyRequestSchema,
  CreateServiceMountRequestSchema,
  AuthenticatedUser,
  Role,
} from '../../shared/contract';
import { AuthService } from '../auth/authService';
import { AuditService } from '../auth/audit';
import { SetupService } from '../auth/setup';
import { AuthGuard } from '../auth/guard';
import { loginThrottle } from '../auth/throttle';
import { TableBrowser } from '../db/browser';
import { EventStreamGateway } from './events';
import { deploymentPipeline } from '../deploy/pipeline';
import { releaseManager } from '../deploy/release';
import { catalogManager } from '../deploy/catalog';
import { portAllocator } from '../deploy/ports';
import { hostBuilder } from '../core/hostBuilder';
import { tlsManager } from '../network/tls';
import { tcpProxyManager } from '../network/tcpProxy';
import { volumeManager } from '../storage/volumes';
import { storagePlacementManager } from '../storage/placement';
import { storageUsageManager } from '../storage/usage';
import { uploadEngine } from '../files/upload';
import { streamEngine } from '../files/stream';
import { mediaIndexer } from '../files/media';
import { terminalManager, TerminalManager } from '../terminal/manager';
import { TerminalWsBridge } from '../terminal/ws';
import { BackupManager } from '../backup/manager';
import { HealthService } from '../observability/health';
import { metricsCollector } from '../observability/metrics';
import { AlertManager } from '../observability/alerts';

export function parseCookieHeader(header?: string): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export class WebApiServer {
  private server: http.Server | null = null;
  private port: number = 3001;
  private fileManager: FileManager;
  private authService: AuthService;
  private auditService: AuditService;
  private setupService: SetupService;
  private authGuard: AuthGuard;
  private tableBrowser: TableBrowser;
  private eventStreamGateway: EventStreamGateway;
  private terminalWsBridge: TerminalWsBridge;
  private backupManager: BackupManager;
  private healthService: HealthService;
  private alertManager: AlertManager;

  constructor(
    private postgresManager: PostgresManager,
    private prismaManager: PrismaManager,
    private supervisor: ProcessSupervisor,
    private caddyManager: CaddyManager,
    private tailscaleManager: TailscaleManager,
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
    this.eventStreamGateway = new EventStreamGateway({
      authService: this.authService,
      supervisor: this.supervisor,
      postgres: this.postgresManager,
    });
    this.terminalWsBridge = new TerminalWsBridge(this.authService);
    terminalManager.setAuditService(this.auditService);
    this.backupManager = new BackupManager(this.prismaManager);
    this.healthService = new HealthService(
      this.postgresManager,
      this.prismaManager,
      this.supervisor as any,
      this.caddyManager,
      this.tailscaleManager
    );
    this.alertManager = new AlertManager(this.prismaManager, this.supervisor as any);
  }

  public getBackupManager(): BackupManager {
    return this.backupManager;
  }

  public getHealthService(): HealthService {
    return this.healthService;
  }

  public getAlertManager(): AlertManager {
    return this.alertManager;
  }

  public getTerminalWsBridge(): TerminalWsBridge {
    return this.terminalWsBridge;
  }

  public getTerminalManager(): TerminalManager {
    return terminalManager;
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
          // 1. REAL-TIME EVENT STREAM (SSE) (PRD Item 3.11)
          // ==========================================
          if (pathname === '/api/v1/events') {
            await this.eventStreamGateway.handleEventStream(req, res);
            return;
          }

          if (pathname === '/api/v1/events/snapshot') {
            this.sendJson(res, this.eventStreamGateway.getSnapshot());
            return;
          }

          // ==========================================
          // 2. STATIC ASSETS (Next.js out/ web app)
          // ==========================================
          if (!pathname.startsWith('/api')) {
            const served = await this.serveStaticFile(req, res, pathname);
            if (served) return;

            // SPA fallback if request is GET for a page route without a file extension
            const hasExt = path.extname(pathname).length > 0;
            if (req.method === 'GET' && !hasExt) {
              const spaServed = await this.serveStaticFile(req, res, '/index.html');
              if (spaServed) return;
            }

            this.sendJson(res, { error: `Not found: ${req.method} ${pathname}` }, 404);
            return;
          }

          // ==========================================
          // 3. CONTRACT ROUTE MATCHING (PRD Item 1.1)
          // ==========================================
          const { route, params } = matchRoute(req.method || 'GET', pathname);
          if (!route) {
            this.sendJson(res, { error: `Not found: ${req.method} ${pathname}` }, 404);
            return;
          }

          // ==========================================
          // 4. CENTRALIZED RBAC GUARD (PRD Item 1.6)
          // ==========================================
          const decision = await this.authGuard.evaluate(req, route);
          if (!decision.allowed) {
            this.sendJson(res, { error: decision.error || 'Unauthorized' }, decision.statusCode || 401);
            return;
          }

          const clientIp = this.getClientIp(req);

          // ==========================================
          // 5. ROUTE DISPATCH & HANDLERS
          // ==========================================

          // --- PUBLIC PROBES & SETUP ---
          if (route.path === '/api/v1/health') {
            const pgStatus = this.postgresManager.getStatus();
            const migStatus = this.prismaManager.getStatus();
            const powerState = await powerManager.getPowerState();

            const isHealthy = pgStatus.state === 'running' && migStatus.state !== 'error';

            this.sendJson(res, {
              status: isHealthy ? 'healthy' : 'degraded',
              uptime: process.uptime(),
              timestamp: new Date().toISOString(),
              subsystems: {
                paths: { status: 'ok', mode: paths.mode, dataDir: paths.dataDir },
                postgres: {
                  status: pgStatus.state === 'running' ? 'ok' : 'degraded',
                  state: pgStatus.state,
                  port: pgStatus.port,
                },
                migrations: {
                  status: migStatus.state === 'error' ? 'degraded' : 'ok',
                  state: migStatus.state,
                  error: migStatus.error,
                },
                supervisor: { status: 'ok', activeProcesses: Object.keys(this.supervisor.getAllStatuses()).length },
                power: {
                  status: 'ok',
                  scheme: powerState.schemeName,
                  persistent: powerState.preventSuspensionActive,
                },
              },
            });
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
              const { token: refreshToken } = await this.authService.generateRefreshToken(user.id);

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
              const cookies = parseCookieHeader(req.headers.cookie);
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

            if (decision.user) {
              await this.authService.revokeAllUserTokens(decision.user.id);
            }

            res.setHeader('Set-Cookie', 'ownbase_refresh=; Path=/api/v1/auth; HttpOnly; Max-Age=0');
            this.sendJson(res, { success: true });
            return;
          }

          if (route.path === '/api/v1/auth/me') {
            this.sendJson(res, {
              user: decision.user,
              id: decision.user?.id,
              username: decision.user?.username,
              role: decision.user?.role,
            });
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
              electronVersion: 'none (headless daemon)',
              appDataDir: paths.dataDir,
              appVersion: '0.1.0',
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

          if (route.path === '/api/v1/services/:id' && req.method === 'DELETE') {
            try {
              await this.supervisor.stopService(params.id).catch(() => {});
              await this.prismaManager.deleteService(params.id);
              await this.auditService.record({
                actorId: decision.user?.id,
                actorName: decision.user?.username,
                action: 'service.delete',
                entity: 'service',
                entityId: params.id,
                ipAddress: clientIp,
                status: 'success',
              });
              this.sendJson(res, { success: true, id: params.id });
            } catch (err: any) {
              this.sendJson(res, { error: `Failed to delete service: ${err.message}` }, 400);
            }
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
            if (!parsed.data.serviceId) {
              const client = this.prismaManager.getClient();
              const firstSvc = client && (client as any).service ? await (client as any).service.findFirst() : null;
              if (firstSvc) serviceId = firstSvc.id;
            }
            const r = await this.prismaManager.createRoute({
              serviceId,
              subdomain: parsed.data.subdomain,
              targetPort: parsed.data.targetPort,
              tlsEnabled: parsed.data.tlsEnabled,
              customDomain: parsed.data.customDomain,
            });
            await this.caddyManager.syncAllRoutes();
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'route.create',
              entity: 'route',
              entityId: r.id,
              ipAddress: clientIp,
              status: 'success',
              details: { subdomain: r.subdomain, port: r.targetPort },
            });
            this.sendJson(res, r, 201);
            return;
          }

          if (route.path === '/api/v1/routes/:id' && req.method === 'DELETE') {
            try {
              await this.prismaManager.deleteRoute(params.id);
              await this.caddyManager.syncAllRoutes();
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
            this.sendJson(res, await this.caddyManager.testRoute(body.host));
            return;
          }

          // --- TAILSCALE MESH ---
          if (route.path === '/api/v1/tailscale/status') {
            this.sendJson(res, await this.tailscaleManager.getStatus());
            return;
          }

          if (route.path === '/api/v1/tailscale/connect') {
            const body = await this.parseJsonBody(req);
            const tsRes = await this.tailscaleManager.connect(body.authKey, body.hostname);
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

          // --- POWER & LIFECYCLE ---
          if (route.path === '/api/v1/lifecycle/status') {
            const powerState = await powerManager.getPowerState();
            this.sendJson(res, {
              trayActive: false,
              isMinimizedToTray: false,
              isQuitting: false,
              powerBlocker: {
                active: powerState.preventSuspensionActive,
                blockerId: null,
                type: 'prevent-app-suspension',
              },
              autoStart: {
                enabled: false,
                openAsHidden: false,
              },
              preventAppSuspension: powerState.preventSuspensionActive,
              openAtLogin: false,
              activePowerScheme: powerState.schemeName,
            });
            return;
          }

          if (route.path === '/api/v1/lifecycle/autostart') {
            const body = await this.parseJsonBody(req);
            this.sendJson(res, {
              success: true,
              autoStart: {
                enabled: !!body.enabled,
                openAsHidden: !!body.openAsHidden,
              },
            });
            return;
          }

          if (route.path === '/api/v1/lifecycle/power-blocker') {
            const body = await this.parseJsonBody(req);
            if (body.enabled) {
              powerManager.enablePowerPersistence();
            } else {
              powerManager.disablePowerPersistence();
            }
            const powerState = await powerManager.getPowerState();
            this.sendJson(res, {
              success: true,
              preventSuspensionActive: powerState.preventSuspensionActive,
              powerBlocker: {
                active: powerState.preventSuspensionActive,
                blockerId: null,
                type: 'prevent-app-suspension',
              },
            });
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
              entityId: keyData.keyRecord.id,
              ipAddress: clientIp,
              status: 'success',
              details: { name: keyData.keyRecord.name, prefix: keyData.keyRecord.prefix, role: keyData.keyRecord.role },
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

          // --- PHASE 4: APPS & DEPLOYMENTS ---
          if (route.path === '/api/v1/apps' && req.method === 'GET') {
            const client = this.prismaManager.getClient();
            const apps = await (client as any).app.findMany({
              include: {
                activeRelease: true,
                deployments: {
                  take: 1,
                  orderBy: { startedAt: 'desc' },
                },
              },
              orderBy: { createdAt: 'desc' },
            });
            this.sendJson(res, apps);
            return;
          }

          if (route.path === '/api/v1/apps' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = CreateAppRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid app payload', details: parsed.error.issues }, 400);
              return;
            }
            const client = this.prismaManager.getClient();
            const existing = await (client as any).app.findUnique({ where: { slug: parsed.data.slug } });
            if (existing) {
              this.sendJson(res, { error: `App with slug '${parsed.data.slug}' already exists` }, 409);
              return;
            }

            let targetPort = parsed.data.port;
            if (!targetPort) {
              targetPort = await portAllocator.allocatePort();
            }

            const created = await (client as any).app.create({
              data: {
                name: parsed.data.name,
                slug: parsed.data.slug,
                sourceType: parsed.data.sourceType,
                repoUrl: parsed.data.repoUrl,
                branch: parsed.data.branch,
                runtime: parsed.data.runtime,
                buildCommand: parsed.data.buildCommand,
                startCommand: parsed.data.startCommand,
                port: targetPort,
                healthPath: parsed.data.healthPath,
                status: 'idle',
              },
            });

            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'app.create',
              entity: 'app',
              entityId: created.id,
              ipAddress: clientIp,
              status: 'success',
              details: { name: created.name, slug: created.slug, port: created.port },
            });

            this.sendJson(res, created, 201);
            return;
          }

          if (route.path === '/api/v1/apps/:id' && req.method === 'GET') {
            const client = this.prismaManager.getClient();
            const app = await (client as any).app.findUnique({
              where: { id: params.id },
              include: {
                activeRelease: true,
                releases: { orderBy: { releaseNumber: 'desc' }, take: 10 },
                deployments: { orderBy: { startedAt: 'desc' }, take: 10 },
              },
            });
            if (!app) {
              this.sendJson(res, { error: `App '${params.id}' not found` }, 404);
              return;
            }
            this.sendJson(res, app);
            return;
          }

          if (route.path === '/api/v1/apps/:id' && req.method === 'DELETE') {
            const client = this.prismaManager.getClient();
            const app = await (client as any).app.findUnique({ where: { id: params.id } });
            if (!app) {
              this.sendJson(res, { error: `App '${params.id}' not found` }, 404);
              return;
            }

            if (app.activeReleaseId) {
              await releaseManager.stopReleaseProcess(app.activeReleaseId);
            }
            if (app.port) {
              portAllocator.releasePort(app.port);
            }

            await (client as any).route.deleteMany({ where: { subdomain: app.slug } });
            await this.caddyManager.syncAllRoutes();

            const appDir = path.join(paths.appsDir, app.id);
            if (fs.existsSync(appDir)) {
              try {
                fs.rmSync(appDir, { recursive: true, force: true });
              } catch {}
            }

            await (client as any).app.delete({ where: { id: params.id } });

            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'app.delete',
              entity: 'app',
              entityId: params.id,
              ipAddress: clientIp,
              status: 'success',
              details: { name: app.name, slug: app.slug },
            });

            this.sendJson(res, { success: true });
            return;
          }

          if (route.path === '/api/v1/apps/:id/deploy' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = DeployAppRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid deploy payload', details: parsed.error.issues }, 400);
              return;
            }

            try {
              const depRecord = await deploymentPipeline.triggerDeploy({
                appId: params.id,
                triggeredBy: decision.user?.username || 'user',
                sourceType: parsed.data.sourceType,
                archivePath: parsed.data.archivePath,
              });

              await this.auditService.record({
                actorId: decision.user?.id,
                actorName: decision.user?.username,
                action: 'app.deploy',
                entity: 'deployment',
                entityId: depRecord.id,
                ipAddress: clientIp,
                status: 'success',
                details: { appId: params.id, sourceType: parsed.data.sourceType },
              });

              this.sendJson(res, depRecord, 202);
            } catch (deployErr: any) {
              this.sendJson(res, { error: deployErr.message }, 400);
            }
            return;
          }

          if (route.path === '/api/v1/apps/:id/deployments' && req.method === 'GET') {
            const client = this.prismaManager.getClient();
            const deployments = await (client as any).deployment.findMany({
              where: { appId: params.id },
              orderBy: { startedAt: 'desc' },
              take: 50,
            });
            this.sendJson(res, deployments);
            return;
          }

          if (route.path === '/api/v1/apps/:id/releases' && req.method === 'GET') {
            const client = this.prismaManager.getClient();
            const releases = await (client as any).release.findMany({
              where: { appId: params.id },
              orderBy: { releaseNumber: 'desc' },
            });
            this.sendJson(res, releases);
            return;
          }

          if (route.path === '/api/v1/apps/:id/rollback' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = RollbackAppRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid rollback payload', details: parsed.error.issues }, 400);
              return;
            }

            try {
              const rolledBack = await releaseManager.rollback(params.id, parsed.data.releaseId);
              await this.auditService.record({
                actorId: decision.user?.id,
                actorName: decision.user?.username,
                action: 'app.rollback',
                entity: 'app',
                entityId: params.id,
                ipAddress: clientIp,
                status: 'success',
                details: { releaseId: parsed.data.releaseId, newPort: rolledBack.port },
              });
              this.sendJson(res, rolledBack);
            } catch (rollbackErr: any) {
              this.sendJson(res, { error: rollbackErr.message }, 400);
            }
            return;
          }

          // --- PHASE 4: APP CATALOG & RECIPES ---
          if (route.path === '/api/v1/catalog' && req.method === 'GET') {
            this.sendJson(res, catalogManager.getRecipes());
            return;
          }

          if (route.path === '/api/v1/catalog/install' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = InstallCatalogRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid catalog install payload', details: parsed.error.issues }, 400);
              return;
            }

            const recipe = catalogManager.getRecipe(parsed.data.recipeId);
            if (!recipe) {
              this.sendJson(res, { error: `Catalog recipe '${parsed.data.recipeId}' not found` }, 404);
              return;
            }

            const appName = parsed.data.name || recipe.name;
            const subdomain = parsed.data.subdomain || recipe.defaultSubdomain;
            const targetPort = parsed.data.port || (await portAllocator.allocatePort(recipe.defaultPort));
            const client = this.prismaManager.getClient();

            const app = await (client as any).app.create({
              data: {
                name: appName,
                slug: subdomain,
                sourceType: 'catalog',
                runtime: recipe.runtime === 'native' ? 'custom' : recipe.runtime,
                buildCommand: recipe.spec.buildCommand,
                startCommand:
                  recipe.spec.startCommand ||
                  (recipe.spec.command ? `${recipe.spec.command} ${recipe.spec.args.join(' ')}` : undefined),
                port: targetPort,
                healthPath: recipe.spec.healthPath,
                status: 'idle',
              },
            });

            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'catalog.install',
              entity: 'app',
              entityId: app.id,
              ipAddress: clientIp,
              status: 'success',
              details: { recipeId: recipe.id, name: app.name, port: targetPort },
            });

            this.sendJson(res, { success: true, app }, 201);
            return;
          }

          // --- PHASE 5: INGRESS, TLS & DIRECT TCP EXPOSURE ---
          if (route.path === '/api/v1/network/urls' && req.method === 'GET') {
            const routes = await this.prismaManager.getRoutes();
            const derivedList: any[] = [];
            for (const r of routes) {
              const intent = {
                subdomain: r.subdomain,
                targetPort: r.targetPort,
                targetHost: r.targetHost,
                customDomains: r.customDomain ? [r.customDomain] : [],
                exposeLocal: (r as any).exposeLocal ?? true,
                exposeLan: (r as any).exposeLan ?? true,
                exposeMesh: (r as any).exposeMesh ?? false,
                tlsEnabled: r.tlsEnabled ?? true,
                requiresAuth: true,
              };
              const built = hostBuilder.build(intent);
              derivedList.push({
                serviceId: r.serviceId,
                subdomain: r.subdomain,
                targetPort: r.targetPort,
                matchers: built.caddyMatchers,
                urls: built.urls,
              });
            }
            this.sendJson(res, derivedList);
            return;
          }

          if (route.path === '/api/v1/network/tls/preflight' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = TlsPreflightRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid domain payload', details: parsed.error.issues }, 400);
              return;
            }
            const preflight = await tlsManager.checkPreflight(parsed.data.domain);
            this.sendJson(res, preflight);
            return;
          }

          if (route.path === '/api/v1/network/tcp' && req.method === 'GET') {
            this.sendJson(res, tcpProxyManager.getActiveListeners());
            return;
          }

          if (route.path === '/api/v1/network/tcp' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = CreateTcpProxyRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid TCP proxy payload', details: parsed.error.issues }, 400);
              return;
            }
            try {
              const listener = await tcpProxyManager.startProxy({
                listenPort: parsed.data.listenPort,
                targetPort: parsed.data.targetPort,
                targetHost: parsed.data.targetHost,
                scope: parsed.data.scope,
              });

              await this.auditService.record({
                actorId: decision.user?.id,
                actorName: decision.user?.username,
                action: 'tcp_proxy.start',
                entity: 'tcp_proxy',
                entityId: String(parsed.data.listenPort),
                ipAddress: clientIp,
                status: 'success',
                details: { listenPort: parsed.data.listenPort, targetPort: parsed.data.targetPort },
              });

              this.sendJson(
                res,
                {
                  success: true,
                  listenPort: listener.listenPort,
                  targetPort: listener.targetPort,
                  ruleName: listener.ruleName,
                },
                201
              );
            } catch (tcpErr: any) {
              this.sendJson(res, { error: tcpErr.message }, 400);
            }
            return;
          }

          if (route.path === '/api/v1/network/tcp/:port' && req.method === 'DELETE') {
            const portNum = parseInt(params.port, 10);
            if (isNaN(portNum)) {
              this.sendJson(res, { error: 'Invalid port parameter' }, 400);
              return;
            }
            const stopped = await tcpProxyManager.stopProxy(portNum);
            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'tcp_proxy.stop',
              entity: 'tcp_proxy',
              entityId: String(portNum),
              ipAddress: clientIp,
              status: stopped ? 'success' : 'failure',
            });
            this.sendJson(res, { success: stopped });
            return;
          }

          // --- PHASE 5: STORAGE VOLUMES & MOUNTS ---
          if (route.path === '/api/v1/storage/volumes' && req.method === 'GET') {
            const volumes = await volumeManager.discoverVolumes(false);
            const serialized = volumes.map((v) => ({
              ...v,
              totalBytes: v.totalBytes.toString(),
              freeBytes: v.freeBytes.toString(),
            }));
            this.sendJson(res, serialized);
            return;
          }

          if (route.path === '/api/v1/storage/volumes/refresh' && req.method === 'POST') {
            const volumes = await volumeManager.discoverVolumes(true);
            const serialized = volumes.map((v) => ({
              ...v,
              totalBytes: v.totalBytes.toString(),
              freeBytes: v.freeBytes.toString(),
            }));
            this.sendJson(res, serialized);
            return;
          }

          if (route.path === '/api/v1/storage/mounts' && req.method === 'GET') {
            const mounts = await storagePlacementManager.listMounts();
            const serialized = mounts.map((m: any) => ({
              ...m,
              quotaBytes: m.quotaBytes?.toString(),
              usedBytes: m.usedBytes?.toString(),
            }));
            this.sendJson(res, serialized);
            return;
          }

          if (route.path === '/api/v1/storage/mounts' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const parsed = CreateServiceMountRequestSchema.safeParse(body);
            if (!parsed.success) {
              this.sendJson(res, { error: 'Invalid storage mount payload', details: parsed.error.issues }, 400);
              return;
            }
            const client = this.prismaManager.getClient();
            const vol = await (client as any).storageVolume.findUnique({ where: { id: parsed.data.volumeId } });
            if (!vol) {
              this.sendJson(res, { error: `Storage volume '${parsed.data.volumeId}' not found` }, 404);
              return;
            }

            try {
              const mount = await storagePlacementManager.createMount({
                serviceId: parsed.data.serviceId,
                volumeId: vol.id,
                driveLetter: vol.driveLetter,
                tier: parsed.data.tier as any,
                sourceSubpath: parsed.data.sourceSubpath,
                mountName: parsed.data.mountName,
                quotaBytes: parsed.data.quotaBytes ? BigInt(parsed.data.quotaBytes) : undefined,
              });

              await this.auditService.record({
                actorId: decision.user?.id,
                actorName: decision.user?.username,
                action: 'storage_mount.create',
                entity: 'service_mount',
                entityId: mount.id,
                ipAddress: clientIp,
                status: 'success',
                details: { tier: mount.tier, mountPath: mount.mountPath },
              });

              this.sendJson(
                res,
                {
                  ...mount,
                  quotaBytes: mount.quotaBytes?.toString(),
                  usedBytes: mount.usedBytes.toString(),
                },
                201
              );
            } catch (mountErr: any) {
              this.sendJson(res, { error: mountErr.message }, 400);
            }
            return;
          }

          if (route.path === '/api/v1/storage/usage' && req.method === 'GET') {
            const usage = await storageUsageManager.getUsageBreakdown();
            this.sendJson(res, usage);
            return;
          }

          // --- PHASE 5: FILE STREAMING & UPLOADS ---
          if (route.path === '/api/v1/files/upload' && req.method === 'POST') {
            const filenameHeader = (req.headers['x-filename'] as string) || `upload_${Date.now()}`;
            const targetDir =
              (req.headers['x-target-dir'] as string) || path.join(paths.dataDir, 'files');

            try {
              const uploadRes = await uploadEngine.handleUpload(req, {
                targetDirectory: targetDir,
                filename: filenameHeader,
              });
              this.sendJson(res, uploadRes, 201);
            } catch (uploadErr: any) {
              this.sendJson(res, { error: uploadErr.message }, 400);
            }
            return;
          }

          if (route.path === '/api/v1/files/stream' && req.method === 'GET') {
            const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const filePathParam = parsedUrl.searchParams.get('path');
            if (!filePathParam) {
              this.sendJson(res, { error: 'Missing path query parameter' }, 400);
              return;
            }

            try {
              const canonical = safeResolvePath(paths.dataDir, filePathParam);
              await streamEngine.streamFile(req, res, canonical);
            } catch (streamErr: any) {
              this.sendJson(res, { error: streamErr.message }, 403);
            }
            return;
          }

          // --- PHASE 5: MEDIA SERVICE & TIMELINE ---
          if (route.path === '/api/v1/media/timeline' && req.method === 'GET') {
            const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
            const pageSize = parseInt(parsedUrl.searchParams.get('pageSize') || '50', 10);
            const library = parsedUrl.searchParams.get('library') || undefined;

            const timeline = await mediaIndexer.getTimeline({ page, pageSize, library });
            this.sendJson(res, timeline);
            return;
          }

          if (route.path === '/api/v1/media/scan' && req.method === 'POST') {
            const body = await this.parseJsonBody(req).catch(() => ({}));
            const library = body?.library || 'photos';
            const scanRes = await mediaIndexer.scanLibrary(library);

            await this.auditService.record({
              actorId: decision.user?.id,
              actorName: decision.user?.username,
              action: 'media.scan',
              entity: 'media_library',
              entityId: library,
              ipAddress: clientIp,
              status: 'success',
              details: scanRes,
            });

            this.sendJson(res, scanRes);
            return;
          }

          if (route.path === '/api/v1/media/thumbnail/:id' && req.method === 'GET') {
            const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const size = parseInt(parsedUrl.searchParams.get('size') || '400', 10);
            const thumbPath = await mediaIndexer.getThumbnailPath(params.id, size);

            if (!thumbPath || !fs.existsSync(thumbPath)) {
              this.sendJson(res, { error: 'Thumbnail not available' }, 404);
              return;
            }

            await streamEngine.streamFile(req, res, thumbPath);
            return;
          }

          // --- PHASE 6: FORWARD-AUTH & WEB TERMINAL ---
          if (route.path === '/api/v1/auth/verify' && req.method === 'GET') {
            const authHeader = req.headers.authorization;
            const apiKeyHeader = req.headers['x-api-key'];
            const forwardedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
            const clientIp = this.getClientIp(req);

            let user: AuthenticatedUser | null = null;
            if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
              user = await this.authService.verifyAccessToken(authHeader.slice(7).trim());
            } else if (typeof apiKeyHeader === 'string') {
              user = await this.authService.verifyApiKey(apiKeyHeader);
            } else if (req.headers.cookie) {
              try {
                const parsedCookies = parseCookieHeader(req.headers.cookie);
                const token = parsedCookies.ownbase_access_token || parsedCookies.ownbase_session;
                if (token) {
                  user = await this.authService.verifyAccessToken(token);
                }
              } catch {}
            }

            // Determine if target host is a LAN host requiring authentication (PRD Criterion A3)
            const isLanHost =
              forwardedHost.includes('.nip.io') ||
              (!forwardedHost.startsWith('localhost') &&
                !forwardedHost.startsWith('127.0.0.1') &&
                !forwardedHost.includes('.localhost'));

            if (!user && isLanHost) {
              res.setHeader('WWW-Authenticate', 'Bearer realm="Ownbase LAN"');
              this.sendJson(
                res,
                { error: 'Authentication required to access service on LAN', verified: false, requiresAuth: true },
                401
              );
              return;
            }

            if (user) {
              res.setHeader('X-Forwarded-User', user.username);
              res.setHeader('X-Forwarded-Role', user.role);
              this.sendJson(res, { verified: true, user });
            } else {
              this.sendJson(res, { verified: true, access: 'loopback' });
            }
            return;
          }

          if (route.path === '/api/v1/terminal/sessions' && req.method === 'GET') {
            this.sendJson(res, terminalManager.getActiveSessions());
            return;
          }

          if (route.path === '/api/v1/terminal/sessions/:sessionId' && req.method === 'DELETE') {
            const sessionId = params.sessionId;
            const closed = terminalManager.closeSession(sessionId, 'admin_terminated');
            if (!closed) {
              this.sendJson(res, { error: `Terminal session '${sessionId}' not found` }, 404);
              return;
            }
            this.sendJson(res, { success: true, sessionId });
            return;
          }

          // --- PHASE 7: BACKUPS & DISASTER RECOVERY (PRD §7.4 & A2) ---
          if (route.path === '/api/v1/backups' && req.method === 'GET') {
            const backups = await this.backupManager.listBackups();
            this.sendJson(res, backups);
            return;
          }

          if (route.path === '/api/v1/backups' && req.method === 'POST') {
            const user = decision.user;
            const body = await this.parseJsonBody(req);
            const backup = await this.backupManager.createBackup({
              name: body?.name,
              trigger: 'manual',
              targetVolumePath: body?.targetVolumePath,
            });
            await this.auditService.record({
              action: 'backup.create',
              status: 'success',
              actorId: user?.id,
              actorName: user?.username,
              ipAddress: clientIp,
              details: { backupId: backup.id, size: backup.fileSizeBytes },
            });
            this.sendJson(res, backup, 201);
            return;
          }

          if (route.path === '/api/v1/backups/:id/restore' && req.method === 'POST') {
            const user = decision.user;
            const result = await this.backupManager.restoreBackup(params.id);
            await this.auditService.record({
              action: 'backup.restore',
              status: 'success',
              actorId: user?.id,
              actorName: user?.username,
              ipAddress: clientIp,
              details: { backupId: params.id, recordsRestored: result.recordsRestored },
            });
            this.sendJson(res, result);
            return;
          }

          if (route.path === '/api/v1/backups/:id' && req.method === 'DELETE') {
            const user = decision.user;
            const deleted = await this.backupManager.deleteBackup(params.id);
            await this.auditService.record({
              action: 'backup.delete',
              status: 'success',
              actorId: user?.id,
              actorName: user?.username,
              ipAddress: clientIp,
              details: { backupId: params.id },
            });
            this.sendJson(res, { success: deleted, id: params.id });
            return;
          }

          // --- PHASE 7: OBSERVABILITY & SYSTEM HEALTH (PRD §7.5) ---
          if (route.path === '/api/v1/system/health' && req.method === 'GET') {
            const report = await this.healthService.getDeepHealth();
            const status = report.overall === 'unhealthy' ? 503 : 200;
            this.sendJson(res, report, status);
            return;
          }

          if (route.path === '/api/v1/system/metrics' && req.method === 'GET') {
            this.sendJson(res, {
              latest: metricsCollector.getLatest(),
              history: metricsCollector.getHistory(),
            });
            return;
          }

          // --- PHASE 7: ALERTS & RULES (PRD §7.5) ---
          if (route.path === '/api/v1/alerts' && req.method === 'GET') {
            const alerts = await this.alertManager.getAlerts();
            this.sendJson(res, alerts);
            return;
          }

          if (route.path === '/api/v1/alerts/rules' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const rule = await this.alertManager.createOrUpdateRule(body || {});
            this.sendJson(res, rule, 201);
            return;
          }

          if (route.path === '/api/v1/alerts/:id/resolve' && req.method === 'POST') {
            const success = await this.alertManager.resolveAlert(params.id);
            this.sendJson(res, { success, id: params.id });
            return;
          }

          if (route.path === '/api/v1/alerts/test-webhook' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const webhookUrl = body?.webhookUrl;
            if (!webhookUrl) {
              this.sendJson(res, { error: 'webhookUrl is required', code: 'INVALID_PARAM', message: 'webhookUrl is required' }, 400);
              return;
            }
            const testAlert = {
              id: 'test-alert-' + Date.now(),
              title: 'Test Webhook Notification',
              message: 'This is a test notification from Ownbase Observability System.',
              severity: 'info',
              createdAt: new Date().toISOString(),
            };
            const dispatched = await this.alertManager.dispatchWebhook(webhookUrl, testAlert);
            this.sendJson(res, { success: dispatched, webhookUrl });
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
          this.sendJson(res, { error: `Not found: ${req.method} ${pathname}`, code: 'NOT_FOUND', message: `Not found: ${req.method} ${pathname}` }, 404);
        } catch (err: any) {
          logger.error('web-api', `Error handling ${req.method} ${pathname}: ${err.message}`);
          const isProd = process.env.NODE_ENV === 'production' || process.env.OWNBASE_MODE === 'service';
          const safeMessage = isProd && err.statusCode !== 400 && err.statusCode !== 401 && err.statusCode !== 403 && err.statusCode !== 404
            ? 'An internal error occurred'
            : (err.message || 'Internal Server Error');
          this.sendJson(res, {
            error: safeMessage,
            code: err.code || 'INTERNAL_ERROR',
            message: safeMessage,
          }, err.statusCode || 500);
        }
      });

      // WebSocket HTTP Upgrade handler for Audited ConPTY Web Terminal (PRD §6.5 & A4)
      this.server.on('upgrade', (req, socket, head) => {
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        if (parsedUrl.pathname === '/api/v1/terminal/ws' || parsedUrl.pathname === '/ws/terminal') {
          this.terminalWsBridge.handleUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      });

      // Decision D3: Daemon binds strictly to loopback 127.0.0.1!
      this.server.listen(this.port, '127.0.0.1', () => {
        logger.success('web-api', `Ownbase Daemon Web API listening on http://127.0.0.1:${this.port} (loopback only)`);
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
      path.join(__dirname, '..', '..', '..', 'out'),
      path.join(__dirname, '..', '..', 'out'),
    ];

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

    let targetFile: string;
    try {
      targetFile = safeResolvePath(outDir, relPath);
    } catch {
      this.sendJson(res, { error: 'Forbidden: Path traversal blocked' }, 403);
      return true; // Handled as 403
    }

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
      targetFile = path.join(targetFile, 'index.html');
    }

    if (!fs.existsSync(targetFile) && fs.existsSync(`${targetFile}.html`)) {
      targetFile = `${targetFile}.html`;
    }

    if (fs.existsSync(targetFile) && !fs.statSync(targetFile).isDirectory()) {
      const ext = path.extname(targetFile).toLowerCase();
      const mime = this.getMimeType(ext);
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

  private getMimeType(ext: string): string {
    const map: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webp': 'image/webp',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
    };
    return map[ext] || 'application/octet-stream';
  }
}
