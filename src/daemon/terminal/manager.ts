import crypto from 'crypto';
import { logger } from '../core/logger';
import { AuditService } from '../auth/audit';
import { AuthenticatedUser } from '../../shared/contract/types';
import { TerminalSession, TerminalSessionInfo } from './session';

export class TerminalManager {
  private sessions: Map<string, TerminalSession> = new Map();
  private maxConcurrentSessions: number = 5;
  private defaultIdleTimeoutMs: number = 15 * 60 * 1000; // 15 minutes
  private auditService: AuditService | null = null;

  constructor(options?: { maxConcurrentSessions?: number; idleTimeoutMs?: number; auditService?: AuditService }) {
    if (options?.maxConcurrentSessions) {
      this.maxConcurrentSessions = options.maxConcurrentSessions;
    }
    if (options?.idleTimeoutMs !== undefined) {
      this.defaultIdleTimeoutMs = options.idleTimeoutMs;
    }
    if (options?.auditService) {
      this.auditService = options.auditService;
    }
  }

  public setAuditService(auditService: AuditService): void {
    this.auditService = auditService;
  }

  /**
   * Creates a new audited terminal session for an authenticated user.
   * Enforces concurrent session caps and records an audit log entry.
   */
  public async createSession(
    actor: AuthenticatedUser,
    clientIp: string,
    options?: {
      cols?: number;
      rows?: number;
      idleTimeoutMs?: number;
      customLogsDir?: string;
      shell?: string;
    }
  ): Promise<TerminalSession> {
    if (this.sessions.size >= this.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent terminal sessions reached (${this.maxConcurrentSessions}). Please terminate an existing session before opening a new one.`
      );
    }

    const sessionId = `term_${crypto.randomUUID()}`;
    const idleTimeoutMs = options?.idleTimeoutMs ?? this.defaultIdleTimeoutMs;

    const session = new TerminalSession(sessionId, actor, clientIp, {
      cols: options?.cols,
      rows: options?.rows,
      idleTimeoutMs,
      customLogsDir: options?.customLogsDir,
      shell: options?.shell,
    });

    this.sessions.set(sessionId, session);

    // Record session start in AuditLog (PRD Acceptance Criterion A4)
    if (this.auditService) {
      await this.auditService.record({
        actorId: actor.id,
        actorName: actor.username,
        action: 'terminal.session_start',
        entity: 'terminal',
        entityId: sessionId,
        ipAddress: clientIp,
        status: 'success',
        details: {
          cols: session.cols,
          rows: session.rows,
          transcriptPath: session.transcriptPath,
          idleTimeoutMs,
        },
      });
    }

    logger.info(
      'terminal-manager',
      `Created audited terminal session ${sessionId} for user "${actor.username}" [${actor.role}] from ${clientIp}. Active sessions: ${this.sessions.size}`
    );

    // Clean up map and record session end in AuditLog upon closure
    session.on('close', async (reason: string) => {
      this.sessions.delete(sessionId);
      const durationMs = Date.now() - session.startedAt.getTime();

      try {
        if (this.auditService) {
          await this.auditService.record({
            actorId: actor.id,
            actorName: actor.username,
            action: 'terminal.session_end',
            entity: 'terminal',
            entityId: sessionId,
            ipAddress: clientIp,
            status: 'success',
            details: {
              durationMs,
              reason,
              transcriptPath: session.transcriptPath,
            },
          });
        }
      } catch (err: any) {
        logger.error('terminal-manager', `Failed to record terminal.session_end audit log: ${err.message}`);
      }

      logger.info(
        'terminal-manager',
        `Terminal session ${sessionId} closed (${reason}, duration: ${Math.round(durationMs / 1000)}s). Active sessions: ${this.sessions.size}`
      );
    });

    return session;
  }

  /**
   * Retrieves an active terminal session by ID.
   */
  public getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Returns metadata for all currently active terminal sessions.
   * Allows administrators to inspect concurrent sessions (PRD §6.5).
   */
  public getActiveSessions(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.getInfo());
  }

  /**
   * Terminates a specific terminal session.
   */
  public closeSession(sessionId: string, reason = 'admin_terminated'): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.close(reason);
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Closes all active terminal sessions on daemon shutdown.
   */
  public closeAll(): void {
    logger.info('terminal-manager', `Closing all active terminal sessions (${this.sessions.size})...`);
    for (const [id, session] of this.sessions.entries()) {
      try {
        session.close('daemon_shutdown');
      } catch {}
    }
    this.sessions.clear();
  }
}

export const terminalManager = new TerminalManager();
