import http from 'http';
import crypto from 'crypto';
import cookie from 'cookie';
import { AuthService } from './authService';
import { Role, AuthenticatedUser, hasRequiredRole, RouteDefinition } from '../../shared/contract/types';

export interface GuardDecision {
  allowed: boolean;
  statusCode?: number;
  error?: string;
  user?: AuthenticatedUser;
}

export class AuthGuard {
  private authService: AuthService;
  private wsTickets: Map<string, { user: AuthenticatedUser; expiresAt: number }> = new Map();

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  /**
   * Authenticates the incoming HTTP request via Bearer JWT, x-api-key, ?token query param, or Cookie.
   */
  public async authenticate(req: http.IncomingMessage): Promise<AuthenticatedUser | null> {
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];

    // 1. Try Bearer Access JWT
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const user = await this.authService.verifyAccessToken(token);
      if (user) return user;
    }

    // 2. Try x-api-key
    if (apiKeyHeader && typeof apiKeyHeader === 'string') {
      const user = await this.authService.verifyApiKey(apiKeyHeader.trim());
      if (user) return user;
    }

    // 3. Fallback: ?token= query parameter (for media streaming & direct downloads)
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const queryToken = url.searchParams.get('token');
      if (queryToken) {
        const user = await this.authService.verifyAccessToken(queryToken);
        if (user) return user;
      }
    } catch { }

    // 4. Fallback: Cookie authentication (for browser img/video tags and active sessions)
    if (req.headers.cookie) {
      try {
        const cookies = cookie.parse(req.headers.cookie);
        const cookieToken = cookies.ownbase_access_token || cookies.ownbase_session;
        if (cookieToken) {
          const user = await this.authService.verifyAccessToken(cookieToken);
          if (user) return user;
        }
      } catch { }
    }

    return null;
  }

  /**
   * Evaluates authentication and role-based authorization against a route definition.
   */
  public async evaluate(req: http.IncomingMessage, routeDef: RouteDefinition): Promise<GuardDecision> {
    // Public routes bypass auth (Acceptance A2)
    if (routeDef.auth === 'public') {
      return { allowed: true };
    }

    // Authenticate user
    const user = await this.authenticate(req);
    if (!user) {
      return {
        allowed: false,
        statusCode: 401,
        error: 'Unauthorized: Authentication required via Bearer JWT token or x-api-key',
      };
    }

    // Role check
    if (routeDef.minRole && !hasRequiredRole(user.role, routeDef.minRole)) {
      return {
        allowed: false,
        statusCode: 403,
        error: `Forbidden: Endpoint requires role '${routeDef.minRole}', but user has '${user.role}'`,
        user,
      };
    }

    return { allowed: true, user };
  }

  /**
   * Issues a short-lived (30s) single-use cryptographic ticket for WebSocket connection upgrade.
   */
  public issueWsTicket(user: AuthenticatedUser): string {
    const ticket = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 30000; // 30s
    this.wsTickets.set(ticket, { user, expiresAt });
    return ticket;
  }

  /**
   * Redeems and validates a single-use WebSocket ticket.
   */
  public redeemWsTicket(ticket: string): AuthenticatedUser | null {
    const entry = this.wsTickets.get(ticket);
    if (!entry) return null;

    this.wsTickets.delete(ticket); // Single-use consumption
    if (Date.now() > entry.expiresAt) return null;

    return entry.user;
  }
}
