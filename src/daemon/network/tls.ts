import dns from 'dns';
import net from 'net';
import { logger } from '../core/logger';
import { hostBuilder } from '../core/hostBuilder';

export interface TlsPreflightResult {
  ok: boolean;
  domain: string;
  resolvedIps: string[];
  isCgnat: boolean;
  issues: string[];
  suggestions: string[];
}

/**
 * Checks if an IP is in the RFC 6598 Carrier-Grade NAT (CGNAT) range:
 * 100.64.0.0/10 (100.64.0.0 – 100.127.255.255).
 */
export function isCgnatIp(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4) return false;
  // 100.64.0.0 to 100.127.255.255
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export class TlsManager {
  /**
   * Pre-flight validation for custom domain ACME HTTP-01 issuance.
   * Checks DNS resolution, local port availability, and CGNAT conflicts.
   */
  public async checkPreflight(domain: string): Promise<TlsPreflightResult> {
    const trimmedDomain = domain.trim().toLowerCase();
    const issues: string[] = [];
    const suggestions: string[] = [];
    let resolvedIps: string[] = [];
    let isCgnat = false;

    // 1. DNS Resolution
    try {
      resolvedIps = await dns.promises.resolve4(trimmedDomain);
      if (resolvedIps.length === 0) {
        issues.push(`Domain "${trimmedDomain}" has no A records configured.`);
        suggestions.push(`Add an A record pointing "${trimmedDomain}" to your server's public IP.`);
      }
    } catch (err: any) {
      issues.push(`DNS resolution failed for "${trimmedDomain}": ${err.message}`);
      suggestions.push(`Ensure your domain registrar has an A record pointing to your external IP.`);
    }

    // 2. Check for CGNAT
    const netState = hostBuilder.getNetworkState();
    for (const ip of resolvedIps) {
      if (isCgnatIp(ip)) {
        isCgnat = true;
        break;
      }
    }

    // Also check local WAN/LAN if possible
    for (const lanIp of netState.lanIps) {
      if (isCgnatIp(lanIp)) {
        isCgnat = true;
      }
    }

    if (isCgnat) {
      issues.push(
        `Carrier-Grade NAT (CGNAT) detected. Your ISP does not provide a direct public IPv4 address, blocking ACME HTTP-01 verification.`
      );
      suggestions.push(
        `Use Tailscale MagicDNS (*.ts.net) for seamless, automatic HTTPS certificates without port forwarding or a public IPv4.`
      );
    }

    // 3. Check loopback port 80 accessibility
    const port80Open = await this.testPort(80);
    if (!port80Open) {
      issues.push('Port 80 is not listening locally; ACME HTTP-01 challenge cannot complete.');
      suggestions.push('Ensure the Caddy reverse proxy service is running and bound to port 80.');
    }

    return {
      ok: issues.length === 0,
      domain: trimmedDomain,
      resolvedIps,
      isCgnat,
      issues,
      suggestions,
    };
  }

  private testPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1500);
      socket.connect(port, '127.0.0.1', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Generates Caddy TLS automation policy for custom domains.
   */
  public generateTlsConfig(customDomains: string[]) {
    if (customDomains.length === 0) return undefined;

    return {
      automation: {
        policies: [
          {
            subjects: customDomains,
            issuance: [
              {
                module: 'acme',
              },
            ],
          },
        ],
      },
    };
  }
}

export const tlsManager = new TlsManager();
