import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createTestServer, TestServerInstance } from './testServerHelper';

/**
 * P3 Security Defect: Arbitrary Raw SQL Execution Endpoint
 * 
 * Requirement FR3 / Item 1.7: The raw SQL console (/api/execute-query) must be deleted.
 * Arbitrary SQL string execution must not be exposed over HTTP or IPC.
 * 
 * Expected in Phase 0: FAIL (Current prototype exposes /api/execute-query and executes raw SQL).
 */
describe('P3: Raw SQL Execution Endpoint Removal', () => {
  let testServer: TestServerInstance;

  beforeAll(async () => {
    testServer = await createTestServer(3103);
  });

  afterAll(async () => {
    if (testServer) {
      await testServer.server.stop();
    }
  });

  async function postQuery(sql: string): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/execute-query', testServer.baseUrl);
      const postData = JSON.stringify({ query: sql });
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
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
      req.write(postData);
      req.end();
    });
  }

  it('rejects or removes /api/execute-query (endpoint must return 404 or 405)', async () => {
    const res = await postQuery('SELECT 1 as test');
    // Secure expectation: Endpoint must not exist (404)
    expect(res.status).toBe(404);
  });

  it('blocks dangerous DDL execution (e.g. DROP TABLE or schema modification)', async () => {
    const res = await postQuery('DROP TABLE IF EXISTS test_injection_dummy');
    // Secure expectation: Should be rejected as not found (404) or forbidden (403)
    expect([403, 404]).toContain(res.status);
  });
});
