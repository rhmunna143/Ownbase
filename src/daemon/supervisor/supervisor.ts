import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import { eventBus } from '../core/events';
import { PrismaManager } from '../db/prisma';
import { ProcessStatus, LogEntry, ServiceRecord } from '../../shared/types';
import { ServiceSpec, resolveServiceSpec } from './spec';
import { ServiceStateMachine, ServiceState } from './machine';
import { RestartController } from './restart';
import { ServiceHealthProber } from './health';
import { buildIsolatedEnvironment } from './env';
import { spawnInJob, ManagedJob } from './jobhost';
import { ServiceLogManager } from './logs';
import { ServiceMetricsCollector } from './metrics';
import { gracefulStopProcess } from './stop';
import { reconcileStaleProcesses } from './reconcile';

export interface ManagedProcess {
  serviceId: string;
  name: string;
  type: string;
  executable: string;
  resolvedPath: string;
  port: number | null;
  args: string[];
  job: ManagedJob | null;
  pid?: number;
  status: ServiceState;
  startTime?: Date;
  restartCount: number;
  recentLogs: LogEntry[];
  error?: string;
  spec: ServiceSpec;
  stateMachine: ServiceStateMachine;
  restartController: RestartController;
  healthProber?: ServiceHealthProber;
  logManager: ServiceLogManager;
  metricsCollector?: ServiceMetricsCollector;
}

