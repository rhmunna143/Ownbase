# Ownbase Native Windows Server - API Reference

**Document Version:** 1.0.0  
**OpenAPI Specification:** 3.0.3  
**Base URL:** `http://127.0.0.1:3001` (Direct Gateway) or `http://localhost` (Caddy Ingress Port 80)  
**Total Endpoints:** 93

---

## Overview

Ownbase exposes a unified, contract-driven REST API for standalone server orchestration on Windows without Docker or WSL2.
All endpoints adhere strictly to the centralized `ROUTE_TABLE` schema and return standardized JSON responses.

### Authentication & Authorization

All authenticated endpoints require one of the following:
1. **Bearer JWT Token**: Header `Authorization: Bearer <access_token>` (15-minute expiration, issued by `/api/v1/auth/login` or `/api/v1/auth/refresh`).
2. **Permanent API Key**: Header `x-api-key: <api_key>` (32-byte cryptographically secure key created by Root administrator).

### Role Hierarchy

```
ROOT (Super-admin: backups, raw restore, terminal, user deletion)
  ▲
ADMIN (Operator: deploy, catalog install, routes, restarts, alert rules)
  ▲
READ_ONLY (Viewer: metrics, logs, service status, file reads)
```

---

## Route Catalog Summary

| Category | Endpoints Count | Default Access |
| :--- | :---: | :--- |
| **Administration & Access Control** | 5 | Authenticated (Bearer / API Key) |
| **Audited ConPTY Web Terminal** | 2 | Authenticated (Bearer / API Key) |
| **Authentication & Identity** | 8 | Mixed (Public / Authenticated) |
| **Backups & Disaster Recovery** | 4 | Authenticated (Bearer / API Key) |
| **Database Table Browser** | 2 | Authenticated (Bearer / API Key) |
| **Edge Gateway & Reverse Proxy** | 6 | Authenticated (Bearer / API Key) |
| **General** | 21 | Mixed (Public / Authenticated) |
| **Lifecycle & Power Management** | 3 | Authenticated (Bearer / API Key) |
| **Observability & Alerting** | 4 | Authenticated (Bearer / API Key) |
| **Photos & Media Indexer** | 4 | Authenticated (Bearer / API Key) |
| **Process Supervisor & App Catalog** | 10 | Authenticated (Bearer / API Key) |
| **Security Audit Stream** | 1 | Authenticated (Bearer / API Key) |
| **Storage Volumes & Contained File Streaming** | 14 | Authenticated (Bearer / API Key) |
| **System & Health Telemetry** | 6 | Mixed (Public / Authenticated) |
| **Tailscale Mesh Networking** | 3 | Authenticated (Bearer / API Key) |

---

## Endpoints Specification

### Administration & Access Control

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/users` | `ROOT` | — | List user accounts and roles |
| `POST` | `/api/v1/users` | `ROOT` | ✅ Yes | Create a new user account |
| `GET` | `/api/v1/api-keys` | `ROOT` | — | List active API keys |
| `POST` | `/api/v1/api-keys` | `ROOT` | ✅ Yes | Generate a new 32-byte secret API key |
| `DELETE` | `/api/v1/api-keys/:id` | `ROOT` | ✅ Yes | Revoke an API key |

### Audited ConPTY Web Terminal

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/terminal/sessions` | `ADMIN` | — | List active terminal sessions and connected actors |
| `DELETE` | `/api/v1/terminal/sessions/:sessionId` | `ROOT` | ✅ Yes | Terminate an active terminal session |

### Authentication & Identity

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/setup/status` | `Public` | — | First-run setup status (hasRootUser flag) |
| `POST` | `/api/v1/setup` | `Public` | ✅ Yes | First-run root account initialization |
| `POST` | `/api/v1/auth/login` | `Public` | — | User login via password with rate-limiting |
| `POST` | `/api/v1/auth/refresh` | `Public` | — | Rotate refresh token and issue new access JWT |
| `POST` | `/api/v1/auth/logout` | `READ_ONLY` | — | Revoke refresh token and logout |
| `GET` | `/api/v1/auth/me` | `READ_ONLY` | — | Get current authenticated user profile |
| `POST` | `/api/v1/auth/ws-ticket` | `ROOT` | — | Issue single-use ticket for WebSocket terminal upgrade |
| `GET` | `/api/v1/auth/verify` | `Public` | — | Forward-auth verification endpoint for edge reverse proxies and LAN route guarding |

### Backups & Disaster Recovery

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/backups` | `ADMIN` | — | List automated and on-demand database backup archives |
| `POST` | `/api/v1/backups` | `ADMIN` | ✅ Yes | Trigger encrypted database and configuration backup |
| `POST` | `/api/v1/backups/:id/restore` | `ROOT` | ✅ Yes | Restore database and configuration from backup archive |
| `DELETE` | `/api/v1/backups/:id` | `ROOT` | ✅ Yes | Delete backup job and remove archive file |

