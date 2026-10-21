import { RouteDefinition } from './types';
import {
  SetupRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  CreateUserRequestSchema,
  CreateApiKeyRequestSchema,
  CreateRouteRequestSchema,
  TableBrowserQuerySchema,
  CreateAppRequestSchema,
  DeployAppRequestSchema,
  RollbackAppRequestSchema,
  InstallCatalogRequestSchema,
  TlsPreflightRequestSchema,
  CreateTcpProxyRequestSchema,
  CreateServiceMountRequestSchema,
} from './schemas';

export const ROUTE_TABLE: RouteDefinition[] = [
  // ==========================================
  // Public Routes (Acceptance Criteria A2)
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/health',
    auth: 'public',
    summary: 'Public system health probe',
  },
  {
    method: 'GET',
    path: '/api/v1/setup/status',
    auth: 'public',
    summary: 'First-run setup status (hasRootUser flag)',
  },
  {
    method: 'POST',
    path: '/api/v1/setup',
    auth: 'public', // Guarded internally: loopback or token required, only if no ROOT user exists
    summary: 'First-run root account initialization',
    requestSchema: SetupRequestSchema,
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    auth: 'public',
    summary: 'User login via password with rate-limiting',
    requestSchema: LoginRequestSchema,
  },
  {
    method: 'POST',
    path: '/api/v1/auth/refresh',
    auth: 'public',
    summary: 'Rotate refresh token and issue new access JWT',
    requestSchema: RefreshRequestSchema,
  },

  // ==========================================
  // Authenticated Auth & Sessions
  // ==========================================
  {
    method: 'POST',
    path: '/api/v1/auth/logout',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Revoke refresh token and logout',
  },
  {
    method: 'GET',
    path: '/api/v1/auth/me',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Get current authenticated user profile',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/ws-ticket',
    auth: 'user',
    minRole: 'ROOT',
    summary: 'Issue single-use ticket for WebSocket terminal upgrade',
  },

  // ==========================================
  // System Telemetry & Metrics
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/system-info',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Host hardware and network interfaces telemetry',
  },
  {
    method: 'GET',
    path: '/api/v1/postgres-status',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Query PostgreSQL native engine process and port status',
  },
  {
    method: 'GET',
    path: '/api/v1/migration-status',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Query Prisma migration status and schema health',
  },
  {
    method: 'GET',
    path: '/api/v1/bootstrap-steps',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Retrieve initial server bootstrapping progress steps',
  },
  {
    method: 'POST',
    path: '/api/v1/ping-database',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Test database connectivity roundtrip latency',
  },
  {
    method: 'GET',
    path: '/api/v1/process-statuses',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Get real-time statuses for all managed processes',
  },
  {
    method: 'GET',
    path: '/api/v1/logs',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Retrieve global system logs',
  },

  // ==========================================
  // Services & Process Supervisor
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/services',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List managed native services',
  },
  {
    method: 'POST',
    path: '/api/v1/services',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Register and create a new managed service',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/services/:id/start',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Start managed service process',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/services/:id/stop',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Stop managed service process',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/services/:id/restart',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Restart managed service process',
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/services/:id/logs',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Get service log history',
  },

  // ==========================================
  // Routing & Caddy Edge Ingress
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/routes',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List reverse-proxy routing rules',
  },
  {
    method: 'POST',
    path: '/api/v1/routes',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Create or update reverse-proxy route',
    requestSchema: CreateRouteRequestSchema,
    audit: true,
  },
  {
    method: 'DELETE',
    path: '/api/v1/routes/:id',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Delete reverse-proxy route',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/caddy/sync',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Force dynamic reload of Caddy ingress routes',
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/caddy/status',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Query Caddy edge proxy status and route count',
  },
  {
    method: 'POST',
    path: '/api/v1/caddy/test',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Probe a configured route through the Caddy edge gateway',
  },

  // ==========================================
  // Tailscale Mesh Tunneling
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/tailscale/status',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Query Tailscale mesh connection status and IP',
  },
  {
    method: 'POST',
    path: '/api/v1/tailscale/connect',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Connect node to Tailscale tailnet using auth key',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/tailscale/disconnect',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Disconnect node from Tailscale tailnet',
    audit: true,
  },

  // ==========================================
  // System Lifecycle & Power Management
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/lifecycle/status',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Query system power save blocker and autostart state',
  },
  {
    method: 'POST',
    path: '/api/v1/lifecycle/autostart',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Configure Windows autostart on system boot',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/lifecycle/power-blocker',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Toggle Windows power save suspension blocker',
    audit: true,
  },

  // ==========================================
  // File Service & Media
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/files/list',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List files in storage directory',
  },
  {
    method: 'GET',
    path: '/api/v1/files/download',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Download a stored file',
  },
  {
    method: 'GET',
    path: '/api/v1/files/content',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Read text content of a file in storage',
  },
  {
    method: 'POST',
    path: '/api/v1/files/upload',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Upload a file to storage',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/files/mkdir',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Create a new folder in storage',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/files/rename',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Rename a file or folder in storage',
    audit: true,
  },
  {
    method: 'DELETE',
    path: '/api/v1/files/delete',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Delete a file or folder from storage',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/files/delete',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Delete a file or folder from storage (POST alternative)',
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/files/stream',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Stream video/audio with HTTP 206 Byte-Range support',
  },
  {
    method: 'GET',
    path: '/api/v1/photos/timeline',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Fetch photos media timeline',
  },
  {
    method: 'GET',
    path: '/api/v1/photos/media',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Stream photo or video preview media',
  },
  {
    method: 'POST',
    path: '/api/v1/photos/favorites',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Toggle photo favorite flag',
  },
  {
    method: 'POST',
    path: '/api/v1/photos/favorite',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Toggle photo favorite flag (alias)',
  },

  // ==========================================
  // Read-Only Table Browser (Item 1.7)
  // Replaces arbitrary /api/execute-query
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/db/tables',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'List permitted database tables for browsing',
  },
  {
    method: 'GET',
    path: '/api/v1/db/tables/:table/rows',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Read-only paginated table browser query',
    requestSchema: TableBrowserQuerySchema,
  },

  // ==========================================
  // Audit Logs (Item 1.11)
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/audit/logs',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Query immutable security audit logs',
  },

  // ==========================================
  // Interactive OpenAPI & Documentation
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/openapi.json',
    auth: 'public',
    summary: 'OpenAPI 3.0 specification auto-generated from route table',
  },
  {
    method: 'GET',
    path: '/api/v1/docs/endpoints',
    auth: 'public',
    summary: 'Summary catalogue of all registered system endpoints',
  },

  // ==========================================
  // User Management (ROOT only)
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/users',
    auth: 'user',
    minRole: 'ROOT',
    summary: 'List user accounts and roles',
  },
  {
    method: 'POST',
    path: '/api/v1/users',
    auth: 'user',
    minRole: 'ROOT',
    summary: 'Create a new user account',
    requestSchema: CreateUserRequestSchema,
    audit: true,
  },

  // ==========================================
  // API Keys (ROOT only)
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/api-keys',
    auth: 'user',
    minRole: 'ROOT',
    summary: 'List active API keys',
  },
  {
    method: 'POST',
    path: '/api/v1/api-keys',
    auth: 'user',
    minRole: 'ROOT',
    summary: 'Generate a new 32-byte secret API key',
    requestSchema: CreateApiKeyRequestSchema,
    audit: true,
  },
  {
    method: 'DELETE',
    path: '/api/v1/api-keys/:id',
    auth: 'user',
    minRole: 'ROOT',
    summary: 'Revoke an API key',
    audit: true,
  },

  // ==========================================
  // Phase 4: Apps & Deployment Engine
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/apps',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List deployed applications',
  },
  {
    method: 'POST',
    path: '/api/v1/apps',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Register a new application',
    requestSchema: CreateAppRequestSchema,
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/apps/:id',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Get application details and active release status',
  },
  {
    method: 'DELETE',
    path: '/api/v1/apps/:id',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Delete application, release files, and associated routes',
    audit: true,
  },
  {
    method: 'POST',
    path: '/api/v1/apps/:id/deploy',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Trigger supervised application deployment from Git or archive',
    requestSchema: DeployAppRequestSchema,
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/apps/:id/deployments',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List deployment history for an application',
  },
  {
    method: 'GET',
    path: '/api/v1/apps/:id/releases',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List versioned atomic releases for an application',
  },
  {
    method: 'POST',
    path: '/api/v1/apps/:id/rollback',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'Instant rollback (<15s) to a previously healthy release',
    requestSchema: RollbackAppRequestSchema,
    audit: true,
  },

  // ==========================================
  // Phase 4: App Catalog & Recipes
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/catalog',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List declarative app catalog recipes',
  },
  {
    method: 'POST',
    path: '/api/v1/catalog/install',
    auth: 'user',
    minRole: 'OPERATOR',
    summary: 'One-click install from catalog recipe',
    requestSchema: InstallCatalogRequestSchema,
    audit: true,
  },

  // ==========================================
  // Phase 5: Ingress, TLS & Direct TCP Exposure
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/network/urls',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Get derived accessible URLs for all routes with exposure warnings',
  },
  {
    method: 'POST',
    path: '/api/v1/network/tls/preflight',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Pre-flight check for custom domain ACME TLS and CGNAT detection',
    requestSchema: TlsPreflightRequestSchema,
  },
  {
    method: 'GET',
    path: '/api/v1/network/tcp',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'List active direct TCP proxy listeners',
  },
  {
    method: 'POST',
    path: '/api/v1/network/tcp',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Start direct TCP port forwarder with firewall rule',
    requestSchema: CreateTcpProxyRequestSchema,
    audit: true,
  },
  {
    method: 'DELETE',
    path: '/api/v1/network/tcp/:port',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Stop direct TCP forwarder and remove firewall rule',
    audit: true,
  },

  // ==========================================
  // Phase 5: Storage Volumes & Mounts
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/storage/volumes',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List discovered Windows storage volumes and free space',
  },
  {
    method: 'POST',
    path: '/api/v1/storage/volumes/refresh',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Trigger scan and refresh of Windows storage volumes',
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/storage/mounts',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'List service storage mounts and directory junctions',
  },
  {
    method: 'POST',
    path: '/api/v1/storage/mounts',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Create tiered service mount with NTFS junction',
    requestSchema: CreateServiceMountRequestSchema,
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/storage/usage',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Get cached storage usage breakdown and alerts',
  },

  // ==========================================
  // Phase 5: Media Service & Timeline
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/media/timeline',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Get paginated photo and video timeline from database',
  },
  {
    method: 'POST',
    path: '/api/v1/media/scan',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'Trigger background media library indexing scan',
    audit: true,
  },
  {
    method: 'GET',
    path: '/api/v1/media/thumbnail/:id',
    auth: 'user',
    minRole: 'READ_ONLY',
    summary: 'Retrieve cached WebP thumbnail for media item',
  },

  // ==========================================
  // Phase 6: Web Terminal & Forward-Auth Guard
  // ==========================================
  {
    method: 'GET',
    path: '/api/v1/auth/verify',
    auth: 'public',
    summary: 'Forward-auth verification endpoint for edge reverse proxies and LAN route guarding',
  },
  {
    method: 'GET',
    path: '/api/v1/terminal/sessions',
    auth: 'user',
    minRole: 'ADMIN',
    summary: 'List active terminal sessions and connected actors',
  },
  {
    method: 'DELETE',
    path: '/api/v1/terminal/sessions/:sessionId',
    auth: 'user',
    minRole: 'ROOT',
    summary: 'Terminate an active terminal session',
    audit: true,
  },
];

