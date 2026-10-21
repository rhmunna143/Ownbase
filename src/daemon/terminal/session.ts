import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import * as childProcess from 'child_process';
import { logger } from '../core/logger';
import { paths } from '../core/paths';
import { AuthenticatedUser } from '../../shared/contract/types';

// Optional dynamic import of node-pty for native ConPTY support
let ptyModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ptyModule = require('node-pty');
} catch (e: any) {
  logger.warn('terminal-session', `node-pty not available, falling back to child_process: ${e.message}`);
}

export interface TerminalSessionInfo {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  clientIp: string;
  startedAt: string;
  lastActivityAt: string;
  cols: number;
  rows: number;
  transcriptPath: string;
}

export class TerminalSession extends EventEmitter {
  public readonly id: string;
  public readonly actor: AuthenticatedUser;
  public readonly clientIp: string;
  public readonly startedAt: Date;
  public lastActivityAt: Date;
  public cols: number;
  public rows: number;
  public readonly transcriptPath: string;

  private transcriptStream: fs.WriteStream | null = null;
  private ptyProcess: any = null;
  private childProcess: childProcess.ChildProcess | null = null;
  private isUsingPty: boolean = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly idleTimeoutMs: number;
  private isClosed: boolean = false;

  constructor(
    id: string,
    actor: AuthenticatedUser,
    clientIp: string,
    options?: {
      cols?: number;
      rows?: number;
      idleTimeoutMs?: number;
      customLogsDir?: string;
      shell?: string;
    }
  ) {
    super();
    this.id = id;
    this.actor = actor;
    this.clientIp = clientIp;
    this.startedAt = new Date();
    this.lastActivityAt = new Date();
    this.cols = options?.cols || 80;
    this.rows = options?.rows || 24;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 15 * 60 * 1000; // 15 min default

    const logsDir = options?.customLogsDir || paths.logsDir;
    if (!fs.existsSync(logsDir)) {
      try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
    }
    this.transcriptPath = path.join(logsDir, `terminal-${this.id}.log`);

    // Initialize transcript audit log
    this.initTranscript();

    // Spawn pseudo-terminal or fallback process
    this.spawnTerminal(options?.shell);

    // Arm idle inactivity timer
    this.resetIdleTimer();
  }

  private initTranscript(): void {
    try {
      const header =
        `=== OWNBASE AUDITED TERMINAL TRANSCRIPT ===\n` +
        `Session ID: ${this.id}\n` +
        `Actor: ${this.actor.username} (ID: ${this.actor.id}, Role: ${this.actor.role})\n` +
        `Client IP: ${this.clientIp}\n` +
        `Started: ${this.startedAt.toISOString()}\n` +
        `Notice: All keystrokes and outputs are logged in compliance with PRD §6.5 & A4.\n` +
        `===========================================\n\n`;
      fs.appendFileSync(this.transcriptPath, header, { encoding: 'utf-8' });
      this.transcriptStream = fs.createWriteStream(this.transcriptPath, { flags: 'a', encoding: 'utf-8' });
    } catch (err: any) {
      logger.error('terminal-session', `Failed to open transcript stream for ${this.id}: ${err.message}`);
    }
  }

