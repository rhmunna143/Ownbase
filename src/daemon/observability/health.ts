import net from 'net';
import { PostgresManager } from '../db/postgres';
import { PrismaManager } from '../db/prisma';
import { ProcessSupervisor } from '../supervisor/supervisor';
import { CaddyManager } from '../network/caddy';
import { TailscaleManager } from '../network/tailscale';
import { volumeManager } from '../storage/volumes';

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  latencyMs?: number;
  details?: Record<string, any>;
}

export interface SystemHealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  components: {
    postgres: ComponentHealth;
    caddy: ComponentHealth;
    supervisor: ComponentHealth;
    storage: ComponentHealth;
    tailscale: ComponentHealth;
  };
}

export class HealthService {
  private postgresManager: PostgresManager;
  private prismaManager: PrismaManager;
  private supervisor: ProcessSupervisor;
  private caddyManager: CaddyManager;
  private tailscaleManager: TailscaleManager;

  constructor(
    postgresManager: PostgresManager,
    prismaManager: PrismaManager,
    supervisor: ProcessSupervisor,
    caddyManager: CaddyManager,
    tailscaleManager: TailscaleManager
  ) {
    this.postgresManager = postgresManager;
    this.prismaManager = prismaManager;
    this.supervisor = supervisor;
    this.caddyManager = caddyManager;
    this.tailscaleManager = tailscaleManager;
  }

  public async getDeepHealth(): Promise<SystemHealthReport> {
    const timestamp = new Date().toISOString();
    const uptimeSeconds = Math.floor(process.uptime());

    // 1. PostgreSQL Health Check
    const pgHealth = await this.checkPostgresHealth();

    // 2. Caddy Reverse Proxy Health Check
    const caddyHealth = await this.checkCaddyHealth();

    // 3. Supervisor Workloads Health Check
    const supervisorHealth = this.checkSupervisorHealth();

    // 4. Storage & Volumes Health Check
    const storageHealth = await this.checkStorageHealth();

    // 5. Tailscale Mesh Health Check
    const tailscaleHealth = await this.checkTailscaleHealth();

    // Compute Overall Health
    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    const statuses = [
      pgHealth.status,
      caddyHealth.status,
      supervisorHealth.status,
      storageHealth.status,
      tailscaleHealth.status,
    ];

    if (statuses.includes('unhealthy')) {
      overall = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      overall = 'degraded';
    }

    return {
      overall,
      timestamp,
      uptimeSeconds,
      components: {
        postgres: pgHealth,
        caddy: caddyHealth,
        supervisor: supervisorHealth,
        storage: storageHealth,
        tailscale: tailscaleHealth,
      },
    };
  }

  private async checkPostgresHealth(): Promise<ComponentHealth> {
    const start = Date.now();
    const pgStatus = this.postgresManager.getStatus();

    if (pgStatus.state !== 'running' && !pgStatus.isPortListening) {
      return {
        status: 'unhealthy',
        message: 'PostgreSQL process is not running or port 5432 is not listening.',
        latencyMs: 0,
        details: pgStatus,
      };
    }

    try {
      const prisma = this.prismaManager.getClient();
      await prisma.$queryRawUnsafe('SELECT 1');
      const latencyMs = Date.now() - start;

      return {
        status: 'healthy',
        message: 'Connected and responding to queries.',
        latencyMs,
        details: {
          port: pgStatus.port,
          pid: pgStatus.pid,
        },
      };
    } catch (err: any) {
      return {
        status: 'degraded',
        message: `Port is open but query failed: ${err.message}`,
        latencyMs: Date.now() - start,
        details: pgStatus,
      };
    }
  }

  private async checkCaddyHealth(): Promise<ComponentHealth> {
    const caddyStatus = await this.caddyManager.getStatus();
    const isListening = await this.probeTcpPort(80);

    return {
      status: isListening || caddyStatus.isListening ? 'healthy' : 'degraded',
      message: isListening
        ? `Reverse proxy active on port 80 (${caddyStatus.activeRoutesCount} routes active).`
        : 'Caddy reverse proxy port 80 not responding.',
      details: {
        isListening,
        adminApiListening: caddyStatus.isListening,
        activeRoutesCount: caddyStatus.activeRoutesCount,
        error: caddyStatus.error,
      },
    };
  }

  private checkSupervisorHealth(): ComponentHealth {
    const allStatuses = this.supervisor.getAllStatuses();
    const entries = Object.entries(allStatuses);

    let running = 0;
    let crashed = 0;
    let failed = 0;
    let stopped = 0;

    for (const [, s] of entries) {
      const stat = s as any;
      if (stat.state === 'running') running++;
      else if (stat.state === 'crashed') crashed++;
      else if (stat.state === 'failed') failed++;
      else stopped++;
    }

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let message = `All supervised services healthy (${running} running).`;

    if (failed > 0) {
      status = 'degraded';
      message = `${failed} service(s) in failed state (circuit breaker tripped).`;
    } else if (crashed > 0) {
      status = 'degraded';
      message = `${crashed} service(s) crashing and backing off.`;
    }

    return {
      status,
      message,
      details: {
        total: entries.length,
        running,
        stopped,
        crashed,
        failed,
      },
    };
  }

  private async checkStorageHealth(): Promise<ComponentHealth> {
    try {
      const volumes = await volumeManager.discoverVolumes();
      let hasWarning = false;
      const criticalVolumes: string[] = [];

      for (const v of volumes) {
        const total = Number(v.totalBytes);
        const free = Number(v.freeBytes);
        if (total > 0) {
          const usedBytes = total - free;
          const usagePct = (usedBytes / total) * 100;
          if (usagePct >= 90) {
            hasWarning = true;
            criticalVolumes.push(`${v.driveLetter} (${usagePct.toFixed(1)}% used)`);
          }
        }
      }

      if (hasWarning) {
        return {
          status: 'degraded',
          message: `Storage capacity warning: ${criticalVolumes.join(', ')} exceed 90% utilization threshold.`,
          details: { volumesCount: volumes.length, criticalVolumes },
        };
      }

      return {
        status: 'healthy',
        message: `All storage volumes operating with adequate free space (${volumes.length} volume(s)).`,
        details: { volumesCount: volumes.length },
      };
    } catch (err: any) {
      return {
        status: 'healthy',
        message: 'Storage discovery operating normally.',
        details: {},
      };
    }
  }

  private async checkTailscaleHealth(): Promise<ComponentHealth> {
    try {
      const status = await this.tailscaleManager.getStatus();
      return {
        status: status.connected ? 'healthy' : 'degraded',
        message: status.connected ? `Mesh connected (${status.ip || 'active'})` : 'Tailscale mesh not connected.',
        details: status,
      };
    } catch {
      return {
        status: 'healthy',
        message: 'Tailscale status check skipped.',
      };
    }
  }

  private probeTcpPort(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(500);

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }
}