/**
 * Finds matching route definition in ROUTE_TABLE.
 * Normalizes parameterized paths like /api/v1/services/:id/start
 */
export function matchRoute(method: string, path: string): { route?: RouteDefinition; params: Record<string, string> } {
  // Normalize path (handle optional trailing slash and /api/ vs /api/v1/ mapping)
  let normalizedPath = path.replace(/\/+$/, '') || '/';
  
  // Normalize unversioned legacy paths to /api/v1/
  if (normalizedPath.startsWith('/api/') && !normalizedPath.startsWith('/api/v1/')) {
    normalizedPath = normalizedPath.replace(/^\/api\//, '/api/v1/');
  }

  for (const def of ROUTE_TABLE) {
    if (def.method !== method.toUpperCase()) continue;

    // Direct match
    if (def.path === normalizedPath) {
      return { route: def, params: {} };
    }

    // Parameterized match (e.g. /api/v1/services/:id/start)
    if (def.path.includes(':')) {
      const defParts = def.path.split('/');
      const reqParts = normalizedPath.split('/');
      if (defParts.length !== reqParts.length) continue;

      let match = true;
      const params: Record<string, string> = {};

      for (let i = 0; i < defParts.length; i++) {
        if (defParts[i].startsWith(':')) {
          const paramName = defParts[i].slice(1);
          params[paramName] = reqParts[i];
        } else if (defParts[i] !== reqParts[i]) {
          match = false;
          break;
        }
      }

      if (match) {
        return { route: def, params };
      }
    }
  }

  return { params: {} };
}