export class ProcessSupervisor {
  private processes: Map<string, ManagedProcess> = new Map();
  private prismaManager: PrismaManager;
  private isShuttingDown: boolean = false;
  private metricsTimer: NodeJS.Timeout | null = null;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
    this.startPeriodicMetricsSampling();
  }

  public resolveExecutablePath(executable: string): string | null {
    const candidatePaths = [
      path.join(paths.extraResourcesDir, 'bin', executable),
      path.join(paths.extraResourcesDir, executable),
      path.join(paths.runtimesDir, 'bin', executable),
      path.join(paths.runtimesDir, executable),
      path.join(process.cwd(), 'extraResources', 'bin', executable),
      path.join(process.cwd(), 'extraResources', executable),
      path.join(process.cwd(), 'extraResources', 'pgsql', 'bin', executable),
      path.join(__dirname, '..', '..', '..', 'extraResources', 'bin', executable),
    ];

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    // Check system PATH
    try {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? 'where.exe' : 'which';
      const result = execSync(`${cmd} ${executable}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const firstLine = result.trim().split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    } catch {
      // Not on PATH
    }

    return null;
  }

  public registerService(service: ServiceRecord, customArgs?: string[]): ManagedProcess {
    let managed = this.processes.get(service.id);
    const spec = resolveServiceSpec(service, customArgs ? { args: customArgs } : undefined);
    const resolvedPath = this.resolveExecutablePath(spec.executable) || spec.executable;

    if (!managed) {
      const stateMachine = new ServiceStateMachine(service.id, service.name, 'stopped');
      const restartController = new RestartController({
        policy: spec.restartPolicy,
      });
      const logManager = new ServiceLogManager(service.id, service.name);

      managed = {
        serviceId: service.id,
        name: service.name,
        type: service.type,
        executable: spec.executable,
        resolvedPath,
        port: spec.port,
        args: spec.args,
        job: null,
        status: 'stopped',
        restartCount: 0,
        recentLogs: [],
        spec,
        stateMachine,
        restartController,
        logManager,
      };

      // Set up health prober if configured in spec
      if (spec.healthProbe) {
        managed.healthProber = new ServiceHealthProber(service.id, service.name, spec.healthProbe);
      }

      // Synchronize state machine events to managed process & DB
      stateMachine.on('transition', async (evt) => {
        if (managed) {
          managed.status = evt.to;
          await this.syncServiceStatusToDb(managed);
        }
      });

      this.processes.set(service.id, managed);
    } else {
      managed.spec = spec;
      managed.resolvedPath = resolvedPath;
      managed.port = spec.port;
      managed.args = spec.args;
      if (spec.healthProbe) {
        managed.healthProber = new ServiceHealthProber(service.id, service.name, spec.healthProbe);
      }
    }

    return managed;
  }

  public async startService(
    serviceId: string
  ): Promise<{ success: boolean; pid?: number; error?: string }> {
    const managed = this.processes.get(serviceId);
    if (!managed) {
      return { success: false, error: `Service ID ${serviceId} not registered in supervisor` };
    }

    if (managed.status === 'running' && managed.job && managed.job.pid) {
      return { success: true, pid: managed.pid };
    }

    managed.stateMachine.transition('starting', 'Explicit start request');
    logger.info('supervisor', `Starting native service "${managed.name}" (${managed.executable})...`);

    // Verify binary exists
    const execPath = this.resolveExecutablePath(managed.spec.executable);
    if (!execPath) {
      const err = `Executable "${managed.spec.executable}" not found in extraResources/bin or system PATH`;
      logger.error('supervisor', err);
      managed.stateMachine.transition('failed', err);
      return { success: false, error: err };
    }
    managed.resolvedPath = execPath;

    try {
      logger.info('supervisor', `Spawning in Job Object: "${execPath}" ${managed.args.join(' ')}`);

      // Build isolated environment
      const env = await buildIsolatedEnvironment({
        serviceEnv: managed.spec.env,
        allowlist: managed.spec.envAllowlist,
        encryptedEnvJson: (managed.spec as any).envVars,
      });

      // Spawn enclosed in native Win32 Job Object with resource limits
      const job = await spawnInJob({
        executable: execPath,
        args: managed.args,
        cwd: managed.spec.cwd || paths.rootDir,
        env,
        limits: managed.spec.limits,
        killOnClose: true,
      });

      managed.job = job;
      managed.pid = job.pid;
      managed.startTime = new Date();
      managed.error = undefined;
      managed.restartController.onStarted();
      managed.metricsCollector = new ServiceMetricsCollector(managed.serviceId, job);

      managed.stateMachine.transition('running', `Spawned with PID: ${job.pid}`);
      logger.success(
        'supervisor',
        `Service "${managed.name}" running in Job Object with PID: ${job.pid}`
      );

      // Start health probing if configured
      managed.healthProber?.start();

      // Handle stdout
      job.child.stdout?.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.handleProcessLog(managed, 'info', line);
        }
      });

      // Handle stderr
      job.child.stderr?.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.handleProcessLog(managed, 'warn', line);
        }
      });

      // Handle process exit
      job.child.on('exit', (code, signal) => {
        try {
          logger.warn(
            'supervisor',
            `Service "${managed.name}" (PID: ${managed.pid}) exited with code: ${code}, signal: ${signal}`
          );

          managed.healthProber?.stop();
          managed.job = null;
          managed.pid = undefined;

          if (this.isShuttingDown || managed.status === 'stopping') {
            managed.stateMachine.transition('stopped', 'Shutdown or stopped by request');
          } else {
            // Process exited unexpectedly or crashed
            const isClean = code === 0;
            if (isClean) {
              managed.stateMachine.transition('stopped', 'Process exited with code 0');
            } else {
              managed.stateMachine.transition('crashed', `Process exited with code ${code}`);
            }

            // Evaluate restart policy
            const decision = managed.restartController.shouldRestart(code);
            if (decision.circuitTripped) {
              managed.stateMachine.transition('failed', 'Crash loop circuit breaker tripped');
            } else if (decision.restart) {
              managed.stateMachine.transition(
                'backoff',
                `Scheduled restart in ${Math.round(decision.delayMs / 1000)}s`
              );
              setTimeout(() => {
                if (managed.status === 'backoff' && !this.isShuttingDown) {
                  managed.restartCount += 1;
                  this.startService(managed.serviceId).catch((e) => {
                    logger.warn('supervisor', `Restart attempt notice: ${e.message}`);
                  });
                }
              }, decision.delayMs);
            }
          }
        } catch (err: any) {
          logger.error('supervisor', `Error in process exit handler for "${managed.name}": ${err.message}`);
        }
      });

      // Handle process error
      job.child.on('error', (err) => {
        logger.error('supervisor', `Failed to execute "${managed.name}": ${err.message}`);
        managed.healthProber?.stop();
        managed.job = null;
        managed.pid = undefined;
        managed.stateMachine.transition('failed', err.message);
      });

      await this.syncServiceStatusToDb(managed);
      return { success: true, pid: job.pid };
    } catch (err: any) {
      logger.error('supervisor', `Exception starting service "${managed.name}": ${err.message}`);
      managed.stateMachine.transition('failed', err.message);
      return { success: false, error: err.message };
    }
  }

  public async stopService(serviceId: string): Promise<{ success: boolean; error?: string }> {
    const managed = this.processes.get(serviceId);
    if (!managed || (!managed.job && !managed.pid)) {
      if (managed) {
        managed.stateMachine.transition('stopped', 'Stop called on idle service');
        await this.syncServiceStatusToDb(managed);
      }
      return { success: true };
    }

    managed.healthProber?.stop();
    managed.stateMachine.transition('stopping', 'Stop requested');

    try {
      await gracefulStopProcess({
        job: managed.job,
        pid: managed.pid,
        timeoutMs: managed.spec.stopBehavior?.timeoutMs ?? 3000,
        serviceName: managed.name,
      });

      managed.job = null;
      managed.pid = undefined;
      managed.stateMachine.transition('stopped', 'Stopped cleanly');
      await this.syncServiceStatusToDb(managed);
      return { success: true };
    } catch (err: any) {
      logger.error('supervisor', `Error stopping "${managed.name}": ${err.message}`);
      managed.stateMachine.transition('failed', err.message);
      return { success: false, error: err.message };
    }
  }

  public async restartService(
    serviceId: string
  ): Promise<{ success: boolean; pid?: number; error?: string }> {
    const managed = this.processes.get(serviceId);
    if (managed) {
      managed.restartCount += 1;
      managed.restartController.reset();
    }
    await this.stopService(serviceId);
    await new Promise((r) => setTimeout(r, 600));
    return await this.startService(serviceId);
  }

  public async stopAll(): Promise<void> {
    this.isShuttingDown = true;
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    logger.info('supervisor', 'Gracefully shutting down all supervised native processes...');
    const activeList = Array.from(this.processes.values()).filter((p) => p.job || p.pid);

    const stopPromises = activeList.map((managed) => {
      managed.healthProber?.stop();
      return gracefulStopProcess({
        job: managed.job,
        pid: managed.pid,
        timeoutMs: 2000,
        serviceName: managed.name,
      }).then(() => {
        managed.job = null;
        managed.pid = undefined;
        managed.stateMachine.reset('stopped');
      });
    });

    await Promise.all(stopPromises);
    logger.success('supervisor', 'All supervised processes stopped cleanly.');
  }

  private handleProcessLog(
    managed: ManagedProcess,
    level: 'info' | 'warn' | 'error',
    message: string
  ) {
    const entry = managed.logManager.appendLog(level, message);
    managed.recentLogs = managed.logManager.getRecentLogs();

    if (level === 'error') {
      logger.error(managed.type as any, message);
    } else if (level === 'warn') {
      logger.warn(managed.type as any, message);
    } else {
      logger.info(managed.type as any, message);
    }
  }

  private async syncServiceStatusToDb(managed: ManagedProcess) {
    try {
      const client = this.prismaManager.getClient();
      await client.service.update({
        where: { id: managed.serviceId },
        data: {
          status: managed.status,
          pid: managed.pid || null,
        },
      });
    } catch (err: any) {
      logger.warn('supervisor', `Failed to sync status for ${managed.name} to DB: ${err.message}`);
    }
  }

  public getStatus(serviceId: string): ProcessStatus | null {
    const p = this.processes.get(serviceId);
    if (!p) return null;
    return {
      serviceId: p.serviceId,
      name: p.name,
      type: p.type,
      status: p.status as any,
      pid: p.pid,
      startTime: p.startTime?.toISOString(),
      restartCount: p.restartCount,
      error: p.error,
    };
  }

  public getAllStatuses(): Record<string, ProcessStatus> {
    const result: Record<string, ProcessStatus> = {};
    this.processes.forEach((p, id) => {
      result[id] = {
        serviceId: p.serviceId,
        name: p.name,
        type: p.type,
        status: p.status as any,
        pid: p.pid,
        startTime: p.startTime?.toISOString(),
        restartCount: p.restartCount,
        error: p.error,
      };
    });
    return result;
  }

  public getServiceLogs(serviceId: string): LogEntry[] {
    const p = this.processes.get(serviceId);
    return p ? p.logManager.getRecentLogs() : [];
  }

  public async syncAndAutoStart(): Promise<void> {
    logger.info('supervisor', 'Initializing Process Supervisor from database manifests...');

    // P17 Boot Reconcile: Clean up any stale PIDs from past hard crashes
    await reconcileStaleProcesses(this.prismaManager);

    const services = await this.prismaManager.getServices();
    for (const service of services) {
      this.registerService(service);
      if (service.autoStart) {
        logger.info('supervisor', `Auto-starting configured service: ${service.name}`);
        this.startService(service.id).catch((err) => {
          logger.warn('supervisor', `Auto-start notice for ${service.name}: ${err.message}`);
        });
      }
    }
  }

  public setWindow(_win: any) {
    // Deprecated Electron main window reference (kept for no-op backwards compatibility)
  }

  private startPeriodicMetricsSampling(): void {
    // Periodically sample Job Object CPU/memory accounting every 5 seconds
    this.metricsTimer = setInterval(() => {
      for (const managed of this.processes.values()) {
        if (managed.status === 'running' && managed.metricsCollector) {
          managed.metricsCollector.sample();
        }
      }
    }, 5000);
  }
}
