import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import { PrismaManager } from '../db/prisma';
import { TailscaleStatus } from '../../shared/types';
import { hostBuilder } from '../core/hostBuilder';
import { firewallManager } from './firewall';

export interface TailscalePeerInfo {
  id: string;
  hostName: string;
  dnsName: string;
  ips: string[];
  os: string;
  online: boolean;
}

export interface TailscaleDetailedStatus extends TailscaleStatus {
  magicDnsDomain?: string;
  dnsName?: string;
  peers?: TailscalePeerInfo[];
  funnelEnabled?: boolean;
}

export class TailscaleManager {
  private binaryPath: string = '';
  private prismaManager: PrismaManager;
  private cachedIp: string | null = null;
  private isConnected: boolean = false;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
    this.resolveBinary();
  }

  public resolveBinary(): string {
    const candidatePaths = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
      path.join(paths.extraResourcesDir, 'bin', 'tailscale.exe'),
      path.join(paths.extraResourcesDir, 'tailscale.exe'),
      path.join(paths.runtimesDir, 'tailscale.exe'),
      path.join(process.cwd(), 'extraResources', 'bin', 'tailscale.exe'),
    ];

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        this.binaryPath = cand;
        return cand;
      }
    }

    try {
      const stdout = require('child_process').execSync('where.exe tailscale', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const firstLine = stdout.trim().split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        this.binaryPath = firstLine;
        return firstLine;
      }
    } catch {
      // not on PATH
    }

    this.binaryPath = path.join(paths.extraResourcesDir, 'bin', 'tailscale.exe');
    return this.binaryPath;
  }

  public async getMeshIp(): Promise<string | null> {
    const netState = hostBuilder.getNetworkState();
    if (netState.tailscaleIp) {
      this.cachedIp = netState.tailscaleIp;
      this.isConnected = true;
      return netState.tailscaleIp;
    }

    const bin = this.resolveBinary();
    if (!fs.existsSync(bin)) return null;

    return new Promise((resolve) => {
      execFile(bin, ['ip', '-4'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) {
          const fallback = hostBuilder.getNetworkState().tailscaleIp;
          this.cachedIp = fallback || null;
          this.isConnected = !!fallback;
          return resolve(fallback || null);
        }

        const ip = stdout.trim().split(/\r?\n/)[0]?.trim();
        if (ip && ip.startsWith('100.')) {
          this.cachedIp = ip;
          this.isConnected = true;
          return resolve(ip);
        }
        const fallback = hostBuilder.getNetworkState().tailscaleIp;
        this.cachedIp = fallback || null;
        this.isConnected = !!fallback;
        resolve(fallback || null);
      });
    });
  }

  /**
   * Queries Tailscale daemon via `tailscale status --json` (Item 5.6).
   */
  public async getDetailedStatus(): Promise<TailscaleDetailedStatus> {
    const bin = this.resolveBinary();
    const isInstalled = fs.existsSync(bin);

    if (!isInstalled) {
      const fallbackIp = hostBuilder.getNetworkState().tailscaleIp;
      this.cachedIp = fallbackIp || null;
      this.isConnected = !!fallbackIp;
      return {
        connected: !!fallbackIp,
        ip: fallbackIp || null,
        binaryPath: bin,
      };
    }

    return new Promise((resolve) => {
      execFile(bin, ['status', '--json'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) {
          const fallbackIp = hostBuilder.getNetworkState().tailscaleIp;
          this.cachedIp = fallbackIp || null;
          this.isConnected = !!fallbackIp;
          return resolve({
            connected: !!fallbackIp,
            ip: fallbackIp || null,
            binaryPath: bin,
          });
        }

        try {
          const data = JSON.parse(stdout);
          const self = data.Self || {};
          const ipList: string[] = self.TailscaleIPs || data.TailscaleIPs || [];
          let ipv4 = ipList.find((ip) => ip.startsWith('100.')) || null;

          if (!ipv4) {
            ipv4 = hostBuilder.getNetworkState().tailscaleIp || null;
          }

          const peers: TailscalePeerInfo[] = [];
          if (data.Peer) {
            for (const peerId of Object.keys(data.Peer)) {
              const p = data.Peer[peerId];
              peers.push({
                id: peerId,
                hostName: p.HostName || '',
                dnsName: p.DNSName || '',
                ips: p.TailscaleIPs || [],
                os: p.OS || 'unknown',
                online: !!p.Online,
              });
            }
          }

          const dnsName = self.DNSName ? self.DNSName.replace(/\.$/, '') : undefined;
          const magicDnsDomain = data.MagicDNSSuffix || undefined;

          if (dnsName) {
            hostBuilder.setTailscaleDomain(dnsName);
          }

          const connected = data.BackendState === 'Running' || !!ipv4;
          this.isConnected = connected;
          this.cachedIp = ipv4;

          resolve({
            connected,
            ip: ipv4,
            binaryPath: bin,
            dnsName,
            magicDnsDomain,
            peers,
            funnelEnabled: !!data.Funnel,
          });
        } catch {
          const fallbackIp = hostBuilder.getNetworkState().tailscaleIp;
          this.cachedIp = fallbackIp || null;
          this.isConnected = !!fallbackIp;
          resolve({
            connected: !!fallbackIp,
            ip: fallbackIp || null,
            binaryPath: bin,
          });
        }
      });
    });
  }

  public async getStatus(): Promise<TailscaleStatus> {
    const detailed = await this.getDetailedStatus();
    let authKeyMasked: string | undefined;
    try {
      const client = this.prismaManager.getClient();
      const cfg = await client.systemConfig.findUnique({ where: { key: 'tailscale_auth_key' } });
      if (cfg && cfg.value) {
        authKeyMasked = cfg.value;
      }
    } catch {}

    return {
      connected: detailed.connected,
      ip: detailed.ip,
      binaryPath: detailed.binaryPath,
      authKeyMasked,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Connects to Tailscale mesh.
   * Passes auth key via TS_AUTHKEY environment variable, avoiding argv exposure (Item 1.9 & 5.6).
   */
  public async connect(
    authKey: string,
    hostname?: string
  ): Promise<{ success: boolean; ip?: string; error?: string }> {
    const bin = this.resolveBinary();
    if (!fs.existsSync(bin)) {
      return { success: false, error: 'Tailscale binary not found on system.' };
    }

    logger.info('tailscale', 'Executing tailscale up with secure env-based Auth Key...');

    const args = ['up', '--authkey=env:TS_AUTHKEY'];
    if (hostname) {
      args.push(`--hostname=${hostname.trim()}`);
    }

    return new Promise((resolve) => {
      execFile(
        bin,
        args,
        {
          windowsHide: true,
          env: {
            ...process.env,
            TS_AUTHKEY: authKey.trim(),
          },
        },
        async (err, stdout, stderr) => {
          if (stdout) logger.info('tailscale', `[stdout] ${stdout.trim()}`);
          if (stderr) logger.warn('tailscale', `[stderr] ${stderr.trim()}`);

          if (err) {
            // Fallback for older Tailscale versions that do not support env:TS_AUTHKEY
            if (stderr && stderr.includes('authkey')) {
              logger.warn('tailscale', 'Retrying tailscale up with legacy auth argument...');
              execFile(bin, ['up', `--authkey=${authKey.trim()}`], { windowsHide: true }, async (retryErr) => {
                if (retryErr) {
                  return resolve({ success: false, error: retryErr.message });
                }
                const ip = await this.getMeshIp();
                this.isConnected = !!ip;
                this.cachedIp = ip;
                resolve({ success: true, ip: ip || undefined });
              });
              return;
            }
            logger.error('tailscale', `Failed to connect Tailscale: ${err.message}`);
            return resolve({ success: false, error: stderr || err.message });
          }

          const ip = await this.getMeshIp();
          this.isConnected = !!ip;
          this.cachedIp = ip;

          try {
            const client = this.prismaManager.getClient();
            const masked =
              authKey.length > 8
                ? `${authKey.substring(0, 6)}...${authKey.substring(authKey.length - 4)}`
                : 'configured';
            await client.systemConfig.upsert({
              where: { key: 'tailscale_auth_key' },
              create: { key: 'tailscale_auth_key', value: masked, category: 'network' },
              update: { value: masked },
            });
            if (ip) {
              await client.systemConfig.upsert({
                where: { key: 'tailscale_ip' },
                create: { key: 'tailscale_ip', value: ip, category: 'network' },
                update: { value: ip },
              });
            }
          } catch (dbErr: any) {
            logger.warn('tailscale', `Notice saving config to DB: ${dbErr.message}`);
          }

          logger.success('tailscale', `Connected to Tailscale mesh. Mesh IPv4: ${ip || 'Active'}`);
          firewallManager.addInboundRule({ ruleName: 'Ownbase-Tailscale-Inbound', port: 80, scope: 'Tailscale' }).catch(() => {});
          firewallManager.addInboundRule({ ruleName: 'Ownbase-Tailscale-Inbound-443', port: 443, scope: 'Tailscale' }).catch(() => {});
          resolve({ success: true, ip: ip || undefined });
        }
      );
    });
  }

  public async disconnect(): Promise<{ success: boolean; error?: string }> {
    const bin = this.resolveBinary();
    logger.info('tailscale', 'Disconnecting from Tailscale mesh network...');

    return new Promise((resolve) => {
      execFile(bin, ['down'], { windowsHide: true }, (err) => {
        if (err) {
          logger.warn('tailscale', `Disconnect error: ${err.message}`);
          return resolve({ success: false, error: err.message });
        }
        this.isConnected = false;
        this.cachedIp = null;
        logger.info('tailscale', 'Disconnected from Tailscale mesh network.');
        resolve({ success: true });
      });
    });
  }
}

export const tailscaleManager = new TailscaleManager(new PrismaManager());
