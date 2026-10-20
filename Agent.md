# Agent.md — Ownbase Memory & Engineering Context

> **Rule for AI Agents**: Always consult and update this memory document whenever state, architecture, conventions, or key findings change. Keep task tracking updated in `TODO.md`.

---

## 1. Project Overview & Architecture

- **Project Name**: Ownbase (*Native Windows Server Hub*, prototype repo `native-windows-server-prototype`)
- **Primary Goal**: Turn Windows into a high-performance, standalone, native server & PaaS without Docker or WSL2.
- **Operating System Target**: Windows 10 (22H2+) and Windows 11 (x64).
- **Core PRD Reference**: [UPGRADE_PRD.md](file:///c:/Projects/native-windows-server-prototype/UPGRADE_PRD.md) (comprehensive 9-phase master plan).

### Architecture Topology
```
[Clients] Browser / LAN / Mobile / Electron Thin Client
   │
   ▼ (Port 80 / 443)
[Edge Ingress] Caddy Reverse Proxy (Native binary / tools/mocks/caddy_server.cs)
   │
   ├──► Host: localhost / 127.0.0.1  ──► Ownbase Daemon Gateway (:3001) [Next.js Static UI + REST API]
   ├──► Host: files.localhost         ──► FileBrowser (:8080)
   ├──► Host: photos.localhost        ──► Photos Engine via Daemon (:3001/photos)
   ├──► Host: ai.localhost            ──► Ollama AI Hub (:11434)
   └──► Host: s3.localhost            ──► MinIO S3 Object Storage (:9000)

[Daemon Core] (src/daemon/) — Headless Windows Service (WinSW)
   ├── WebApiServer (127.0.0.1:3001) — Loopback only
   ├── PostgreSQL 16 (127.0.0.1:5432) — SCRAM-SHA-256 authenticated
   ├── Prisma ORM — Bundled migrations (NO db push)
   ├── Process Supervisor — Native process tree lifecycle
   └── Structured Logger — JSON rotation + event bus
```

---

## 2. Key Architecture Decisions (ADR Summary)

| Decision | Summary | Rule |
| :--- | :--- | :--- |
| **D1** | Bundled Node 24 LTS | All backend scripts & daemon run on Node LTS. |
| **D2** | Service Wrapper: WinSW | Daemon runs as a 24/7 background Windows Service (`NT SERVICE\Ownbase`). |
| **D3** | Port 3001 Loopback Only | `src/daemon` binds strictly to `127.0.0.1:3001`. Caddy (:80/:443) is the sole external listener. |
| **D4** | Windows Job Objects | Native processes grouped under Job Objects with `KILL_ON_JOB_CLOSE` and memory/CPU limits. |
| **D5** | Dynamic Host Routing | Intent-based host building (`*.localhost`, `*.<lan-ip>.nip.io`, `*.ts.net`). |
| **D6** | Hardened Postgres | Loopback only, SCRAM-SHA-256 authentication, safe stale `postmaster.pid` verification. |
| **D7** | Auth Architecture | Argon2id, JWT access token (15m), rotating refresh token (30d), SHA-256 API keys. |
| **D8** | First-Run Provisioning | Setup allowed only from loopback or with a one-time admin setup token. |

---

## 3. Directory Layout & Critical Constraints

```
src/
  ├── daemon/             <-- STRICTLY ZERO ELECTRON IMPORTS (enforced by zero-electron.test.ts)
  │     ├── core/         paths, config, logger, secrets, power
  │     ├── auth/         guard, authService, throttle, setup, audit
  │     ├── db/           postgres, prisma, migrate
  │     ├── supervisor/   supervisor process tree management
  │     ├── network/      caddy, tailscale
  │     └── gateway/      httpServer (REST API & static Next.js frontend serving)
  ├── electron/           <-- Thin client: Window, tray, power blocker, launches daemon URL
  ├── app/                <-- Next.js 14 Dashboard UI (static export `output: export`)
  ├── components/         <-- Modular React UI components
  └── shared/             <-- Contract schemas, OpenAPI, shared types, apiClient.ts
tools/mocks/              <-- Lightweight C# server simulators for rapid dev / CI
extraResources/bin/       <-- Native Windows binaries (caddy.exe, filebrowser.exe, minio.exe, ollama.exe)
```

> [!CAUTION]
> **Zero Electron Rule**: Under no circumstances should any file inside `src/daemon/**` import `electron` or `electron/*`. This is continuously checked by `tests/phase2/zero-electron.test.ts`.

---

## 4. Memory Log: Critical Fixes & Hard-Earned Insights

### 1. Reverse Proxy Port 80 Socket Binding
- **Issue**: Mock `caddy.exe` only listened on port 2019 for the Admin API; port 80 was unopened, causing `ERR_CONNECTION_REFUSED` in browsers.
- **Solution**: Updated `tools/mocks/caddy_server.cs` with an active `TcpListener` on port 80. It reads the HTTP `Host` header and transparently pipes bidirectional TCP streams to target services (`files.` &rarr; 8080, `ai.` &rarr; 11434, `s3.` &rarr; 9000, `photos.` &rarr; 3001, default &rarr; 3001). Recompiled with `.NET 4.0 csc.exe`.
- **Handling HEAD Probes**: In .NET `HttpListener`, writing to `res.OutputStream` on a `HEAD` request throws `ProtocolViolationException`. `tools/mocks/ollama_server.cs` was patched to check `isHead` before writing response bodies.

### 2. Client Auth Token Persistence & Mount Race Condition
- **Issue**: Refreshing the browser or starting the dev server showed the user as "logged in" in the header, but all services displayed `0/0` and failed. Signing out and in fixed it.
- **Root Cause**:
  1. `inMemoryAccessToken` was held strictly in memory and wiped on page reload, while `ownbase_user` was stored in `localStorage`.
  2. `fetchAllData()` fired immediately on mount without an access token, getting `401 Unauthorized` across all endpoints.
  3. `fetchWithAuth()` had `if (res.status === 401 && inMemoryAccessToken)`, skipping auto-refresh if `inMemoryAccessToken` was null.
  4. Concurrent 401s triggered multiple `/api/v1/auth/refresh` requests with the same token, causing database token reuse detection to revoke all sessions.
- **Solution**:
  - `authStore` in `src/shared/apiClient.ts` now persists `ownbase_access_token` and `ownbase_refresh_token` in `localStorage`.
  - Added a singleton promise mutex (`activeRefreshPromise`) so concurrent requests share a single `/api/v1/auth/refresh` call.
  - In `src/app/page.tsx`, mount checks for both `initialUser` and `initialToken`. If missing, `restoreSession()` is awaited before fetching data; if restoration fails, `currentUser` is set to `null` cleanly.

### 3. Database Migration Policy
- **No `db push`**: As per Phase 2 Decision P11, fallback to `prisma db push` is removed. Migrations must use bundled `prisma migrate deploy` or fail loudly into degraded mode.

---

## 5. Verification Commands

Always run these before completing any phase or major task:
```powershell
# 1. Full Vitest test suite (All 17 suites, 69 tests must pass)
npm test

# 2. Phase 2 specific tests
npm run test:phase2

# 3. TypeScript compilation for Electron & Daemon
npm run build:electron

# 4. Compile mock binaries (when tools/mocks/*.cs is modified)
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:extraResources\bin\caddy.exe /target:exe tools\mocks\caddy_server.cs
```