  private spawnTerminal(customShell?: string): void {
    const isWin = process.platform === 'win32';
    const shell =
      customShell ||
      (isWin ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/sh');

    if (ptyModule && typeof ptyModule.spawn === 'function') {
      try {
        this.ptyProcess = ptyModule.spawn(shell, [], {
          name: 'xterm-256color',
          cols: this.cols,
          rows: this.rows,
          cwd: paths.rootDir,
          env: process.env as Record<string, string>,
        });
        this.isUsingPty = true;

        this.ptyProcess.onData((data: string) => {
          this.recordOutput(data);
          this.emit('data', data);
        });

        this.ptyProcess.onExit((event: { exitCode: number; signal?: number }) => {
          logger.info('terminal-session', `PTY process exited for session ${this.id} with code ${event.exitCode}`);
          this.emit('exit', event.exitCode);
          this.close('process_exit');
        });

        logger.info('terminal-session', `ConPTY terminal session ${this.id} started (shell: ${shell}, user: ${this.actor.username})`);
        return;
      } catch (err: any) {
        logger.warn('terminal-session', `Failed to spawn with node-pty, falling back to child_process: ${err.message}`);
      }
    }

    // Graceful fallback to child_process
    try {
      this.childProcess = childProcess.spawn(shell, [], {
        cwd: paths.rootDir,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.childProcess.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        this.recordOutput(text);
        this.emit('data', text);
      });

      this.childProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        this.recordOutput(text);
        this.emit('data', text);
      });

      this.childProcess.on('exit', (code: number | null) => {
        const exitCode = code ?? 0;
        logger.info('terminal-session', `Terminal process exited for session ${this.id} with code ${exitCode}`);
        this.emit('exit', exitCode);
        this.close('process_exit');
      });

      logger.info('terminal-session', `Fallback terminal session ${this.id} started (shell: ${shell}, user: ${this.actor.username})`);
    } catch (err: any) {
      logger.error('terminal-session', `Failed to spawn fallback shell: ${err.message}`);
      throw err;
    }
  }

  /**
   * Resets the 15-minute inactivity timer.
   */
  public resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.idleTimeoutMs > 0 && !this.isClosed) {
      this.idleTimer = setTimeout(() => {
        logger.warn('terminal-session', `Terminal session ${this.id} reached idle timeout (${this.idleTimeoutMs}ms)`);
        this.emit('idle-timeout');
        this.emit('data', '\r\n\r\n[Ownbase Terminal session timed out due to inactivity]\r\n');
        this.close('idle_timeout');
      }, this.idleTimeoutMs);
    }
  }

  /**
   * Writes input data (keystrokes / commands) into the terminal.
   */
  public write(data: string): void {
    if (this.isClosed) return;
    this.lastActivityAt = new Date();
    this.resetIdleTimer();

    // Audit log input
    if (this.transcriptStream && !this.transcriptStream.destroyed) {
      this.transcriptStream.write(`[IN ${new Date().toISOString()}] ${data}\n`);
    }

    if (this.isUsingPty && this.ptyProcess) {
      this.ptyProcess.write(data);
    } else if (this.childProcess && this.childProcess.stdin && !this.childProcess.stdin.destroyed) {
      this.childProcess.stdin.write(data);
    }
  }

  /**
   * Resizes the terminal window columns and rows.
   */
  public resize(cols: number, rows: number): void {
    if (this.isClosed) return;
    this.cols = cols;
    this.rows = rows;
    this.lastActivityAt = new Date();
    this.resetIdleTimer();

    if (this.isUsingPty && this.ptyProcess && typeof this.ptyProcess.resize === 'function') {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (err: any) {
        logger.warn('terminal-session', `Failed to resize PTY: ${err.message}`);
      }
    }
  }

  private recordOutput(data: string): void {
    if (this.isClosed) return;
    this.lastActivityAt = new Date();
    if (this.transcriptStream && !this.transcriptStream.destroyed && !this.transcriptStream.writableEnded) {
      try {
        this.transcriptStream.write(`[OUT ${new Date().toISOString()}] ${data}`);
      } catch {}
    }
  }

  /**
   * Closes the terminal session, terminates processes, and flushes audit logs.
   */
  public close(reason = 'normal_close'): void {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Flush and finalize transcript audit log
    if (this.transcriptStream && !this.transcriptStream.destroyed) {
      try {
        const durationSec = Math.round((Date.now() - this.startedAt.getTime()) / 1000);
        this.transcriptStream.write(
          `\n\n=== TERMINAL SESSION ENDED ===\n` +
          `End Reason: ${reason}\n` +
          `Ended At: ${new Date().toISOString()}\n` +
          `Total Duration: ${durationSec}s\n` +
          `==============================\n`
        );
        this.transcriptStream.end();
      } catch {}
    }

    // Kill PTY process if active
    if (this.isUsingPty && this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {}
      this.ptyProcess = null;
    }

    // Kill fallback child process if active
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch {}
      this.childProcess = null;
    }

    this.emit('close', reason);
    this.removeAllListeners();
  }

  public getInfo(): TerminalSessionInfo {
    return {
      id: this.id,
      actorId: this.actor.id,
      actorName: this.actor.username,
      actorRole: this.actor.role,
      clientIp: this.clientIp,
      startedAt: this.startedAt.toISOString(),
      lastActivityAt: this.lastActivityAt.toISOString(),
      cols: this.cols,
      rows: this.rows,
      transcriptPath: this.transcriptPath,
    };
  }
}
