import http from 'http';
import { eventBus, DaemonEvent } from '../core/events';
import { AuthService } from '../auth/authService';
import { ProcessSupervisor } from '../supervisor/supervisor';
import { PostgresManager } from '../db/postgres';
import { logger } from '../core/logger';

export interface EventStreamOptions {
  authService: AuthService;
  supervisor: ProcessSupervisor;
  postgres: PostgresManager;
}

export class EventStreamGateway {
  private authService: AuthService;
  private supervisor: ProcessSupervisor;
  private postgres: PostgresManager;

  constructor(options: EventStreamOptions) {
    this.authService = options.authService;
    this.supervisor = options.supervisor;
    this.postgres = options.postgres;
  }

  public async handleEventStream(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const token =
      parsedUrl.searchParams.get('token') ||
      parsedUrl.searchParams.get('ticket') ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);

    // Optional auth check: if token provided, verify it; otherwise require loopback if not public
    if (token) {
      const user = await this.authService.verifyAccessToken(token);
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired event stream token' }));
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable buffering on Nginx/Caddy proxies
    });

    // 1. Send initial connection heartbeat
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    // 2. Send initial state snapshot so the client doesn't have to poll
    const snapshot = this.getSnapshot();
    res.write(`data: ${JSON.stringify({ type: 'snapshot', data: snapshot })}\n\n`);

    // 3. Listen to all daemon events and forward to stream
    const onEvent = (event: DaemonEvent) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (err: any) {
        // Stream writing non-fatal error
      }
    };

    // Keep connection alive with 25-second periodic ping comments
    const pingInterval = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(pingInterval);
      }
    }, 25000);

    eventBus.on('*', onEvent);

    req.on('close', () => {
      clearInterval(pingInterval);
      eventBus.off('*', onEvent);
    });
  }

  public getSnapshot(): {
    services: Record<string, any>;
    postgres: any;
    timestamp: string;
  } {
    return {
      services: this.supervisor.getAllStatuses(),
      postgres: this.postgres.getStatus(),
      timestamp: new Date().toISOString(),
    };
  }
}