### Database Table Browser

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/db/tables` | `ADMIN` | — | List permitted database tables for browsing |
| `GET` | `/api/v1/db/tables/:table/rows` | `ADMIN` | — | Read-only paginated table browser query |

### Edge Gateway & Reverse Proxy

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/routes` | `READ_ONLY` | — | List reverse-proxy routing rules |
| `POST` | `/api/v1/routes` | `ADMIN` | ✅ Yes | Create or update reverse-proxy route |
| `DELETE` | `/api/v1/routes/:id` | `ADMIN` | ✅ Yes | Delete reverse-proxy route |
| `POST` | `/api/v1/caddy/sync` | `ADMIN` | ✅ Yes | Force dynamic reload of Caddy ingress routes |
| `GET` | `/api/v1/caddy/status` | `READ_ONLY` | — | Query Caddy edge proxy status and route count |
| `POST` | `/api/v1/caddy/test` | `ADMIN` | — | Probe a configured route through the Caddy edge gateway |

### General

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/postgres-status` | `READ_ONLY` | — | Query PostgreSQL native engine process and port status |
| `GET` | `/api/v1/migration-status` | `READ_ONLY` | — | Query Prisma migration status and schema health |
| `GET` | `/api/v1/logs` | `READ_ONLY` | — | Retrieve global system logs |
| `GET` | `/api/v1/openapi.json` | `Public` | — | OpenAPI 3.0 specification auto-generated from route table |
| `GET` | `/api/v1/docs/endpoints` | `Public` | — | Summary catalogue of all registered system endpoints |
| `GET` | `/api/v1/apps` | `READ_ONLY` | — | List deployed applications |
| `POST` | `/api/v1/apps` | `OPERATOR` | ✅ Yes | Register a new application |
| `GET` | `/api/v1/apps/:id` | `READ_ONLY` | — | Get application details and active release status |
| `DELETE` | `/api/v1/apps/:id` | `ADMIN` | ✅ Yes | Delete application, release files, and associated routes |
| `POST` | `/api/v1/apps/:id/deploy` | `OPERATOR` | ✅ Yes | Trigger supervised application deployment from Git or archive |
| `GET` | `/api/v1/apps/:id/deployments` | `READ_ONLY` | — | List deployment history for an application |
| `GET` | `/api/v1/apps/:id/releases` | `READ_ONLY` | — | List versioned atomic releases for an application |
| `POST` | `/api/v1/apps/:id/rollback` | `OPERATOR` | ✅ Yes | Instant rollback (<15s) to a previously healthy release |
| `GET` | `/api/v1/network/urls` | `READ_ONLY` | — | Get derived accessible URLs for all routes with exposure warnings |
| `POST` | `/api/v1/network/tls/preflight` | `ADMIN` | — | Pre-flight check for custom domain ACME TLS and CGNAT detection |
| `GET` | `/api/v1/network/tcp` | `ADMIN` | — | List active direct TCP proxy listeners |
| `POST` | `/api/v1/network/tcp` | `ADMIN` | ✅ Yes | Start direct TCP port forwarder with firewall rule |
| `DELETE` | `/api/v1/network/tcp/:port` | `ADMIN` | ✅ Yes | Stop direct TCP forwarder and remove firewall rule |
| `GET` | `/api/v1/media/timeline` | `READ_ONLY` | — | Get paginated photo and video timeline from database |
| `POST` | `/api/v1/media/scan` | `ADMIN` | ✅ Yes | Trigger background media library indexing scan |
| `GET` | `/api/v1/media/thumbnail/:id` | `READ_ONLY` | — | Retrieve cached WebP thumbnail for media item |

### Lifecycle & Power Management

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/lifecycle/status` | `READ_ONLY` | — | Query system power save blocker and autostart state |
| `POST` | `/api/v1/lifecycle/autostart` | `ADMIN` | ✅ Yes | Configure Windows autostart on system boot |
| `POST` | `/api/v1/lifecycle/power-blocker` | `ADMIN` | ✅ Yes | Toggle Windows power save suspension blocker |

### Observability & Alerting

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/alerts` | `READ_ONLY` | — | List alert rules and system alerts |
| `POST` | `/api/v1/alerts/rules` | `ADMIN` | ✅ Yes | Create or update alert rule configuration |
| `POST` | `/api/v1/alerts/:id/resolve` | `ADMIN` | ✅ Yes | Mark an active alert as resolved |
| `POST` | `/api/v1/alerts/test-webhook` | `ADMIN` | — | Dispatch a test notification to configured webhook URL |

### Photos & Media Indexer

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/photos/timeline` | `READ_ONLY` | — | Fetch photos media timeline |
| `GET` | `/api/v1/photos/media` | `READ_ONLY` | — | Stream photo or video preview media |
| `POST` | `/api/v1/photos/favorites` | `READ_ONLY` | — | Toggle photo favorite flag |
| `POST` | `/api/v1/photos/favorite` | `READ_ONLY` | — | Toggle photo favorite flag (alias) |

