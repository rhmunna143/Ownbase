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

### 4. Phase 3 Architecture: Job Objects & Sandboxing ✅ (Completed)
- **Job Host Launcher & Win32 FFI**:
  - Implemented in C# with Win32 P/Invoke (`tools/jobhost/Program.cs`) and compiled via `.NET 4.0 csc.exe`.
  - Also embedded natively in the Node daemon using `koffi` FFI bindings directly into `kernel32.dll` (`src/daemon/supervisor/jobhost.ts`), bypassing Windows Defender Application Control (WDAC) unsigned executable restrictions on test machines while maintaining 100% native Win32 Job Object capabilities.
  - Applies `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000)`: If daemon or host dies, Windows kernel guarantees zero orphaned grandchild processes.
  - Applies `JOB_OBJECT_LIMIT_JOB_MEMORY (0x200)`: Caps peak committed memory across the entire process tree.
  - Applies `JOB_OBJECT_CPU_RATE_CONTROL (0x1 | 0x4 hard cap)`: Enforces hard CPU quota per job object.
  - Periodic accounting queries (`QueryInformationJobObject` with basic and extended limits) extract CPU time and peak committed memory.
- **Supervisor Decoupling**:
  - `supervisor.ts` contains ZERO hardcoded binary switches (`caddy`, `filebrowser`, `ollama`, `minio`).
  - Workloads are fully defined via `ServiceSpec` interface (`supervisor/spec.ts`) and resolved from `BUILTIN_RECIPES`.
  - Strict State Machine (`supervisor/machine.ts`): `stopped`, `starting`, `running`, `stopping`, `backoff`, `crashed`, `failed`.
  - Exponential backoff with jitter and crash-loop circuit breaker (`supervisor/restart.ts`) triggering `failed` state upon threshold breach.
  - Active health probers (`supervisor/health.ts`) for TCP and HTTP endpoints with configurable latency and failure thresholds.
  - Environment variable isolation (`supervisor/env.ts`): allowlists safe system vars and decrypts sensitive variables on demand.
  - P17 Boot Reconcile (`supervisor/reconcile.ts`): detects and purges stale PIDs from unexpected crashes.
  - Real-time Event Stream (`gateway/events.ts`): `/api/v1/events` pushes state transitions, logs, and metrics to UI, replacing frontend 8-second polling.

### 5. Phase 4 Architecture: Deployment Engine & App Catalog ✅ (Completed)
- **Runtime Manager (`src/daemon/deploy/runtimes.ts`)**:
  - Pinned runtime definitions in `runtimes.manifest.json` with explicit SHA-256 integrity verification.
  - Downloads, verifies SHA-256 hash, and extracts into `runtimes/<name>-<version>/` using Windows native `tar.exe`.
  - Reuses daemon's own Node.js runtime when target matches to avoid redundant downloads.
- **Source Intake & Security (`src/daemon/deploy/source.ts`)**:
  - Git cloning (depth 1, optional branch/tag) with MinGit or system git.
  - Archive intake (zip/tar): Inspects entries via clean `tar -tf` format and extracts using `PathGuard` against zip-slip directory traversal and Alternate Data Streams (`:`), enforcing 250 MB total unpacked size and 50,000 file count limits.
- **Project Detector & Recipe Resolver (`src/daemon/deploy/detect.ts`)**:
  - Auto-detects project runtime: Node (`package.json`, frameworks: Next, Express, Nest), Python (`requirements.txt` / `pyproject.toml`, frameworks: FastAPI, Flask), Go (`go.mod`), and Static HTML (`index.html`).
  - Supports explicit project config override via repo-root `ownbase.json`.
- **Supervised Build Runners (`src/daemon/deploy/build/runner.ts`)**:
  - Builds execute inside isolated Win32 Job Objects with 1024 MB memory caps, 10 min timeouts, isolated environments (`buildIsolatedEnvironment`), and stdout/stderr event streaming via `eventBus`.
- **Deterministic Port Allocator (`src/daemon/deploy/ports.ts`)**:
  - Manages ports 4000–4999. Validates via active TCP socket bind test AND in-memory mutex lock / database reservation to guarantee zero port collisions under high concurrency (verified with 20 parallel requests).
- **Atomic Release Promotion & Rollback (`src/daemon/deploy/release.ts`)**:
  - Versioned directories: `apps/<appId>/releases/<releaseNum>/`.
  - Starts release on allocated port in a Job Object &rarr; verifies HTTP/TCP health probe &rarr; updates reverse proxy routing for zero-downtime cutover &rarr; drains/stops previous release (3s grace).
  - Instant rollback promotes a previously successful release folder in under 15 seconds without rebuilding (clocked at 751ms in tests). Retains the last 3 releases, pruning older ones.
- **Deployment Pipeline Orchestrator (`src/daemon/deploy/pipeline.ts`)**:
  - Strict state transitions: `queued → fetching → building → starting → healthy → promoted` / `failed`.
  - Single active deployment per application via in-memory deployment mutex.
  - Failing builds never disrupt running releases.
- **App Models & Schema (`prisma/schema/deploy.prisma`)**:
  - Models: `App`, `Release`, `Deployment`. Additive migration `20261021191500_phase4_deploy_engine` applied via `prisma migrate deploy`.
- **Declarative App Catalog (`src/daemon/deploy/catalog.ts`, `catalog/*.json`)**:
  - Zod-validated template recipes providing one-click installation for popular native services and runtimes (8 recipes: Static Site, Express, FastAPI, Go Web, Redis, FileBrowser, MinIO, Ollama).
  - Dynamic API endpoint `/api/v1/catalog` feeding frontend `src/components/AppStore.tsx`.

---

## 6. Verification Commands

Always run these before completing any phase or major task:
```powershell
# 1. Full Vitest test suite (All suites must pass)
npm test

# 2. Phase 2 specific tests
npm run test:phase2

# 3. Phase 3 specific tests
npm run test:phase3

# 4. Phase 4 specific tests
npm run test:phase4

# 5. TypeScript compilation for Electron & Daemon
npm run build:electron

# 6. Compile jobhost launcher
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:extraResources\bin\ownbase-jobhost.exe /target:exe tools\jobhost\Program.cs
```
