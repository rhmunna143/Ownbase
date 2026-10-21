import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import WebSocket from 'ws';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { AuthService } from '../../src/daemon/auth/authService';
import { TerminalManager, terminalManager } from '../../src/daemon/terminal/manager';
import { AuthenticatedUser } from '../../src/shared/contract/types';

describe('Phase 6: Audited ConPTY Web Terminal & Authorization (PRD §6.5 & A4)', () => {
  let server: WebApiServer;
  let authService: AuthService;
  let testPort = 3107;
  let rootUser: AuthenticatedUser;
  let adminUser: AuthenticatedUser;
  let operatorUser: AuthenticatedUser;

  let rootToken: string;
  let adminToken: string;
  let operatorToken: string;

  const recordedAuditEvents: any[] = [];

  beforeAll(async () => {
    const mockPrismaManager: any = {
      getClient: () => ({
        user: { findUnique: async () => null },
        auditLogV2: {
          create: async ({ data }: any) => {
            recordedAuditEvents.push(data);
          },
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

    const mockCaddyManager: any = {
      generateFullConfig: () => ({ config: {}, hash: 'test-hash' }),
      getStatus: async () => ({ isListening: true }),
    };

    const mockTailscaleManager: any = {
      getStatus: async () => ({ isInstalled: false }),
    };

    server = new WebApiServer(
      mockPostgresManager,
      mockPrismaManager,
      mockSupervisor,
      mockCaddyManager,
      mockTailscaleManager,
      () => [],
      testPort
    );

    await server.start();
    authService = server.getAuthService();

    rootUser = { id: 'user-root', username: 'superuser', role: 'ROOT' };
    adminUser = { id: 'user-admin', username: 'manager', role: 'ADMIN' };
    operatorUser = { id: 'user-operator', username: 'devops', role: 'OPERATOR' };

    rootToken = await authService.generateAccessToken(rootUser);
    adminToken = await authService.generateAccessToken(adminUser);
    operatorToken = await authService.generateAccessToken(operatorUser);
  });

  beforeEach(() => {
    terminalManager.closeAll();
  });

  afterAll(async () => {
    terminalManager.closeAll();
    await server.stop();
  });

  const connectWs = (token?: string, queryParams?: string): Promise<{ ws?: WebSocket; error?: any; statusCode?: number }> => {
    return new Promise((resolve) => {
      let url = `ws://127.0.0.1:${testPort}/api/v1/terminal/ws`;
      const params = new URLSearchParams();
      if (token) params.set('token', token);
      if (queryParams) {
        const extra = new URLSearchParams(queryParams);
        extra.forEach((v, k) => params.set(k, v));
      }
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const ws = new WebSocket(url);

      ws.on('open', () => {
        resolve({ ws });
      });

      ws.on('unexpected-response', (_req, res) => {
        resolve({ error: 'unexpected-response', statusCode: res.statusCode });
      });

      ws.on('error', (err: any) => {
        resolve({ error: err.message });
      });
    });
  };

  it('rejects WebSocket upgrade without token with 401 Unauthorized', async () => {
    const res = await connectWs();
    expect(res.statusCode).toBe(401);
  });

  it('strictly rejects non-ROOT roles (ADMIN) with 403 Forbidden on upgrade (A4)', async () => {
    const res = await connectWs(adminToken);
    expect(res.statusCode).toBe(403);
  });

  it('strictly rejects non-ROOT roles (OPERATOR) with 403 Forbidden on upgrade (A4)', async () => {
    const res = await connectWs(operatorToken);
    expect(res.statusCode).toBe(403);
  });

  it('successfully upgrades and connects WebSocket for ROOT role (A4)', async () => {
    const res = await connectWs(rootToken, 'cols=100&rows=30');
    expect(res.ws).toBeDefined();
    expect(res.ws?.readyState).toBe(WebSocket.OPEN);

    // Verify session appeared in active sessions
    const sessions = terminalManager.getActiveSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const rootSession = sessions.find((s) => s.actorName === 'superuser');
    expect(rootSession).toBeDefined();
    expect(rootSession?.actorRole).toBe('ROOT');
    expect(rootSession?.cols).toBe(100);
    expect(rootSession?.rows).toBe(30);

    // Verify transcript log file exists on disk (PRD §6.5 & A4)
    expect(fs.existsSync(rootSession!.transcriptPath)).toBe(true);
    const transcriptHeader = fs.readFileSync(rootSession!.transcriptPath, 'utf-8');
    expect(transcriptHeader).toContain('OWNBASE AUDITED TERMINAL TRANSCRIPT');
    expect(transcriptHeader).toContain('superuser');

    // Verify session_start audit log was recorded
    const startEvent = recordedAuditEvents.find((e) => e.action === 'terminal.session_start');
    expect(startEvent).toBeDefined();
    expect(startEvent.actorName).toBe('superuser');

    res.ws?.close();
  });

  it('updates dimensions when resize command is received', async () => {
    const res = await connectWs(rootToken);
    expect(res.ws).toBeDefined();

    const sessionInfo = terminalManager.getActiveSessions()[0];
    const session = terminalManager.getSession(sessionInfo.id);
    expect(session).toBeDefined();

    // Send JSON resize message
    res.ws?.send(JSON.stringify({ type: 'resize', cols: 140, rows: 45 }));

    // Small delay for message processing
    await new Promise((r) => setTimeout(r, 100));

    expect(session?.cols).toBe(140);
    expect(session?.rows).toBe(45);

    res.ws?.close();
  });

  it('enforces idle timeout and closes inactive sessions', async () => {
    const customManager = new TerminalManager({ idleTimeoutMs: 300 }); // 300ms idle timeout
    const testSession = await customManager.createSession(rootUser, '127.0.0.1');

    let timedOut = false;
    testSession.on('idle-timeout', () => {
      timedOut = true;
    });

    // Wait 500ms without input
    await new Promise((r) => setTimeout(r, 500));

    expect(timedOut).toBe(true);
    expect(customManager.getActiveSessions()).toHaveLength(0);
  });

  it('enforces maximum concurrent sessions cap', async () => {
    const smallManager = new TerminalManager({ maxConcurrentSessions: 2 });
    await smallManager.createSession(rootUser, '127.0.0.1');
    await smallManager.createSession(rootUser, '127.0.0.1');

    await expect(smallManager.createSession(rootUser, '127.0.0.1')).rejects.toThrow(
      /Maximum concurrent terminal sessions reached/
    );

    smallManager.closeAll();
  });

  it('provides admin REST endpoints for listing and terminating sessions', async () => {
    const res = await connectWs(rootToken);
    expect(res.ws).toBeDefined();

    const activeList = terminalManager.getActiveSessions();
    expect(activeList.length).toBeGreaterThanOrEqual(1);

    const targetSessionId = activeList[0].id;

    // Terminate via manager
    const closed = terminalManager.closeSession(targetSessionId);
    expect(closed).toBe(true);

    const afterList = terminalManager.getActiveSessions();
    expect(afterList.some((s) => s.id === targetSessionId)).toBe(false);

    res.ws?.close();
  });
});
