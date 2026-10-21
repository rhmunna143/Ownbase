import { describe, it, expect } from 'vitest';
import { HostBuilder, RouteIntent } from '../../src/daemon/core/hostBuilder';

describe('Phase 5 - Item 5.1 & D5: Dynamic HostBuilder', () => {
  it('builds standard *.localhost matcher and URL', () => {
    const builder = new HostBuilder();
    const intent: RouteIntent = {
      subdomain: 'files',
      targetPort: 8080,
      exposeLocal: true,
      exposeLan: false,
      exposeMesh: false,
    };

    const result = builder.build(intent);
    expect(result.subdomain).toBe('files');
    expect(result.caddyMatchers).toContain('files.localhost');
    expect(result.urls.some((u) => u.type === 'local' && u.url === 'http://files.localhost')).toBe(true);
  });

  it('generates dynamic .nip.io LAN URL and matcher without storing stale IPs (A1)', () => {
    const builder = new HostBuilder();
    const intent: RouteIntent = {
      subdomain: 'photos',
      targetPort: 3001,
      exposeLocal: true,
      exposeLan: true,
    };

    const mockLanState = {
      localIp: '192.168.1.120',
      lanIps: ['192.168.1.120'],
    };

    const result = builder.build(intent, mockLanState);
    expect(result.caddyMatchers).toContain('photos.localhost');
    expect(result.caddyMatchers).toContain('photos.192.168.1.120.nip.io');

    const lanUrl = result.urls.find((u) => u.type === 'lan');
    expect(lanUrl).toBeDefined();
    expect(lanUrl?.url).toBe('http://photos.192.168.1.120.nip.io');
    expect(lanUrl?.warning).toContain('without authentication');
  });

  it('generates Tailscale MagicDNS and custom domain URLs', () => {
    const builder = new HostBuilder();
    const intent: RouteIntent = {
      subdomain: 'ai',
      targetPort: 11434,
      exposeLocal: true,
      exposeMesh: true,
      customDomains: ['ai.mycompany.org'],
    };

    const mockMeshState = {
      localIp: '192.168.1.50',
      tailscaleDomain: 'node.tailnet.ts.net',
      tailscaleIp: '100.80.20.10',
    };

    const result = builder.build(intent, mockMeshState);
    expect(result.caddyMatchers).toContain('ai.localhost');
    expect(result.caddyMatchers).toContain('ai.node.tailnet.ts.net');
    expect(result.caddyMatchers).toContain('ai.mycompany.org');

    const meshUrl = result.urls.find((u) => u.type === 'mesh');
    expect(meshUrl?.url).toBe('https://ai.node.tailnet.ts.net');

    const customUrl = result.urls.find((u) => u.type === 'custom');
    expect(customUrl?.url).toBe('https://ai.mycompany.org');
  });

  it('triggers registered change listener on network IP update (A1 reactivity)', () => {
    const builder = new HostBuilder();
    let changeNotified = false;

    builder.onNetworkChange(() => {
      changeNotified = true;
    });

    // Manually trigger a domain change
    builder.setTailscaleDomain('new-device.ts.net');
    expect(changeNotified).toBe(true);
    expect(builder.getNetworkState().tailscaleDomain).toBe('new-device.ts.net');
  });
});