### Process Supervisor & App Catalog

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/process-statuses` | `READ_ONLY` | — | Get real-time statuses for all managed processes |
| `GET` | `/api/v1/services` | `READ_ONLY` | — | List managed native services |
| `POST` | `/api/v1/services` | `ADMIN` | ✅ Yes | Register and create a new managed service |
| `POST` | `/api/v1/services/:id/start` | `OPERATOR` | ✅ Yes | Start managed service process |
| `POST` | `/api/v1/services/:id/stop` | `OPERATOR` | ✅ Yes | Stop managed service process |
| `POST` | `/api/v1/services/:id/restart` | `OPERATOR` | ✅ Yes | Restart managed service process |
| `GET` | `/api/v1/services/:id/logs` | `READ_ONLY` | — | Get service log history |
| `DELETE` | `/api/v1/services/:id` | `ADMIN` | ✅ Yes | Delete and unregister a managed service |
| `GET` | `/api/v1/catalog` | `READ_ONLY` | — | List declarative app catalog recipes |
| `POST` | `/api/v1/catalog/install` | `OPERATOR` | ✅ Yes | One-click install from catalog recipe |

### Security Audit Stream

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/audit/logs` | `ADMIN` | — | Query immutable security audit logs |

### Storage Volumes & Contained File Streaming

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/files/list` | `READ_ONLY` | — | List files in storage directory |
| `GET` | `/api/v1/files/download` | `READ_ONLY` | — | Download a stored file |
| `GET` | `/api/v1/files/content` | `READ_ONLY` | — | Read text content of a file in storage |
| `POST` | `/api/v1/files/upload` | `OPERATOR` | ✅ Yes | Upload a file to storage |
| `POST` | `/api/v1/files/mkdir` | `OPERATOR` | ✅ Yes | Create a new folder in storage |
| `POST` | `/api/v1/files/rename` | `OPERATOR` | ✅ Yes | Rename a file or folder in storage |
| `DELETE` | `/api/v1/files/delete` | `ADMIN` | ✅ Yes | Delete a file or folder from storage |
| `POST` | `/api/v1/files/delete` | `ADMIN` | ✅ Yes | Delete a file or folder from storage (POST alternative) |
| `GET` | `/api/v1/files/stream` | `READ_ONLY` | — | Stream video/audio with HTTP 206 Byte-Range support |
| `GET` | `/api/v1/storage/volumes` | `READ_ONLY` | — | List discovered Windows storage volumes and free space |
| `POST` | `/api/v1/storage/volumes/refresh` | `ADMIN` | ✅ Yes | Trigger scan and refresh of Windows storage volumes |
| `GET` | `/api/v1/storage/mounts` | `READ_ONLY` | — | List service storage mounts and directory junctions |
| `POST` | `/api/v1/storage/mounts` | `ADMIN` | ✅ Yes | Create tiered service mount with NTFS junction |
| `GET` | `/api/v1/storage/usage` | `READ_ONLY` | — | Get cached storage usage breakdown and alerts |

### System & Health Telemetry

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/health` | `Public` | — | Public system health probe |
| `GET` | `/api/v1/system-info` | `READ_ONLY` | — | Host hardware and network interfaces telemetry |
| `GET` | `/api/v1/bootstrap-steps` | `READ_ONLY` | — | Retrieve initial server bootstrapping progress steps |
| `POST` | `/api/v1/ping-database` | `READ_ONLY` | — | Test database connectivity roundtrip latency |
| `GET` | `/api/v1/system/health` | `Public` | — | Deep per-component system health report |
| `GET` | `/api/v1/system/metrics` | `READ_ONLY` | — | Real-time and historical CPU, memory, and disk metrics |

### Tailscale Mesh Networking

| Method | Path | Min Role | Audited | Summary |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/tailscale/status` | `READ_ONLY` | — | Query Tailscale mesh connection status and IP |
| `POST` | `/api/v1/tailscale/connect` | `ADMIN` | ✅ Yes | Connect node to Tailscale tailnet using auth key |
| `POST` | `/api/v1/tailscale/disconnect` | `ADMIN` | ✅ Yes | Disconnect node from Tailscale tailnet |

---

## Standard Error Envelope

All API errors return a uniform JSON envelope preventing internal stack trace leakage:

```json
{
  "error": "Descriptive error message",
  "code": "ERROR_CODE",
  "message": "Descriptive error message"
}
```

Common Error Codes:
- `400 BAD_REQUEST` / `INVALID_PARAM`: Missing or schema-violating request body.
- `401 UNAUTHORIZED`: Missing or expired Bearer token / invalid API key.
- `403 FORBIDDEN`: Caller role does not meet endpoint `minRole` requirement.
- `404 NOT_FOUND`: Target entity (service, app, volume, backup) not found.
- `429 TOO_MANY_REQUESTS`: Rate limiter / login throttle triggered (includes `Retry-After` header).
- `503 SERVICE_UNAVAILABLE`: Subsystem health check failed or circuit breaker tripped.

---

## OpenAPI 3.0 Export

A live JSON export of this complete contract is served directly by the running daemon at:
```
GET /api/v1/openapi.json
```
