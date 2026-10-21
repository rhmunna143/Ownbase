import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebApiServer } from '../../src/daemon/gateway/httpServer';
import { PostgresManager } from '../../src/daemon/db/postgres';
import { PrismaManager } from '../../src/daemon/db/prisma';
import { ProcessSupervisor } from '../../src/daemon/supervisor/supervisor';
import { CaddyManager } from '../../src/daemon/network/caddy';
import { TailscaleManager } from '../../src/daemon/network/tailscale';

describe('Phase 4 - Item 4.10: REST API Endpoints for Apps and Catalog', () => {
  const TEST_PORT = 3299;
  let server: WebApiServer;
  let authToken: string;
  let createdAppId: string;

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
      () => [],
      TEST_PORT
    );

    await server.start();

    // Generate root token for testing authenticated routes
    authToken = await server.getAuthService().generateAccessToken({
      id: 'test-admin-id',
      username: 'test-admin',
      role: 'ROOT',
    });
  });

  afterAll(async () => {
    // Cleanup any created app
    if (createdAppId) {
      await makeRequest(`/api/v1/apps/${createdAppId}`, { method: 'DELETE' });
    }
    await server.stop();
  });

  function makeRequest(
    path: string,
    options: { method?: string; body?: any; headers?: Record<string, string> } = {}
  ): Promise<{ statusCode: number; json: any; raw: string }> {
    return new Promise((resolve, reject) => {
      const payload = options.body ? JSON.stringify(options.body) : undefined;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${authToken}`,
        ...(options.headers || {}),
      };

      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path,
          method: options.method || 'GET',
          headers,
        },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(body);
            } catch {}
            resolve({ statusCode: res.statusCode || 200, json, raw: body });
          });
        }
      );

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  it('enforces RBAC authentication: rejects unauthenticated requests with 401', async () => {
    const res = await new Promise<any>((resolve) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/api/v1/apps`, (r) => {
        resolve({ statusCode: r.statusCode });
      });
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/catalog: returns validated declarative catalog recipes', async () => {
    const res = await makeRequest('/api/v1/catalog');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json)).toBe(true);
    expect(res.json.length).toBeGreaterThanOrEqual(8);

    const ids = res.json.map((r: any) => r.id);
    expect(ids).toContain('static-site');
    expect(ids).toContain('node-express');
    expect(ids).toContain('python-fastapi');
    expect(ids).toContain('go-web');
    expect(ids).toContain('redis');
  });

  it('POST /api/v1/apps: creates a new application record with deterministic port', async () => {
    const slug = `api-test-app-${Date.now()}`;
    const res = await makeRequest('/api/v1/apps', {
      method: 'POST',
      body: {
        name: 'API Test Application',
        slug,
        sourceType: 'git',
        repoUrl: 'https://github.com/example/repo',
        branch: 'main',
        runtime: 'node',
        startCommand: 'node index.js',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json.id).toBeTruthy();
    expect(res.json.slug).toBe(slug);
    expect(res.json.port).toBeGreaterThanOrEqual(4000);
    expect(res.json.port).toBeLessThanOrEqual(4999);

    createdAppId = res.json.id;
  });

  it('GET /api/v1/apps: lists registered applications', async () => {
    const res = await makeRequest('/api/v1/apps');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json)).toBe(true);

    const found = res.json.find((a: any) => a.id === createdAppId);
    expect(found).toBeDefined();
    expect(found.name).toBe('API Test Application');
  });

  it('GET /api/v1/apps/:id: returns specific application details', async () => {
    const res = await makeRequest(`/api/v1/apps/${createdAppId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json.id).toBe(createdAppId);
    expect(res.json.releases).toBeDefined();
    expect(res.json.deployments).toBeDefined();
  });

  it('POST /api/v1/catalog/install: installs an application from catalog recipe', async () => {
    const res = await makeRequest('/api/v1/catalog/install', {
      method: 'POST',
      body: {
        recipeId: 'static-site',
        name: `Catalog Install ${Date.now()}`,
        subdomain: `catalog-install-${Date.now()}`,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json.success).toBe(true);
    expect(res.json.app).toBeDefined();
    expect(res.json.app.runtime).toBe('static');

    // Clean up created catalog app
    await makeRequest(`/api/v1/apps/${res.json.app.id}`, { method: 'DELETE' });
  });

  it('DELETE /api/v1/apps/:id: deletes application and cleans up resources', async () => {
    const res = await makeRequest(`/api/v1/apps/${createdAppId}`, { method: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect(res.json.success).toBe(true);

    const check = await makeRequest(`/api/v1/apps/${createdAppId}`);
    expect(check.statusCode).toBe(404);
    createdAppId = '';
  });
});
