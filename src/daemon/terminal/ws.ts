import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cookie from 'cookie';
import { logger } from '../core/logger';
import { AuthService } from '../auth/authService';
import { terminalManager } from './manager';
import { AuthenticatedUser } from '../../shared/contract/types';
import { parseCookieHeader } from '../gateway/httpServer';

export class TerminalWsBridge {
  private wss: WebSocketServer;
  private authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
    // Standalone WebSocketServer that delegates upgrade handling
    this.wss = new WebSocketServer({ noServer: true });
  }

  /**
   * Handles HTTP Upgrade requests for /api/v1/terminal/ws.
   * Strictly enforces ROOT role authorization: unauthorized roles get 403 on upgrade (PRD Criterion A4).
   */
  public async handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    // 1. Extract Token from Query Param, Authorization Header, or Cookie
    let rawToken = url.searchParams.get('token');
    if (!rawToken && req.headers.authorization?.startsWith('Bearer ')) {
      rawToken = req.headers.authorization.slice(7).trim();
    }
    if (!rawToken && req.headers.cookie) {
      try {
        const cookies = parseCookieHeader(req.headers.cookie);
        rawToken = cookies.ownbase_access_token || cookies.ownbase_session;
      } catch {}
    }

    if (!rawToken) {
      logger.warn('terminal-ws', `Unauthorized upgrade attempt from ${clientIp}: missing token`);
      this.rejectUpgrade(socket, 401, 'Unauthorized', 'Authentication required for terminal access');
      return;
    }

    // 2. Validate JWT and User Identity
    let user: AuthenticatedUser | null = null;
    try {
      user = await this.authService.verifyAccessToken(rawToken);
    } catch (err: any) {
      logger.warn('terminal-ws', `Token verification error from ${clientIp}: ${err.message}`);
    }

    if (!user) {
      logger.warn('terminal-ws', `Invalid token provided for terminal upgrade from ${clientIp}`);
      this.rejectUpgrade(socket, 401, 'Unauthorized', 'Invalid or expired authentication token');
      return;
    }

    // 3. Strictly Enforce ROOT Role Authorization (PRD Criterion A4 & D11)
    if (user.role !== 'ROOT') {
      logger.warn(
        'terminal-ws',
        `Forbidden terminal upgrade attempt by user "${user.username}" with role "${user.role}" from ${clientIp}. Access denied (403).`
      );
      this.rejectUpgrade(socket, 403, 'Forbidden', 'Terminal access restricted to ROOT role');
      return;
    }

    // 4. Upgrade to WebSocket Connection
    this.wss.handleUpgrade(req, socket, head, async (ws: WebSocket) => {
      try {
        const cols = parseInt(url.searchParams.get('cols') || '80', 10);
        const rows = parseInt(url.searchParams.get('rows') || '24', 10);

        const session = await terminalManager.createSession(user!, clientIp, {
          cols: isNaN(cols) ? 80 : cols,
          rows: isNaN(rows) ? 24 : rows,
        });

        // Forward PTY output directly to WebSocket client
        const onData = (data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        };
        session.on('data', onData);

        // Forward client input and resize commands into session
        ws.on('message', (message: any) => {
          const text = message.toString();
          // Check for JSON control messages (e.g. resize)
          if (text.startsWith('{') && text.endsWith('}')) {
            try {
              const parsed = JSON.parse(text);
              if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
                session.resize(parsed.cols, parsed.rows);
                return;
              }
            } catch {}
          }

          session.write(text);
        });

        ws.on('close', (code, reason) => {
          session.removeListener('data', onData);
          session.close(`ws_closed_${code}_${reason.toString() || 'normal'}`);
        });

        ws.on('error', (err) => {
          logger.error('terminal-ws', `WebSocket client error in session ${session.id}: ${err.message}`);
          session.close(`ws_error_${err.message}`);
        });

        session.on('close', () => {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close(1000, 'Session closed');
          }
        });

        // Send initial greeting banner
        ws.send(`\r\n\x1b[1;36m=== Connected to Ownbase ConPTY Terminal [Session: ${session.id}] ===\x1b[0m\r\n`);
        ws.send(`\x1b[90mSecurity Notice: Full session input and output is audited to ${session.transcriptPath}\x1b[0m\r\n\r\n`);
      } catch (err: any) {
        logger.error('terminal-ws', `Failed to initialize terminal session: ${err.message}`);
        ws.close(1011, err.message);
      }
    });
  }

  private rejectUpgrade(socket: any, statusCode: number, statusText: string, message: string): void {
    try {
      const body = JSON.stringify({ error: message, statusCode });
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n\r\n` +
        body
      );
      socket.destroy();
    } catch {}
  }
}
