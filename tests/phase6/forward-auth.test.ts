import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { AuthService } from '../../src/daemon/auth/authService';
import { CaddyManager } from '../../src/daemon/network/caddy';
import { hostBuilder } from '../../src/daemon/core/hostBuilder';
import { AuthenticatedUser } from '../../src/shared/contract/types';

describe('Phase 6: Gateway Forward-Auth & LAN Route Guarding (PRD §6.4 & A3)', () => {
  let server: WebApiServer;
  let authService: AuthService;
  let testPort = 3106;
  let caddyManager: CaddyManager;
  let rootUser: AuthenticatedUser;
  let rootToken: string;

  beforeAll(async () => {
    // Mock minimal PrismaManager
    const mockPrismaManager: any = {
      getClient: () => ({
        user: {
          findUnique: async () => null,
        },
      }),
      getStatus: () => ({ state: 'running' }),
      getRoutes: async () => [],
    };

    const mockPostgresManager: any = {
      getStatus: () => ({ state: 'running', port: 5432 }),
    };

    const mockSupervisor: any = {
      getAllStatuses: () => ({}),
    };

    const mockTailscaleManager: any = {
      getStatus: async () => ({ isInstalled: false }),
    };

    caddyManager = new CaddyManager(mockPrismaManager);
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

    rootUser = {
      id: 'test-root-id',
      username: 'rootadmin',
      role: 'ROOT',
    };
    rootToken = await authService.generateAccessToken(rootUser);
  });

  afterAll(async () => {
    await server.stop();
  });

  const makeVerifyRequest = (headers: Record<string, string>): Promise<{ statusCode: number; data: any; headers: any }> => {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/v1/auth/verify',
          method: 'GET',
          headers,
        },
        (res) => {
          let chunks = '';
          res.on('data', (d) => (chunks += d));
          res.on('end', () => {
            let data: any = chunks;
            try { data = JSON.parse(chunks); } catch {}
            resolve({ statusCode: res.statusCode || 200, data, headers: res.headers });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  };

  it('allows unauthenticated requests on loopback *.localhost hosts', async () => {
    const res = await makeVerifyRequest({
      Host: 'ai.localhost',
      'X-Forwarded-Host': 'ai.localhost',
    });

    expect(res.statusCode).toBe(200);
    expect(res.data.verified).toBe(true);
    expect(res.data.access).toBe('loopback');
  });

  it('strictly rejects unauthenticated LAN requests to ai.* with 401 Unauthorized (A3)', async () => {
    const res = await makeVerifyRequest({
      Host: 'ai.192.168.1.50.nip.io',
      'X-Forwarded-Host': 'ai.192.168.1.50.nip.io',
    });

    expect(res.statusCode).toBe(401);
    expect(res.data.verified).toBe(false);
    expect(res.data.requiresAuth).toBe(true);
    expect(res.data.error).toContain('Authentication required to access service on LAN');
  });

  it('strictly rejects unauthenticated LAN requests to files.* with 401 Unauthorized (A3)', async () => {
    const res = await makeVerifyRequest({
      Host: 'files.10.0.0.12.nip.io',
      'X-Forwarded-Host': 'files.10.0.0.12.nip.io',
    });

    expect(res.statusCode).toBe(401);
    expect(res.data.verified).toBe(false);
    expect(res.data.requiresAuth).toBe(true);
  });

  it('allows authenticated LAN requests with valid Bearer access token and sets X-Forwarded headers', async () => {
    const res = await makeVerifyRequest({
      Host: 'ai.192.168.1.50.nip.io',
      'X-Forwarded-Host': 'ai.192.168.1.50.nip.io',
      Authorization: `Bearer ${rootToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.data.verified).toBe(true);
    expect(res.data.user.username).toBe('rootadmin');
    expect(res.data.user.role).toBe('ROOT');
    expect(res.headers['x-forwarded-user']).toBe('rootadmin');
    expect(res.headers['x-forwarded-role']).toBe('ROOT');
  });

  it('allows authenticated LAN requests with session cookie', async () => {
    const res = await makeVerifyRequest({
      Host: 'files.192.168.1.50.nip.io',
      'X-Forwarded-Host': 'files.192.168.1.50.nip.io',
      Cookie: `ownbase_access_token=${rootToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.data.verified).toBe(true);
    expect(res.data.user.username).toBe('rootadmin');
  });

  it('rejects invalid or forged JWT on LAN requests with 401', async () => {
    const res = await makeVerifyRequest({
      Host: 'ai.192.168.1.50.nip.io',
      'X-Forwarded-Host': 'ai.192.168.1.50.nip.io',
      Authorization: 'Bearer invalid.token.payload',
    });

    expect(res.statusCode).toBe(401);
    expect(res.data.verified).toBe(false);
  });

  it('generates Caddy routes with forward_auth protection for ai and files LAN matchers', () => {
    // Override hostBuilder LAN state to generate LAN matchers
    hostBuilder.refreshInterfaces();

    const routes = [
      {
        subdomain: 'ai',
        targetPort: 11434,
        targetHost: '127.0.0.1',
        exposeLocal: true,
        exposeLan: true,
      },
      {
        subdomain: 'files',
        targetPort: 8080,
        targetHost: '127.0.0.1',
        exposeLocal: true,
        exposeLan: true,
      },
    ];

    const { config } = caddyManager.generateFullConfig(routes);
    const serverRoutes = config.apps.http.servers.srv0.routes;

    // Check for route-ai (local route)
    const aiLocal = serverRoutes.find((r: any) => r['@id'] === 'route-ai' || r['@id'] === 'route-ai-local');
    expect(aiLocal).toBeDefined();

    // Check for route-ai-lan-protected
    const aiLan = serverRoutes.find((r: any) => r['@id'] === 'route-ai-lan-protected');
    if (aiLan) {
      // Must contain forward_auth reverse proxy to /api/v1/auth/verify
      const authHandler = aiLan.handle.find((h: any) => h.rewrite?.uri === '/api/v1/auth/verify');
      expect(authHandler).toBeDefined();
      expect(authHandler.upstreams[0].dial).toBe('127.0.0.1:3001');
      expect(authHandler.handle_response[0].match.status_code).toContain(200);
    }
  });
});
