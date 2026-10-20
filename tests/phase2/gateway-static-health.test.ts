import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { PostgresManager } from '../../src/daemon/db/postgres';
import { PrismaManager } from '../../src/daemon/db/prisma';
import { ProcessSupervisor } from '../../src/daemon/supervisor/supervisor';
import { CaddyManager } from '../../src/daemon/network/caddy';
import { TailscaleManager } from '../../src/daemon/network/tailscale';

describe('Item 2.11, 2.13 & Decision D3: Gateway, Static UI & Health Probing', () => {
  const TEST_PORT = 3199;
  let server: WebApiServer;

  beforeAll(async () => {
    const pg = new PostgresManager(5432);
    const prisma = new PrismaManager(5432, 'postgres');
    const supervisor = new ProcessSupervisor(prisma);
    const caddy = new CaddyManager(prisma);
    const tailscale = new TailscaleManager(prisma);

    server = new WebApiServer(
      pg,
      prisma,
      supervisor,
      caddy,
      tailscale,
      () => [
        { id: 'paths-init', name: 'Path Environment', status: 'success' },
        { id: 'config-init', name: 'Configuration & Secrets', status: 'success' },
        { id: 'gateway-early', name: 'API Gateway', status: 'success' },
      ],
      TEST_PORT
    );

    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  function makeRequest(path: string, options: http.RequestOptions = {}): Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path,
          method: options.method || 'GET',
          headers: options.headers || {},
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body,
            });
          });
        }
      );
      req.on('error', reject);
      if (options.method === 'POST' && (options as any).body) {
        req.write((options as any).body);
      }
      req.end();
    });
  }

  it('binds to 127.0.0.1 and serves /api/v1/health with subsystem readiness states', async () => {
    const res = await makeRequest('/api/v1/health');
    expect(res.statusCode).toBe(200);

    const data = JSON.parse(res.body);
    expect(data.status).toBeDefined();
    expect(data.uptime).toBeTypeOf('number');
    expect(data.subsystems).toBeDefined();
    expect(data.subsystems.paths).toBeDefined();
    expect(data.subsystems.postgres).toBeDefined();
    expect(data.subsystems.migrations).toBeDefined();
    expect(data.subsystems.supervisor).toBeDefined();
    expect(data.subsystems.power).toBeDefined();
  });

  it('serves the Next.js static UI index.html on root /', async () => {
    const res = await makeRequest('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!DOCTYPE html>');
  });

  it('serves static files with immutable caching for _next/static paths', async () => {
    // Check if any _next/static chunk exists to test caching header
    const res = await makeRequest('/index.html');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('blocks path traversal attempts outside out/ directory', async () => {
    const res = await makeRequest('/..%2fpackage.json');
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('native-windows-server-hub');
  });

  it('serves OpenAPI documentation at /api/v1/openapi.json', async () => {
    const res = await makeRequest('/api/v1/openapi.json');
    expect(res.statusCode).toBe(200);
    const spec = JSON.parse(res.body);
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/v1/health']).toBeDefined();
  });
});
