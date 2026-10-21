import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { PostgresManager } from '../../src/daemon/db/postgres';
import { PrismaManager } from '../../src/daemon/db/prisma';
import { ProcessSupervisor } from '../../src/daemon/supervisor/supervisor';
import { CaddyManager } from '../../src/daemon/network/caddy';
import { TailscaleManager } from '../../src/daemon/network/tailscale';
import { FileManager } from '../../src/daemon/files/fileManager';
import { AuthService } from '../../src/daemon/auth/authService';

describe('Phase 5 - Item 5.7 & 5.14: Ingress & Storage REST API Gateway', () => {
  let server: WebApiServer;
  let testPort = 3105;
  let authHeader: string;

  beforeAll(async () => {
    const postgresManager = new PostgresManager();
    const prismaManager = new PrismaManager();
    const supervisor = new ProcessSupervisor(prismaManager);
    const caddy = new CaddyManager(prismaManager);
    const tailscale = new TailscaleManager(prismaManager);
    const fileManager = new FileManager();

    server = new WebApiServer(
      postgresManager,
      prismaManager,
      supervisor,
      caddy,
      tailscale,
      fileManager,
      testPort
    );

    const started = await server.start();
    expect(started).toBe(true);

    // Create an admin user token for test requests
    const authService = new AuthService(prismaManager);
    const client = prismaManager.getClient();
    let user = await (client as any).user.findFirst({ where: { role: 'ROOT' } });
    if (!user) {
      user = await authService.register('admin_test_p5', 'SecurePass123!@#', 'ROOT');
    }
    const token = await authService.generateAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });
    authHeader = `Bearer ${token}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /api/v1/network/urls returns derived accessible URLs with exposure warnings', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/network/urls`, {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const urls = await res.json();
    expect(Array.isArray(urls)).toBe(true);
  });

  it('POST /api/v1/network/tls/preflight runs ACME pre-flight analysis', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/network/tls/preflight`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'test.example.com' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.domain).toBe('test.example.com');
    expect(typeof data.ok).toBe('boolean');
    expect(Array.isArray(data.issues)).toBe(true);
  });

  it('GET /api/v1/storage/volumes returns discovered Windows storage volumes', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/storage/volumes`, {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const volumes = await res.json();
    expect(Array.isArray(volumes)).toBe(true);
    expect(volumes.length).toBeGreaterThanOrEqual(1);

    const sys = volumes.find((v: any) => v.isSystemDrive);
    expect(sys).toBeDefined();
    expect(sys.driveLetter).toMatch(/^[A-Z]:$/);
  });

  it('GET /api/v1/storage/usage returns storage usage breakdown and capacity alerts', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/storage/usage`, {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const usage = await res.json();
    expect(usage.volumes).toBeDefined();
    expect(Array.isArray(usage.volumes)).toBe(true);
    expect(Array.isArray(usage.alerts)).toBe(true);
  });

  it('GET /api/v1/media/timeline returns paginated media timeline', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/media/timeline?page=1&pageSize=10`, {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe('number');
  });

  it('GET /api/v1/network/tcp lists active TCP proxy listeners', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/network/tcp`, {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
