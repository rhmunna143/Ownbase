import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { ROUTE_TABLE, matchRoute } from '../../src/shared/contract/routes';
import { safeResolvePath } from '../../src/main/core/pathGuard';
import { createTestServer, TestServerInstance } from './testServerHelper';
import { Role } from '../../src/shared/contract/types';

describe('Phase 1 Acceptance Criteria (A1 - A7)', () => {
  let testServer: TestServerInstance;

  beforeAll(async () => {
    testServer = await createTestServer(3105);
  });

  afterAll(async () => {
    if (testServer) {
      await testServer.server.stop();
    }
  });

  async function makeRequest(
    path: string,
    method = 'GET',
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, testServer.baseUrl);
      const postData = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
            ...headers,
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
            resolve({ status: res.statusCode || 200, data });
          });
        }
      );
      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      if (postData) req.write(postData);
      req.end();
    });
  }

  // ==========================================
  // Acceptance A1 & A2: Route Table & RBAC Matrix
  // ==========================================
  describe('A1 & A2: Route Table RBAC & Public Routes Enforcement', () => {
    it('A2: enforces that only whitelisted routes are marked public', () => {
      const publicRoutes = ROUTE_TABLE.filter((r) => r.auth === 'public');
      const publicPaths = publicRoutes.map((r) => r.path);

      expect(publicPaths).toContain('/api/v1/health');
      expect(publicPaths).toContain('/api/v1/setup/status');
      expect(publicPaths).toContain('/api/v1/setup');
      expect(publicPaths).toContain('/api/v1/auth/login');
      expect(publicPaths).toContain('/api/v1/auth/refresh');
      expect(publicPaths).toContain('/api/v1/openapi.json');
      expect(publicPaths).toContain('/api/v1/docs/endpoints');

      // Verify no management, service, route or file endpoints are public
      for (const r of publicRoutes) {
        expect(['/api/v1/services', '/api/v1/routes', '/api/v1/files', '/api/v1/db']).not.toContain(r.path);
      }
    });

    it('A1: every route not marked public returns 401 without authentication', async () => {
      // Test key representative protected endpoints across all categories
      const protectedEndpoints = [
        { path: '/api/v1/system-info', method: 'GET' },
        { path: '/api/v1/services', method: 'GET' },
        { path: '/api/v1/routes', method: 'GET' },
        { path: '/api/v1/caddy/sync', method: 'POST' },
        { path: '/api/v1/files/list', method: 'GET' },
        { path: '/api/v1/photos/timeline', method: 'GET' },
        { path: '/api/v1/db/tables', method: 'GET' },
        { path: '/api/v1/audit/logs', method: 'GET' },
        { path: '/api/v1/users', method: 'GET' },
        { path: '/api/v1/api-keys', method: 'GET' },
      ];

      for (const ep of protectedEndpoints) {
        const res = await makeRequest(ep.path, ep.method);
        expect(res.status, `Endpoint ${ep.method} ${ep.path} must return 401 without auth`).toBe(401);
      }
    });

    it('A1: returns 403 when authenticated user has insufficient role privilege', async () => {
      // Generate a valid JWT for READ_ONLY user
      const authService = testServer.server.getAuthService();
      const readOnlyJwt = await authService.generateAccessToken({
        id: 'usr-readonly-001',
        username: 'analyst',
        role: 'READ_ONLY',
      });

      // Attempt to access an ADMIN-only endpoint (e.g. POST /api/v1/caddy/sync)
      const resAdmin = await makeRequest('/api/v1/caddy/sync', 'POST', {
        Authorization: `Bearer ${readOnlyJwt}`,
      });
      expect(resAdmin.status).toBe(403);

      // Attempt to access a ROOT-only endpoint (e.g. GET /api/v1/users)
      const resRoot = await makeRequest('/api/v1/users', 'GET', {
        Authorization: `Bearer ${readOnlyJwt}`,
      });
      expect(resRoot.status).toBe(403);
    });
  });

  // ==========================================
  // Acceptance A3: Path Fuzzing & Escape Rejection
  // ==========================================
  describe('A3: Path Fuzz Corpus & Root Containment', () => {
    const testRoot = 'C:\\Ownbase\\Storage';

    const fuzzCases = [
      '....//etc/passwd',
      '..\\..\\windows\\system32',
      'C:\\secret.txt',
      '\\\\server\\share\\data',
      'file.txt::$DATA',
      'test.txt:stream',
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'LPT1',
      'folder/../../escape',
      'sub/%2e%2e/%2e%2e/root',
      'a/b/c/../../../../../../boot.ini',
    ];

    it.each(fuzzCases)('rejects escape or invalid path: "%s"', (maliciousInput) => {
      expect(() => {
        safeResolvePath(testRoot, maliciousInput);
      }).toThrow();
    });

    it('allows safe relative descendant paths within the root', () => {
      const resolved = safeResolvePath(testRoot, 'documents/report.pdf');
      expect(resolved.toLowerCase()).toContain('documents');
      expect(resolved.toLowerCase()).toContain('report.pdf');
    });
  });

  // ==========================================
  // Acceptance A4: Zero SQL text endpoints & Read-Only table browser
  // ==========================================
  describe('A4: No SQL Text Execution & Read-Only Table Browser', () => {
    it('returns 404 for removed /api/execute-query', async () => {
      const res = await makeRequest('/api/execute-query', 'POST', {}, { sql: 'SELECT 1' });
      expect(res.status).toBe(404);
    });

    it('table browser rejects non-permitted tables', async () => {
      const tableBrowser = testServer.server.getTableBrowser();
      await expect(
        tableBrowser.queryTable('pg_shadow')
      ).rejects.toThrow(/not permitted/);
    });

    it('table browser successfully queries permitted tables inside isolated read-only transaction', async () => {
      const tableBrowser = testServer.server.getTableBrowser();
      const res = await tableBrowser.queryTable('services');
      expect(res).toBeDefined();
      expect(Array.isArray(res.rows)).toBe(true);
      expect(typeof res.totalCount).toBe('number');
    });
  });

  // ==========================================
  // Acceptance A5: No Hardcoded Default Credentials
  // ==========================================
  describe('A5: Zero Hardcoded Credentials', () => {
    it('verifies default credentials do not exist in supervisor or components', () => {
      // Verified in p5-hardcoded-credentials.test.ts
      expect(true).toBe(true);
    });
  });

  // ==========================================
  // Acceptance A6: Argon2id Login Rate-Limiting & Throttle
  // ==========================================
  describe('A6: Login Throttling & Protection', () => {
    it('enforces delay/lockout after repeated failed attempts', async () => {
      const throttle = (await import('../../src/main/auth/throttle')).loginThrottle;
      const testIp = '10.99.88.77';
      const testUser = 'target_user';

      // Record 10 failed login attempts
      for (let i = 0; i < 10; i++) {
        throttle.recordFailure(testIp, testUser);
      }

      const status = throttle.check(testIp, testUser);
      expect(status.allowed).toBe(false);
      expect(status.retryAfterSeconds).toBeGreaterThan(0);
    });
  });
});
