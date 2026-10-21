import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import { tcpProxyManager } from '../../src/daemon/network/tcpProxy';

describe('Phase 5 - Item 5.5 & D10 & A4: Direct TCP Exposure', () => {
  let echoServer: net.Server;
  const echoPort = 19550;
  const proxyPort = 19551;

  beforeAll(async () => {
    // Spin up an echo TCP server to act as a backend database / raw protocol target
    echoServer = net.createServer((socket) => {
      socket.on('data', (data) => {
        socket.write(Buffer.concat([Buffer.from('ECHO: '), data]));
      });
    });

    await new Promise<void>((resolve) => {
      echoServer.listen(echoPort, '127.0.0.1', () => resolve());
    });
  });

  afterAll(async () => {
    await tcpProxyManager.stopAll();
    await new Promise<void>((resolve) => echoServer.close(() => resolve()));
  });

  it('starts direct TCP forwarder and proxies bidirectional streams', async () => {
    const listener = await tcpProxyManager.startProxy({
      listenPort: proxyPort,
      targetPort: echoPort,
      targetHost: '127.0.0.1',
    });

    expect(listener.listenPort).toBe(proxyPort);
    expect(listener.targetPort).toBe(echoPort);

    // Connect a client socket through the proxy port
    const client = new net.Socket();
    const response = await new Promise<string>((resolve, reject) => {
      client.connect(proxyPort, '127.0.0.1', () => {
        client.write('Hello TCP Proxy');
      });

      client.on('data', (data) => {
        resolve(data.toString());
        client.destroy();
      });

      client.on('error', (err) => reject(err));
    });

    expect(response).toBe('ECHO: Hello TCP Proxy');
  });

  it('lists active TCP forwarders in memory', () => {
    const active = tcpProxyManager.getActiveListeners();
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.some((l) => l.listenPort === proxyPort)).toBe(true);
  });

  it('stops active TCP forwarder cleanly (A4)', async () => {
    const stopped = await tcpProxyManager.stopProxy(proxyPort);
    expect(stopped).toBe(true);

    const active = tcpProxyManager.getActiveListeners();
    expect(active.some((l) => l.listenPort === proxyPort)).toBe(false);
  });
});
