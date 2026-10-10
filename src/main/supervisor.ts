import { spawn, execFile, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { BrowserWindow, app } from 'electron';
import { logger } from './logger';
import { PrismaManager } from './prisma';
import { ProcessStatus, LogEntry, ServiceRecord } from '../shared/types';

interface ManagedProcess {
  serviceId: string;
  name: string;
  type: string;
  executable: string;
  resolvedPath: string;
  port: number | null;
  args: string[];
  child: ChildProcess | null;
  pid?: number;
  status: ProcessStatus['status'];
  startTime?: Date;
  restartCount: number;
  recentLogs: LogEntry[];
  error?: string;
}

export class ProcessSupervisor {
  private processes: Map<string, ManagedProcess> = new Map();
  private prismaManager: PrismaManager;
  private mainWindow: BrowserWindow | null = null;
  private isShuttingDown: boolean = false;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
  }

  public setWindow(window: BrowserWindow | null) {
    this.mainWindow = window;
  }

  public resolveExecutablePath(executable: string): string | null {
    const resourcesPath = (process as any).resourcesPath || process.cwd();
    
    // Candidate search directories in priority order
    const candidatePaths = [
      path.join(resourcesPath, 'extraResources', 'bin', executable),
      path.join(resourcesPath, 'extraResources', executable),
      path.join(process.cwd(), 'extraResources', 'bin', executable),
      path.join(process.cwd(), 'extraResources', executable),
      path.join(process.cwd(), 'extraResources', 'pgsql', 'bin', executable),
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
      const result = require('child_process').execSync(`${cmd} ${executable}`, {
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
    const resolvedPath = this.resolveExecutablePath(service.executable) || service.executable;

    // Build standard arguments based on binary type if not customized
    let args: string[] = customArgs || [];
    if (args.length === 0) {
      if (service.type === 'caddy') {
        args = ['run'];
      } else if (service.type === 'filebrowser') {
        const appData = (app && typeof app.getPath === 'function')
          ? app.getPath('userData')
          : path.join(process.env.APPDATA || '.', 'NativeWindowsServerHub');
        const storageDir = path.join(appData, 'storage');
        const dbPath = path.join(appData, 'filebrowser.db');
        if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
        args = ['-p', (service.port || 8080).toString(), '-a', '127.0.0.1', '-r', storageDir, '-d', dbPath];
      } else if (service.type === 'ollama') {
        args = ['serve'];
      }
    }

    if (!managed) {
      managed = {
        serviceId: service.id,
        name: service.name,
        type: service.type,
        executable: service.executable,
        resolvedPath,
        port: service.port,
        args,
        child: null,
        status: 'stopped',
        restartCount: 0,
        recentLogs: [],
      };
      this.processes.set(service.id, managed);
    } else {
      managed.resolvedPath = resolvedPath;
      managed.port = service.port;
      managed.args = args;
    }

    return managed;
  }

  public async startService(serviceId: string): Promise<{ success: boolean; pid?: number; error?: string }> {
    const managed = this.processes.get(serviceId);
    if (!managed) {
      return { success: false, error: `Service ID ${serviceId} not registered in supervisor` };
    }

    if (managed.status === 'running' && managed.child) {
      return { success: true, pid: managed.pid };
    }

    this.updateStatus(managed, 'starting');
    logger.info('supervisor', `Starting native service "${managed.name}" (${managed.executable})...`);

    // Verify binary exists
    let execPath = this.resolveExecutablePath(managed.executable);
    if (!execPath) {
      const err = `Executable "${managed.executable}" not found in extraResources/bin or system PATH`;
      logger.error('supervisor', err);
      this.updateStatus(managed, 'error', err);
      return { success: false, error: err };
    }
    managed.resolvedPath = execPath;

    try {
      logger.info('supervisor', `Spawning: "${execPath}" ${managed.args.join(' ')}`);

      const child = spawn(execPath, managed.args, {
        windowsHide: true,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OLLAMA_HOST: '127.0.0.1:11434',
        },
      });

      managed.child = child;
      managed.pid = child.pid;
      managed.startTime = new Date();
      managed.error = undefined;

      this.updateStatus(managed, 'running');
      logger.success('supervisor', `Service "${managed.name}" started successfully with PID: ${child.pid}`);

      // Handle standard output stream
      child.stdout?.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.handleProcessLog(managed, 'info', line);
        }
      });

      // Handle standard error stream
      child.stderr?.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.handleProcessLog(managed, 'warn', line);
        }
      });

      // Handle process exit
      child.on('exit', (code, signal) => {
        logger.warn('supervisor', `Service "${managed.name}" (PID: ${managed.pid}) exited with code: ${code}, signal: ${signal}`);
        managed.child = null;
        managed.pid = undefined;

        if (this.isShuttingDown || managed.status === 'stopping') {
          this.updateStatus(managed, 'stopped');
        } else {
          // If unexpected termination while running
          this.updateStatus(managed, code === 0 ? 'stopped' : 'crashed', `Process exited with code ${code}`);
        }
      });

      // Handle process error
      child.on('error', (err) => {
        logger.error('supervisor', `Failed to run "${managed.name}": ${err.message}`);
        managed.child = null;
        managed.pid = undefined;
        this.updateStatus(managed, 'error', err.message);
      });

      // Update Prisma database record
      await this.syncServiceStatusToDb(managed);

      return { success: true, pid: child.pid };
    } catch (err: any) {
      logger.error('supervisor', `Exception starting service "${managed.name}": ${err.message}`);
      this.updateStatus(managed, 'error', err.message);
      return { success: false, error: err.message };
    }
  }

  public async stopService(serviceId: string): Promise<{ success: boolean; error?: string }> {
    const managed = this.processes.get(serviceId);
    if (!managed || !managed.child || !managed.pid) {
      if (managed) {
        this.updateStatus(managed, 'stopped');
        await this.syncServiceStatusToDb(managed);
      }
      return { success: true };
    }

    const pid = managed.pid;
    this.updateStatus(managed, 'stopping');
    logger.info('supervisor', `Terminating process tree for "${managed.name}" (PID: ${pid})...`);

    try {
      // Use Windows-native taskkill /pid <PID> /T /F to kill entire tree
      await this.killProcessTree(pid);
      managed.child = null;
      managed.pid = undefined;
      this.updateStatus(managed, 'stopped');
      await this.syncServiceStatusToDb(managed);
      logger.success('supervisor', `Service "${managed.name}" terminated cleanly.`);
      return { success: true };
    } catch (err: any) {
      logger.error('supervisor', `Error killing process tree for "${managed.name}": ${err.message}`);
      this.updateStatus(managed, 'error', err.message);
      return { success: false, error: err.message };
    }
  }

  public async restartService(serviceId: string): Promise<{ success: boolean; pid?: number; error?: string }> {
    const managed = this.processes.get(serviceId);
    if (managed) {
      managed.restartCount += 1;
    }
    await this.stopService(serviceId);
    // Short breather to allow socket release
    await new Promise((r) => setTimeout(r, 600));
    return await this.startService(serviceId);
  }

  public killProcessTree(pid: number): Promise<void> {
    return new Promise((resolve) => {
      if (!pid || pid <= 0) return resolve();
      
      const isWindows = process.platform === 'win32';
      if (isWindows) {
        // Windows-native taskkill: /T kills entire child tree, /F forces termination
        execFile('taskkill', ['/pid', pid.toString(), '/T', '/F'], { windowsHide: true }, (err, stdout, stderr) => {
          if (stdout) logger.info('supervisor', `[taskkill stdout] ${stdout.trim()}`);
          if (err && !err.message.includes('not found')) {
            logger.warn('supervisor', `taskkill notice for PID ${pid}: ${err.message}`);
          }
          resolve();
        });
      } else {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
        resolve();
      }
    });
  }

  public async stopAll(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('supervisor', 'Shutting down all supervised native processes...');

    const activeList = Array.from(this.processes.values()).filter((p) => p.child && p.pid);
    const stopPromises = activeList.map((managed) => {
      if (managed.pid) {
        return this.killProcessTree(managed.pid).then(() => {
          managed.child = null;
          managed.pid = undefined;
          managed.status = 'stopped';
        });
      }
      return Promise.resolve();
    });

    await Promise.all(stopPromises);
    logger.success('supervisor', 'All supervised processes forcefully and cleanly terminated.');
  }

  private handleProcessLog(managed: ManagedProcess, level: 'info' | 'warn' | 'error', message: string) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      level,
      source: managed.type,
      message,
      timestamp: new Date().toISOString(),
      serviceId: managed.serviceId,
    };

    managed.recentLogs.push(entry);
    if (managed.recentLogs.length > 250) {
      managed.recentLogs.shift();
    }

    // Stream to main logger
    if (level === 'error') {
      logger.error(managed.type as any, message);
    } else if (level === 'warn') {
      logger.warn(managed.type as any, message);
    } else {
      logger.info(managed.type as any, message);
    }

    // Stream via IPC to frontend
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('service-log', {
        serviceId: managed.serviceId,
        log: entry,
      });
    }
  }

  private updateStatus(managed: ManagedProcess, status: ProcessStatus['status'], error?: string) {
    managed.status = status;
    if (error !== undefined) {
      managed.error = error;
    }

    const payload: ProcessStatus = {
      serviceId: managed.serviceId,
      name: managed.name,
      type: managed.type,
      status: managed.status,
      pid: managed.pid,
      startTime: managed.startTime?.toISOString(),
      restartCount: managed.restartCount,
      error: managed.error,
    };

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('process-status-changed', payload);
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
      status: p.status,
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
        status: p.status,
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
    return p ? [...p.recentLogs] : [];
  }

  public async syncAndAutoStart(): Promise<void> {
    logger.info('supervisor', 'Initializing Process Supervisor from database manifests...');
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
}
