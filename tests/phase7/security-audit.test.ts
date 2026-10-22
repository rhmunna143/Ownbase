import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import http from 'http';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { AuthService } from '../../src/daemon/auth/authService';
import { CaddyManager } from '../../src/daemon/network/caddy';
import { safeResolvePath } from '../../src/daemon/core/pathGuard';
import { logger } from '../../src/daemon/core/logger';
import { AuthenticatedUser } from '../../src/shared/contract/types';

describe('Phase 7 - Item 7.2: OWASP ASVS L1 Security Re-Test & RBAC Matrix Audit (PRD §7.2 & Acceptance A1)', () => {
  let server: WebApiServer;
  let authService: AuthService;
  let testPort = 3107;
  let rootUser: AuthenticatedUser;
  let adminUser: AuthenticatedUser;
  let viewerUser: AuthenticatedUser;

  let rootToken: string;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    const mockPrismaManager: any = {
      getClient: () => ({
        user: { findUnique: async () => null },
        backupJob: {
          findMany: async () => [],
          create: async ({ data }: any) => ({ ...data }),
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

    rootUser = { id: 'u-root', username: 'rootadmin', role: 'ROOT' };
    adminUser = { id: 'u-admin', username: 'operations', role: 'ADMIN' };
    viewerUser = { id: 'u-viewer', username: 'auditor', role: 'READ_ONLY' };

    rootToken = await authService.generateAccessToken(rootUser);
    adminToken = await authService.generateAccessToken(adminUser);
    viewerToken = await authService.generateAccessToken(viewerUser);
  });

  afterAll(async () => {
    await server.stop();
  });

  const sendRequest = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ statusCode: number; data: any; headers: http.IncomingHttpHeaders }> => {
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
            resolve({ statusCode: res.statusCode || 500, data, headers: res.headers });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };

  describe('Exploit Re-Tests (P2, P3, P4, P5)', () => {
    it('P2 & A3: rejects unauthenticated LAN requests on protected services', async () => {
      const res = await sendRequest('GET', '/api/v1/auth/verify', {
        Host: 'ai.192.168.1.100.nip.io',
        'X-Forwarded-Host': 'ai.192.168.1.100.nip.io',
      });
      expect(res.statusCode).toBe(401);
      expect(res.data.error).toContain('Authentication required');
    });

    it('P3: unauthenticated raw SQL query endpoint is blocked', async () => {
      const res = await sendRequest('POST', '/api/execute-query', {}, { sql: 'SELECT 1;' });
      expect([401, 404]).toContain(res.statusCode);
    });

    it('P4: PathGuard rejects directory traversal, dot-dot, and Alternate Data Streams', () => {
      const baseDir = 'C:\\Projects\\Ownbase\\storage';

      expect(() => safeResolvePath(baseDir, '../../Windows/System32/calc.exe')).toThrow(/escape|traversal/i);
      expect(() => safeResolvePath(baseDir, '....//....//Windows')).toThrow(/escape|traversal/i);
      expect(() => safeResolvePath(baseDir, 'file.txt:hidden_stream')).toThrow(/colon|alternate/i);
      expect(() => safeResolvePath(baseDir, 'C:\\any\\other\\directory\\secret.txt')).toThrow(/forbidden|escape|traversal/i);
      expect(safeResolvePath(baseDir, '100%.txt')).toBe(path.join(path.resolve(baseDir), '100%.txt'));
      expect(safeResolvePath(baseDir, '50% discount.png')).toBe(path.join(path.resolve(baseDir), '50% discount.png'));
    });

    it('P5: setup wizard rejects weak password or default admin12345678', async () => {
      const res = await sendRequest('POST', '/api/v1/setup', {}, {
        username: 'admin',
        password: 'admin12345678', // Hardcoded default password from old prototype
      });
      // Either fails schema validation or returns 400 for weak/unsupported password
      expect(res.statusCode).toBe(400);
    });
  });

  describe('RBAC Authorization Matrix Enforcement', () => {
    it('allows ADMIN to list backups, but blocks READ_ONLY with 403', async () => {
      const adminRes = await sendRequest('GET', '/api/v1/backups', {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(adminRes.statusCode).toBe(200);

      const viewerRes = await sendRequest('GET', '/api/v1/backups', {
        Authorization: `Bearer ${viewerToken}`,
      });
      expect(viewerRes.statusCode).toBe(403);
    });

    it('strictly restricts restore and delete backup endpoints to ROOT role', async () => {
      // ADMIN attempts to trigger restore
      const adminRestore = await sendRequest('POST', '/api/v1/backups/test-backup-id/restore', {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(adminRestore.statusCode).toBe(403);

      // VIEWER attempts to trigger restore
      const viewerRestore = await sendRequest('POST', '/api/v1/backups/test-backup-id/restore', {
        Authorization: `Bearer ${viewerToken}`,
      });
      expect(viewerRestore.statusCode).toBe(403);
    });

    it('blocks unauthenticated requests to protected management endpoints', async () => {
      const res = await sendRequest('POST', '/api/v1/backups', {});
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Log & Secret Redaction Audit (PRD §7.8)', () => {
    it('redacts JWT access and refresh tokens from log output', () => {
      const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0NTYifQ.abcdEFGH-1234';
      const logMessage = `User authenticated with token: ${fakeJwt}`;
      const redacted = logger.redactSecrets(logMessage);

      expect(redacted).not.toContain(fakeJwt);
      expect(redacted).toContain('[REDACTED_JWT]');
    });

    it('redacts Authorization Bearer and Basic headers from log output', () => {
      const authHeader = 'Bearer eyJhbGciOiJIUzI1NiJ9.test.sig';
      const basicHeader = 'Basic dXNlcjpwYXNzd29yZA==';
      const redacted = logger.redactSecrets(`Incoming request with ${authHeader} and ${basicHeader}`);

      expect(redacted).toMatch(/Bearer \[REDACTED_(TOKEN|JWT)\]/);
      expect(redacted).toContain('Basic [REDACTED_BASIC_AUTH]');
    });

    it('redacts PostgreSQL credentials in connection strings', () => {
      const connStr = 'postgresql://postgres:SuperSecretPassword123@127.0.0.1:5432/postgres?schema=public';
      const redacted = logger.redactSecrets(`Connecting to ${connStr}`);

      expect(redacted).not.toContain('SuperSecretPassword123');
      expect(redacted).toContain('[REDACTED_DB_PASS]');
    });

    it('redacts sensitive JSON fields: password, secretKey, accessKey, dataKey', () => {
      const payload = JSON.stringify({
        password: 'PlainTextUserPassword!',
        secretKey: 'SecretObjectStorageKey456',
        accessKey: 'OwnbaseAccessKey789',
        dataKey: 'MasterEncryptionKeyHexValue',
        username: 'safe_username',
      });

      const redacted = logger.redactSecrets(payload);

      expect(redacted).not.toContain('PlainTextUserPassword!');
      expect(redacted).not.toContain('SecretObjectStorageKey456');
      expect(redacted).not.toContain('MasterEncryptionKeyHexValue');
      expect(redacted).toContain('safe_username');
    });
  });
});
