import { describe, it, expect } from 'vitest';
import { isCgnatIp, tlsManager } from '../../src/daemon/network/tls';

describe('Phase 5 - Item 5.4 & A3: TLS Manager & ACME Pre-flight Validation', () => {
  it('correctly identifies RFC 6598 Carrier-Grade NAT (CGNAT) IPv4 addresses', () => {
    // CGNAT range is 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    expect(isCgnatIp('100.64.0.1')).toBe(true);
    expect(isCgnatIp('100.100.50.25')).toBe(true);
    expect(isCgnatIp('100.127.255.254')).toBe(true);

    // Non-CGNAT addresses
    expect(isCgnatIp('192.168.1.1')).toBe(false);
    expect(isCgnatIp('10.0.0.1')).toBe(false);
    expect(isCgnatIp('8.8.8.8')).toBe(false);
    expect(isCgnatIp('100.63.255.255')).toBe(false); // below range
    expect(isCgnatIp('100.128.0.1')).toBe(false); // above range
  });

  it('detects unresolvable domains in ACME pre-flight check and provides helpful advice', async () => {
    const res = await tlsManager.checkPreflight('non-existent-domain-ownbase-xyz123.org');

    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res.suggestions.length).toBeGreaterThan(0);
    expect(res.suggestions[0]).toContain('record');
  });

  it('generates Caddy TLS automation policy for custom domains', () => {
    const config = tlsManager.generateTlsConfig(['myapp.example.com']);
    expect(config).toBeDefined();
    expect(config?.automation.policies[0].subjects).toContain('myapp.example.com');
  });
});
