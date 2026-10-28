import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createTestServer, TestServerInstance } from './testServerHelper';

/**
 * P2 Security Defect: Unauthenticated API exposure on 0.0.0.0:3001
 * 
 * Requirement FR2: All management API routes must require authentication (JWT or API Key).
 * Unauthenticated requests must receive 401 Unauthorized.
 * 
 * Expected in Phase 0: FAIL (Current prototype accepts requests without authentication and returns 200).
 */
describe('P2: Unauthenticated API Access Control', () => {
  let testServer: TestServerInstance;

  beforeAll(async () => {
    testServer = await createTestServer(0);
  });

  afterAll(async () => {
    if (testServer) {
      await testServer.server.stop();
    }
  });

  async function makeRequest(path: string, method = 'GET', body?: any): Promise<{ status: number; data: any }> {
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

  it('rejects unauthenticated GET /api/services with 401 Unauthorized', async () => {
    const res = await makeRequest('/api/services');
    // Secure expectation: must require JWT / Auth header
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST /api/caddy/sync with 401 Unauthorized', async () => {
    const res = await makeRequest('/api/caddy/sync', 'POST');
    // Secure expectation: must require JWT / Auth header
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated GET /api/system-info with 401 Unauthorized', async () => {
    const res = await makeRequest('/api/system-info');
    // Secure expectation: system info leaks internal network IPs and paths
    expect(res.status).toBe(401);
  });
});
