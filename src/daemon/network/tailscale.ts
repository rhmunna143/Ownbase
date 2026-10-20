import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import { PrismaManager } from '../db/prisma';
import { TailscaleStatus } from '../../shared/types';

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
    const bin = this.resolveBinary();
    if (!fs.existsSync(bin)) return null;

    return new Promise((resolve) => {
      execFile(bin, ['ip', '-4'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) {
          this.cachedIp = null;
          this.isConnected = false;
          return resolve(null);
        }

        const ip = stdout.trim().split(/\r?\n/)[0]?.trim();
        if (ip && ip.startsWith('100.')) {
          this.cachedIp = ip;
          this.isConnected = true;
          return resolve(ip);
        }
        resolve(null);
      });
    });
  }

  public async getStatus(): Promise<TailscaleStatus> {
    const bin = this.resolveBinary();
    const isInstalled = fs.existsSync(bin);

    if (!isInstalled) {
      return {
        connected: false,
        ip: null,
        binaryPath: bin,
      };
    }

    const ip = await this.getMeshIp();

    return {
      connected: !!ip,
      ip: ip || null,
      binaryPath: bin,
    };
  }

  /**
   * Connects to Tailscale mesh.
   * Passes auth key via TS_AUTHKEY environment variable, avoiding argv exposure (Item 1.9).
   */
  public async connect(authKey: string, hostname?: string): Promise<{ success: boolean; ip?: string; error?: string }> {
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
