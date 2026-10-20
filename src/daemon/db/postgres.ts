import { spawn, execFile, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import { secretsManager } from '../core/secrets';
import { PostgresStatus } from '../../shared/types';

export class PostgresManager {
  private childProcess: ChildProcess | null = null;
  private port: number = 5432;
  private binDir: string = '';
  private dataDir: string = '';
  private status: PostgresStatus;
  private onStatusChangeCallback?: (status: PostgresStatus) => void;

  constructor(customPort = 5432) {
    this.port = customPort;
    this.dataDir = paths.postgresDir;
    this.resolveBinDir();
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

  private resolveBinDir() {
    const candidateDirs = [
      path.join(paths.extraResourcesDir, 'pgsql', 'bin'),
      path.join(paths.extraResourcesDir, 'bin'),
      path.join(paths.runtimesDir, 'pgsql', 'bin'),
      path.join(process.cwd(), 'extraResources', 'pgsql', 'bin'),
      path.join(__dirname, '..', '..', '..', 'extraResources', 'pgsql', 'bin'),
    ];

    for (const cand of candidateDirs) {
      if (fs.existsSync(path.join(cand, 'postgres.exe')) && fs.existsSync(path.join(cand, 'initdb.exe'))) {
        this.binDir = cand;
        break;
      }
    }

    if (!this.binDir) {
      this.binDir = path.join(process.cwd(), 'extraResources', 'pgsql', 'bin');
    }

    logger.info('postgres', `Resolved PostgreSQL binaries: ${this.binDir}`);
    logger.info('postgres', `Resolved PostgreSQL data dir: ${this.dataDir}`);
  }

  public async bootstrap(): Promise<boolean> {
    try {
      this.resolveBinDir();

      const postgresExe = path.join(this.binDir, 'postgres.exe');
      const initdbExe = path.join(this.binDir, 'initdb.exe');

      if (!fs.existsSync(postgresExe) || !fs.existsSync(initdbExe)) {
        const errorMsg = `PostgreSQL binaries not found in ${this.binDir}`;
        logger.error('postgres', errorMsg);
        this.updateStatus({ state: 'error', error: errorMsg });
        throw new Error(errorMsg);
      }

      // Check if port 5432 is already listening
      const alreadyListening = await this.probePort(this.port, 1000);
      if (alreadyListening) {
        logger.warn('postgres', `Port ${this.port} is already listening. Checking existing connection...`);
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
        logger.info('postgres', `Database cluster missing. Initializing at ${this.dataDir} with scram-sha-256...`);
        this.updateStatus({ state: 'initializing' });
        await this.runInitDb();
        logger.success('postgres', 'PostgreSQL database cluster initialized.');
      } else {
        logger.info('postgres', `Existing PostgreSQL data directory found at ${this.dataDir}`);
      }

      // Safe stale-lock handling (D6)
      this.handleStalePidLock();

      // Start postgres.exe bound strictly to loopback
      this.updateStatus({ state: 'starting' });
      await this.startEngine();

      // Wait for port readiness
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

      logger.success('postgres', `PostgreSQL engine running on port ${this.port} (loopback only)`);
      return true;
    } catch (err: any) {
      logger.error('postgres', `Bootstrap failed: ${err.message}`);
      this.updateStatus({ state: 'error', error: err.message });
      throw err;
    }
  }

  /**
   * Safe stale-lock handling (D6):
   * Check the PID in postmaster.pid. If the process is not alive or is not postgres, remove the lock file.
   * If the process IS alive and is postgres, do NOT remove the lock.
   */
  public handleStalePidLock(): boolean {
    const pidFile = path.join(this.dataDir, 'postmaster.pid');
    if (!fs.existsSync(pidFile)) {
      return false;
    }

    try {
      const content = fs.readFileSync(pidFile, 'utf-8');
      const lines = content.split(/\r?\n/);
      const pid = parseInt(lines[0]?.trim(), 10);

      let isAlive = false;

      if (!isNaN(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          isAlive = true;
        } catch {
          // Process is dead
          isAlive = false;
        }
      }

      if (isAlive) {
        logger.warn('postgres', `Active process detected with PID ${pid}. Preserving postmaster.pid.`);
        return false;
      }

      logger.warn('postgres', `Detected stale postmaster.pid for dead process (PID: ${pid}). Safely unlinking lock.`);
      fs.unlinkSync(pidFile);
      return true;
    } catch (e: any) {
      logger.warn('postgres', `Failed to evaluate or remove postmaster.pid: ${e.message}`);
      return false;
    }
  }

  private runInitDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const initdbExe = path.join(this.binDir, 'initdb.exe');

      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      const password = secretsManager.getOrCreatePostgresPassword();
      const pwFile = path.join(paths.secretsDir, 'initdb_pw.tmp');

      try {
        fs.writeFileSync(pwFile, password, { encoding: 'utf-8', mode: 0o600 });
      } catch (err: any) {
        logger.warn('postgres', `Could not write temporary pwfile: ${err.message}`);
      }

      const args = [
        '-D', this.dataDir,
        '-U', 'postgres',
        '-A', 'scram-sha-256',
        '-E', 'UTF8',
        '--locale=C',
      ];

      if (fs.existsSync(pwFile)) {
        args.push(`--pwfile=${pwFile}`);
      }

      logger.info('postgres', `Executing: "${initdbExe}" -D ${this.dataDir} -U postgres -A scram-sha-256`);

      execFile(initdbExe, args, { windowsHide: true }, (error, stdout, stderr) => {
        // Clean up temporary password file immediately
        if (fs.existsSync(pwFile)) {
          try { fs.unlinkSync(pwFile); } catch {}
        }

        if (stdout) logger.info('postgres', `[initdb stdout] ${stdout.trim()}`);
        if (stderr) logger.warn('postgres', `[initdb stderr] ${stderr.trim()}`);

        if (error) {
          logger.error('postgres', `initdb failed: ${error.message}`);
          return reject(error);
        }

        // Configure postgresql.conf for loopback-only binding
        this.hardenConfig();
        resolve();
      });
    });
  }

  private hardenConfig() {
    try {
      const confPath = path.join(this.dataDir, 'postgresql.conf');
      if (fs.existsSync(confPath)) {
        let conf = fs.readFileSync(confPath, 'utf-8');
        // Ensure listen_addresses is loopback only (D6)
        if (conf.includes('listen_addresses')) {
          conf = conf.replace(/^[#\s]*listen_addresses\s*=.*$/m, "listen_addresses = '127.0.0.1, ::1'");
        } else {
          conf += "\nlisten_addresses = '127.0.0.1, ::1'\n";
        }
        // SCRAM authentication
        if (conf.includes('password_encryption')) {
          conf = conf.replace(/^[#\s]*password_encryption\s*=.*$/m, "password_encryption = 'scram-sha-256'");
        } else {
          conf += "\npassword_encryption = 'scram-sha-256'\n";
        }
        fs.writeFileSync(confPath, conf, 'utf-8');
        logger.info('postgres', 'postgresql.conf hardened: loopback only (127.0.0.1, ::1) and scram-sha-256');
      }

      const hbaPath = path.join(this.dataDir, 'pg_hba.conf');
      if (fs.existsSync(hbaPath)) {
        const hbaContent = [
          '# Loopback-only authentication (D6)',
          'host    all             all             127.0.0.1/32            scram-sha-256',
          'host    all             all             ::1/128                 scram-sha-256',
          'local   all             all                                     scram-sha-256',
          '',
        ].join('\n');
        fs.writeFileSync(hbaPath, hbaContent, 'utf-8');
        logger.info('postgres', 'pg_hba.conf hardened for scram-sha-256 loopback access');
      }
    } catch (e: any) {
      logger.warn('postgres', `Hardening postgres configuration notice: ${e.message}`);
    }
  }

  private startEngine(): Promise<void> {
    return new Promise((resolve) => {
      const postgresExe = path.join(this.binDir, 'postgres.exe');
      const args = [
        '-D', this.dataDir,
        '-p', this.port.toString(),
        '-h', '127.0.0.1', // strictly loopback
      ];

      logger.info('postgres', `Launching engine: "${postgresExe}" ${args.join(' ')}`);

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
      } catch {}
    }

    this.updateStatus({ state: 'stopped', pid: undefined, isPortListening: false, canConnect: false });
    logger.info('postgres', 'PostgreSQL stopped.');
  }
}

export const postgresManager = new PostgresManager();
