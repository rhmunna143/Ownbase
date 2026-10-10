import { spawn, execFile, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { app } from 'electron';
import { logger } from './logger';
import { PostgresStatus } from '../shared/types';

export class PostgresManager {
  private childProcess: ChildProcess | null = null;
  private port: number = 5432;
  private binDir: string = '';
  private dataDir: string = '';
  private status: PostgresStatus;
  private onStatusChangeCallback?: (status: PostgresStatus) => void;

  constructor(customPort = 5432) {
    this.port = customPort;
    this.resolvePaths();
    this.status = {
      state: 'uninitialized',
      port: this.port,
      dataDir: this.dataDir,
      binDir: this.binDir,
      isPortListening: false,
      canConnect: false,
    };
  }

  public setStatusCallback(callback: (status: PostgresStatus) => void) {
    this.onStatusChangeCallback = callback;
  }

  private updateStatus(partial: Partial<PostgresStatus>) {
    this.status = { ...this.status, ...partial };
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(this.status);
    }
  }

  public getStatus(): PostgresStatus {
    return { ...this.status };
  }

  private resolvePaths() {
    // Determine data directory inside AppData / userData
    let appData: string;
    try {
      appData = (app && typeof app.getPath === 'function')
        ? app.getPath('userData')
        : path.join(process.env.APPDATA || process.env.USERPROFILE || '.', 'NativeWindowsServerHub');
    } catch {
      appData = path.join(process.env.APPDATA || process.env.USERPROFILE || '.', 'NativeWindowsServerHub');
    }
    this.dataDir = path.join(appData, 'postgres');

    // Locate pgsql binaries: in packaged app vs dev environment
    const resourcesPath = (process as any).resourcesPath || process.cwd();
    const candidateDirs = [
      path.join(resourcesPath, 'extraResources', 'pgsql', 'bin'),
      path.join(resourcesPath, 'pgsql', 'bin'),
      path.join(resourcesPath, 'postgres', 'bin'),
      path.join(process.cwd(), 'extraResources', 'pgsql', 'bin'),
      path.join(process.cwd(), 'extraResources', 'postgres', 'bin'),
      path.join(__dirname, '..', '..', '..', 'extraResources', 'pgsql', 'bin'),
      path.join(__dirname, '..', '..', 'extraResources', 'pgsql', 'bin'),
    ];

    for (const cand of candidateDirs) {
      if (fs.existsSync(path.join(cand, 'postgres.exe')) && fs.existsSync(path.join(cand, 'initdb.exe'))) {
        this.binDir = cand;
        break;
      }
    }

    if (!this.binDir) {
      // Fallback default
      this.binDir = path.join(process.cwd(), 'extraResources', 'pgsql', 'bin');
    }

    logger.info('postgres', `Resolved PostgreSQL binaries directory: ${this.binDir}`);
    logger.info('postgres', `Resolved PostgreSQL data directory: ${this.dataDir}`);
  }

  public async bootstrap(): Promise<boolean> {
    try {
      this.resolvePaths();

      const postgresExe = path.join(this.binDir, 'postgres.exe');
      const initdbExe = path.join(this.binDir, 'initdb.exe');

      if (!fs.existsSync(postgresExe) || !fs.existsSync(initdbExe)) {
        const errorMsg = `PostgreSQL binaries not found in ${this.binDir}`;
        logger.error('postgres', errorMsg);
        this.updateStatus({ state: 'error', error: errorMsg });
        throw new Error(errorMsg);
      }

      // Check if port 5432 is already listening (e.g. from previous run)
      const alreadyListening = await this.probePort(this.port, 1000);
      if (alreadyListening) {
        logger.warn('postgres', `Port ${this.port} is already listening. Checking connection...`);
        this.updateStatus({
          state: 'running',
          isPortListening: true,
          canConnect: true,
        });
        return true;
      }

      // Check if data directory is initialized (check for PG_VERSION)
      const pgVersionFile = path.join(this.dataDir, 'PG_VERSION');
      if (!fs.existsSync(this.dataDir) || !fs.existsSync(pgVersionFile)) {
        logger.info('postgres', `Database data directory missing or uninitialized. Initializing at ${this.dataDir}...`);
        this.updateStatus({ state: 'initializing' });
        await this.runInitDb();
        logger.success('postgres', 'PostgreSQL database cluster initialized successfully.');
      } else {
        logger.info('postgres', `Existing PostgreSQL data directory detected at ${this.dataDir}`);
      }

      // Check for stale postmaster.pid from abnormal termination
      const pidFile = path.join(this.dataDir, 'postmaster.pid');
      if (fs.existsSync(pidFile)) {
        logger.warn('postgres', 'Detected leftover postmaster.pid while port is not listening. Removing stale lock file...');
        try {
          fs.unlinkSync(pidFile);
        } catch (e: any) {
          logger.warn('postgres', `Could not delete stale postmaster.pid: ${e.message}`);
        }
      }

      // Start postgres.exe
      this.updateStatus({ state: 'starting' });
      await this.startEngine();

      // Wait for port to be listening
      logger.info('postgres', `Awaiting database TCP readiness on port ${this.port}...`);
      const isListening = await this.waitForPort(this.port, 30000);
      if (!isListening) {
        throw new Error(`Timeout waiting for PostgreSQL to listen on port ${this.port}`);
      }

      this.updateStatus({
        state: 'running',
        isPortListening: true,
        canConnect: true,
      });

      logger.success('postgres', `PostgreSQL engine is running and accepting connections on port ${this.port}`);
      return true;
    } catch (err: any) {
      logger.error('postgres', `Bootstrap failed: ${err.message}`);
      this.updateStatus({ state: 'error', error: err.message });
      throw err;
    }
  }

  private runInitDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const initdbExe = path.join(this.binDir, 'initdb.exe');

      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      // Command according to PRD: initdb.exe -D <AppData>/postgres -U postgres
      // Added: -A trust (trust local connections without interactive password setup) and UTF8 encoding
      const args = [
        '-D', this.dataDir,
        '-U', 'postgres',
        '-A', 'trust',
        '-E', 'UTF8',
        '--locale=C',
      ];

      logger.info('postgres', `Executing: "${initdbExe}" ${args.join(' ')}`);

      execFile(initdbExe, args, { windowsHide: true }, (error, stdout, stderr) => {
        if (stdout) logger.info('postgres', `[initdb stdout] ${stdout.trim()}`);
        if (stderr) logger.warn('postgres', `[initdb stderr] ${stderr.trim()}`);

        if (error) {
          logger.error('postgres', `initdb failed: ${error.message}`);
          return reject(error);
        }
        resolve();
      });
    });
  }

  private startEngine(): Promise<void> {
    return new Promise((resolve) => {
      const postgresExe = path.join(this.binDir, 'postgres.exe');
      const args = [
        '-D', this.dataDir,
        '-p', this.port.toString(),
      ];

      logger.info('postgres', `Launching engine: "${postgresExe}" ${args.join(' ')}`);

      // Spawn silently
      this.childProcess = spawn(postgresExe, args, {
        windowsHide: true,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const pid = this.childProcess.pid;
      this.updateStatus({ pid });
      logger.info('postgres', `PostgreSQL process spawned with PID: ${pid}`);

      this.childProcess.stdout?.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          logger.info('postgres', line);
        }
      });

      this.childProcess.stderr?.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          // PostgreSQL outputs startup info to stderr by default
          if (line.includes('database system is ready to accept connections')) {
            logger.success('postgres', line);
          } else if (line.includes('FATAL') || line.includes('PANIC')) {
            logger.error('postgres', line);
          } else {
            logger.info('postgres', line);
          }
        }
      });

      this.childProcess.on('exit', (code, signal) => {
        logger.warn('postgres', `PostgreSQL process exited with code=${code}, signal=${signal}`);
        this.updateStatus({
          state: 'stopped',
          pid: undefined,
          isPortListening: false,
          canConnect: false,
        });
      });

      this.childProcess.on('error', (err) => {
        logger.error('postgres', `PostgreSQL process error: ${err.message}`);
        this.updateStatus({ state: 'error', error: err.message });
      });

      resolve();
    });
  }

  public async probePort(port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isResolved = false;

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        if (!isResolved) {
          isResolved = true;
          socket.destroy();
          resolve(true);
        }
      });

      socket.on('timeout', () => {
        if (!isResolved) {
          isResolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.on('error', () => {
        if (!isResolved) {
          isResolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.connect(port, '127.0.0.1');
    });
  }

  public async waitForPort(port: number, maxWaitMs = 30000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const listening = await this.probePort(port, 500);
      if (listening) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  public async stop(): Promise<void> {
    logger.info('postgres', 'Shutting down PostgreSQL server...');
    this.updateStatus({ state: 'stopping' });

    const pgCtlExe = path.join(this.binDir, 'pg_ctl.exe');
    if (fs.existsSync(pgCtlExe) && fs.existsSync(this.dataDir)) {
      await new Promise<void>((resolve) => {
        execFile(pgCtlExe, ['stop', '-D', this.dataDir, '-m', 'fast'], { windowsHide: true }, (err, stdout) => {
          if (stdout) logger.info('postgres', `[pg_ctl stop] ${stdout.trim()}`);
          if (err) logger.warn('postgres', `pg_ctl stop notice: ${err.message}`);
          resolve();
        });
      });
    }

    if (this.childProcess && !this.childProcess.killed) {
      try {
        this.childProcess.kill('SIGINT');
      } catch (e) {
        // ignore
      }
    }

    this.updateStatus({ state: 'stopped', pid: undefined, isPortListening: false, canConnect: false });
    logger.info('postgres', 'PostgreSQL stopped.');
  }
}
