import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';
import { PrismaManager } from './prisma';
import { TailscaleStatus } from '../shared/types';

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
    const resourcesPath = (process as any).resourcesPath || process.cwd();
    const candidates = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
      path.join(resourcesPath, 'extraResources', 'bin', 'tailscale.exe'),
      path.join(process.cwd(), 'extraResources', 'bin', 'tailscale.exe'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        this.binaryPath = cand;
        return cand;
      }
    }

    // Check system PATH
    try {
      const stdout = require('child_process').execSync('where.exe tailscale', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const firstLine = stdout.trim().split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        this.binaryPath = firstLine;
        return firstLine;
      }
    } catch {
      // not on PATH
    }

    this.binaryPath = path.join(process.cwd(), 'extraResources', 'bin', 'tailscale.exe');
    return this.binaryPath;
  }

  public async getMeshIp(): Promise<string | null> {
    const bin = this.resolveBinary();
    if (!fs.existsSync(bin)) return null;

    return new Promise((resolve) => {
      execFile(bin, ['ip', '-4'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) {
          this.cachedIp = null;
          this.isConnected = false;
          return resolve(null);
        }
        const ip = stdout.trim();
        if (ip && ip.startsWith('100.')) {
          this.cachedIp = ip;
          this.isConnected = true;
          return resolve(ip);
        }
        this.cachedIp = null;
        this.isConnected = false;
        resolve(null);
      });
    });
  }

  public async connect(authKey: string, hostname = 'native-windows-server'): Promise<{ success: boolean; ip?: string; error?: string }> {
    const bin = this.resolveBinary();
    if (!fs.existsSync(bin)) {
      return { success: false, error: `Tailscale binary not found at ${bin}` };
    }

    logger.info('tailscale', `Executing tailscale up with provided Auth Key...`);

    const args = ['up', `--authkey=${authKey.trim()}`];
    if (hostname) {
      args.push(`--hostname=${hostname.trim()}`);
    }

    return new Promise((resolve) => {
      execFile(bin, args, { windowsHide: true }, async (err, stdout, stderr) => {
        if (stdout) logger.info('tailscale', `[stdout] ${stdout.trim()}`);
        if (stderr) logger.warn('tailscale', `[stderr] ${stderr.trim()}`);

        if (err) {
          logger.error('tailscale', `Failed to connect Tailscale: ${err.message}`);
          return resolve({ success: false, error: stderr || err.message });
        }

        const ip = await this.getMeshIp();
        this.isConnected = !!ip;
        this.cachedIp = ip;

        // Persist to database system config
        try {
          const client = this.prismaManager.getClient();
          const masked = authKey.length > 8 ? `${authKey.substring(0, 6)}...${authKey.substring(authKey.length - 4)}` : 'configured';
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
        resolve({ success: true, ip: ip || undefined });
      });
    });
  }

  public async disconnect(): Promise<{ success: boolean; error?: string }> {
    const bin = this.resolveBinary();
    logger.info('tailscale', 'Disconnecting from Tailscale mesh network...');

    return new Promise((resolve) => {
      execFile(bin, ['down'], { windowsHide: true }, async (err, stdout) => {
        if (stdout) logger.info('tailscale', stdout.trim());
        this.isConnected = false;
        this.cachedIp = null;

        try {
          const client = this.prismaManager.getClient();
          await client.systemConfig.upsert({
            where: { key: 'tailscale_ip' },
            create: { key: 'tailscale_ip', value: '', category: 'network' },
            update: { value: '' },
          });
        } catch {}

        logger.info('tailscale', 'Tailscale disconnected.');
        resolve({ success: true });
      });
    });
  }

  public async getStatus(): Promise<TailscaleStatus> {
    const bin = this.resolveBinary();
    const ip = await this.getMeshIp();

    let authKeyMasked: string | undefined;
    try {
      const client = this.prismaManager.getClient();
      const cfg = await client.systemConfig.findUnique({ where: { key: 'tailscale_auth_key' } });
      if (cfg && cfg.value) {
        authKeyMasked = cfg.value;
      }
    } catch {}

    return {
      connected: !!ip,
      ip: ip || null,
      binaryPath: bin,
      authKeyMasked,
      lastChecked: new Date().toISOString(),
    };
  }
}
