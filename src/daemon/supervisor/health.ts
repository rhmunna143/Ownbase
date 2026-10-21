import http from 'http';
import net from 'net';
import { EventEmitter } from 'events';
import { HealthProbeSpec } from './spec';
import { logger } from '../core/logger';

export type HealthStatus = 'probing' | 'healthy' | 'unhealthy' | 'stopped';

export interface HealthCheckResult {
  status: HealthStatus;
  consecutiveFailures: number;
  lastChecked?: string;
  latencyMs?: number;
  error?: string;
}

export class ServiceHealthProber extends EventEmitter {
  private serviceId: string;
  private serviceName: string;
  private spec: HealthProbeSpec;
  private currentStatus: HealthStatus = 'stopped';
  private consecutiveFailures: number = 0;
  private intervalTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(serviceId: string, serviceName: string, spec: HealthProbeSpec) {
    super();
    this.serviceId = serviceId;
    this.serviceName = serviceName;
    this.spec = {
      type: spec.type || 'tcp',
      port: spec.port,
      path: spec.path || '/',
      intervalMs: spec.intervalMs ?? 15000,
      timeoutMs: spec.timeoutMs ?? 3000,
      startPeriodMs: spec.startPeriodMs ?? 3000,
      failureThreshold: spec.failureThreshold ?? 3,
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentStatus = 'probing';
    this.consecutiveFailures = 0;

    // Wait startPeriodMs before first health check probe
    this.startTimer = setTimeout(() => {
      this.probe();
      this.intervalTimer = setInterval(() => {
        this.probe();
      }, this.spec.intervalMs);
    }, this.spec.startPeriodMs);
  }

  public stop(): void {
    this.isRunning = false;
    this.currentStatus = 'stopped';
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  public async probe(): Promise<HealthCheckResult> {
    if (!this.isRunning) {
      return { status: 'stopped', consecutiveFailures: 0 };
    }

    const startTime = Date.now();
    try {
      if (this.spec.type === 'http') {
        await this.probeHttp();
      } else {
        await this.probeTcp();
      }

      const latencyMs = Date.now() - startTime;
      this.consecutiveFailures = 0;

      const previousStatus = this.currentStatus;
      this.currentStatus = 'healthy';

      if (previousStatus !== 'healthy') {
        logger.success('supervisor', `Health check passed for "${this.serviceName}" (${latencyMs}ms).`);
        this.emit('status-change', {
          serviceId: this.serviceId,
          status: 'healthy',
          latencyMs,
        });
      }

      return {
        status: 'healthy',
        consecutiveFailures: 0,
        lastChecked: new Date().toISOString(),
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      this.consecutiveFailures += 1;

      const threshold = this.spec.failureThreshold || 3;
      const previousStatus = this.currentStatus;

      if (this.consecutiveFailures >= threshold) {
        this.currentStatus = 'unhealthy';
      }

      if (previousStatus !== this.currentStatus) {
        logger.warn(
          'supervisor',
          `Health probe failed for "${this.serviceName}" (${this.consecutiveFailures}/${threshold}): ${err.message}`
        );
        this.emit('status-change', {
          serviceId: this.serviceId,
          status: this.currentStatus,
          error: err.message,
          latencyMs,
        });
      }

      return {
        status: this.currentStatus,
        consecutiveFailures: this.consecutiveFailures,
        lastChecked: new Date().toISOString(),
        latencyMs,
        error: err.message,
      };
    }
  }

  private probeTcp(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.spec.port;
      if (!port) return reject(new Error('No port configured for TCP health probe'));

      const socket = new net.Socket();
      socket.setTimeout(this.spec.timeoutMs || 3000);

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`TCP probe timed out after ${this.spec.timeoutMs}ms`));
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      socket.connect(port, '127.0.0.1');
    });
  }

  private probeHttp(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.spec.port;
      if (!port) return reject(new Error('No port configured for HTTP health probe'));

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: this.spec.path || '/',
          method: 'GET',
          timeout: this.spec.timeoutMs || 3000,
        },
        (res) => {
          res.resume(); // consume response data to free up memory
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            reject(new Error(`HTTP probe returned status code ${res.statusCode}`));
          }
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`HTTP probe timed out after ${this.spec.timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    });
  }

  public getStatus(): HealthStatus {
    return this.currentStatus;
  }
}
