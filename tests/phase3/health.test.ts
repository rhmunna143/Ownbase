import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import http from 'http';
import net from 'net';
import { ServiceHealthProber } from '../../src/daemon/supervisor/health';

describe('Phase 3 - Item 3.5: Health Prober (TCP & HTTP)', () => {
  let tcpServer: net.Server;
  let httpServer: http.Server;
  const tcpPort = 39871;
  const httpPort = 39872;

  beforeAll(async () => {
    // Setup test TCP listener
    tcpServer = net.createServer((socket) => {
      socket.end();
    });
    await new Promise<void>((res) => tcpServer.listen(tcpPort, '127.0.0.1', () => res()));

    // Setup test HTTP listener
    httpServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((res) => httpServer.listen(httpPort, '127.0.0.1', () => res()));
  });

  afterAll(async () => {
    await new Promise<void>((res) => tcpServer.close(() => res()));
    await new Promise<void>((res) => httpServer.close(() => res()));
  });

  it('probes TCP port successfully when listening', async () => {
    const prober = new ServiceHealthProber('tcp-svc', 'TCP Service', {
      type: 'tcp',
      port: tcpPort,
      timeoutMs: 1000,
    });
    prober.start();

    const result = await prober.probe();
    expect(result.status).toBe('healthy');
    expect(result.consecutiveFailures).toBe(0);
    expect(result.latencyMs).toBeDefined();

    prober.stop();
  });

  it('detects TCP failure and transitions to unhealthy when closed', async () => {
    const prober = new ServiceHealthProber('tcp-dead', 'Dead Service', {
      type: 'tcp',
      port: 39999, // Unused port
      timeoutMs: 300,
      failureThreshold: 2,
    });
    prober.start();

    // Probe 1: Failure 1
    const res1 = await prober.probe();
    expect(res1.consecutiveFailures).toBe(1);
    expect(res1.status).toBe('probing');

    // Probe 2: Failure 2 hits threshold 2
    const res2 = await prober.probe();
    expect(res2.consecutiveFailures).toBe(2);
    expect(res2.status).toBe('unhealthy');

    prober.stop();
  });

  it('probes HTTP endpoint successfully when returning 200', async () => {
    const prober = new ServiceHealthProber('http-svc', 'HTTP Service', {
      type: 'http',
      port: httpPort,
      path: '/health',
      timeoutMs: 1000,
    });
    prober.start();

    const result = await prober.probe();
    expect(result.status).toBe('healthy');
    expect(result.consecutiveFailures).toBe(0);

    prober.stop();
  });

  it('detects HTTP 500 status code as failure', async () => {
    const prober = new ServiceHealthProber('http-fail', 'Failing HTTP Service', {
      type: 'http',
      port: httpPort,
      path: '/error',
      timeoutMs: 1000,
      failureThreshold: 1,
    });
    prober.start();

    const result = await prober.probe();
    expect(result.status).toBe('unhealthy');
    expect(result.consecutiveFailures).toBe(1);

    prober.stop();
  });
});
