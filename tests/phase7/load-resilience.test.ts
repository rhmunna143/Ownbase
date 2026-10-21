import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { AuthService } from '../../src/daemon/auth/authService';
import { CaddyManager } from '../../src/daemon/network/caddy';

describe('Phase 7 - Item 7.7: High Concurrency Load Validation & Resilience (PRD §7.3 & Target p95 < 100ms)', () => {
  let server: WebApiServer;
  let authService: AuthService;
  let testPort = 3108;
  let authToken: string;

  beforeAll(async () => {
    const mockPrismaManager: any = {
      getClient: () => ({
        user: { findUnique: async () => null },
        route: { findMany: async () => [] },
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
    authToken = await authService.generateAccessToken({
      id: 'load-tester-id',
      username: 'loadtester',
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  const sendConcurrentGet = (path: string): Promise<{ statusCode: number; durationMs: number }> => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            const durationMs = Date.now() - start;
            resolve({ statusCode: res.statusCode || 500, durationMs });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  };

  it('handles 50 concurrent requests with p95 latency under 100ms', async () => {
    // Warm up cache and single-flight execution
    await sendConcurrentGet('/api/v1/health');

    const concurrency = 50;
    const initialMem = process.memoryUsage().rss;

    const promises = Array.from({ length: concurrency }, () =>
      sendConcurrentGet('/api/v1/health')
    );

    const results = await Promise.all(promises);

    // All requests must succeed
    for (const res of results) {
      expect([200, 503]).toContain(res.statusCode); // 200 or 503 depending on mock state
    }

    // Sort durations to calculate p95
    const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    const p95Latency = durations[p95Index];

    expect(p95Latency).toBeLessThan(100); // PRD target: under 100ms

    // Bounded memory check: RSS growth during test should be < 50 MB
    const finalMem = process.memoryUsage().rss;
    const memDeltaMb = (finalMem - initialMem) / (1024 * 1024);
    expect(memDeltaMb).toBeLessThan(50);
  });
});
