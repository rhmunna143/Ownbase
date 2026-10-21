import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { AuthService } from '../../src/daemon/auth/authService';
import { CaddyManager } from '../../src/daemon/network/caddy';

describe('Phase 7 - Item 7.1: Full End-to-End Product Regression Flow (PRD §7.1)', () => {
  let server: WebApiServer;
  let authService: AuthService;
  let testPort = 3109;
  let rootToken: string;

  beforeAll(async () => {
    const mockPrismaManager: any = {
      getClient: () => ({
        user: { findUnique: async () => null },
        service: {
          findMany: async () => [
            { id: 'svc-fb', name: 'FileBrowser', templateId: 'filebrowser', port: 8080 },
          ],
        },
        route: {
          findMany: async () => [
            { id: 'rt-fb', subdomain: 'files', targetPort: 8080, exposeLocal: true, exposeLan: true },
          ],
        },
        backupJob: {
          create: async ({ data }: any) => ({ ...data, createdAt: new Date() }),
          update: async ({ data }: any) => ({ ...data }),
          findMany: async () => [],
        },
      }),
      getStatus: () => ({ state: 'running' }),
      getRoutes: async () => [],
      getServices: async () => [{ id: 'svc-fb', name: 'FileBrowser', templateId: 'filebrowser', port: 8080 }],
    };

    const mockPostgresManager: any = {
      getStatus: () => ({ state: 'running', port: 5432 }),
    };

    const mockSupervisor: any = {
      getAllStatuses: () => ({
        filebrowser: { state: 'running' },
      }),
      registerService: () => {},
    };

    const mockTailscaleManager: any = {
      getStatus: async () => ({ connected: false }),
    };

    const caddyManager = new CaddyManager(mockPrismaManager);
    server = new WebApiServer(
      mockPostgresManager,
      mockPrismaManager,
      mockSupervisor,
      caddyManager,
      mockTailscaleManager,
      () => [],
      testPort
    );

    await server.start();
    authService = server.getAuthService();
    rootToken = await authService.generateAccessToken({
      id: 'root-e2e-id',
      username: 'rootadmin',
      role: 'ROOT',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  const sendRequest = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ statusCode: number; data: any }> => {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path,
          method,
          headers: {
            ...headers,
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let data = raw;
            try {
              data = JSON.parse(raw);
            } catch {}
            resolve({ statusCode: res.statusCode || 500, data });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };

  it('executes full management lifecycle: auth -> health -> services -> backup -> alerts', async () => {
    // 1. Verify Authentication & Profile
    const meRes = await sendRequest('GET', '/api/v1/auth/me', {
      Authorization: `Bearer ${rootToken}`,
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.data.username).toBe('rootadmin');
    expect(meRes.data.role).toBe('ROOT');

    // 2. Query System Health
    const healthRes = await sendRequest('GET', '/api/v1/system/health');
    expect([200, 503]).toContain(healthRes.statusCode);
    expect(healthRes.data.components).toBeDefined();

    // 3. Inspect Live Metrics
    const metricsRes = await sendRequest('GET', '/api/v1/system/metrics', {
      Authorization: `Bearer ${rootToken}`,
    });
    expect(metricsRes.statusCode).toBe(200);
    expect(metricsRes.data.history).toBeDefined();

    // 4. Query Services
    const srvRes = await sendRequest('GET', '/api/v1/services', {
      Authorization: `Bearer ${rootToken}`,
    });
    expect(srvRes.statusCode).toBe(200);

    // 5. Query Routes
    const routeRes = await sendRequest('GET', '/api/v1/routes', {
      Authorization: `Bearer ${rootToken}`,
    });
    expect(routeRes.statusCode).toBe(200);

    // 6. Trigger Encrypted Database Backup
    const backupRes = await sendRequest('POST', '/api/v1/backups', {
      Authorization: `Bearer ${rootToken}`,
    }, {
      name: 'e2e-workflow-snapshot',
    });
    expect(backupRes.statusCode).toBe(201);
    expect(backupRes.data.name).toBe('e2e-workflow-snapshot');
    expect(backupRes.data.checksumSha256).toBeDefined();

    // 7. Query Alert Rules & Active Alerts
    const alertsRes = await sendRequest('GET', '/api/v1/alerts', {
      Authorization: `Bearer ${rootToken}`,
    });
    expect(alertsRes.statusCode).toBe(200);
    expect(Array.isArray(alertsRes.data.rules)).toBe(true);
  });
});
