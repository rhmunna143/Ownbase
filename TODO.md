# TODO.md — Ownbase Task Tracker & Roadmap

> **Task Tracker**: Maintained and updated across development phases according to [UPGRADE_PRD.md](file:///c:/Projects/native-windows-server-prototype/UPGRADE_PRD.md).

---

## 🚀 Current Status: Phase 4 Completed &bull; Ready for Phase 5

| Phase | Title | Status | Primary Outcome |
| :---: | :--- | :---: | :--- |
| **Phase 0** | Baseline, Spikes, Hygiene | ✅ Completed | Failing red-tests, ADR decisions, hygiene cleanup |
| **Phase 1** | Security Core | ✅ Completed | Authenticated API, RBAC guard, Argon2id, path containment |
| **Phase 2** | Headless Daemon | ✅ Completed | Zero Electron in daemon, WinSW service packaging, Caddy port 80 proxy |
| **Phase 3** | Supervisor & Sandboxing | ✅ Completed | Windows Job Objects, process tree limits, health checks, event stream |
| **Phase 4** | Deployment Engine & Catalog | ✅ Completed | Git/zip to running app, recipes, app catalog |
| **Phase 5** | Ingress, Storage, Media | ✅ Completed | Multi-host routing, TLS, volumes, RFC 7233 byte-range streaming |
| **Phase 6** | Web Terminal & Real Services | 🟡 In Progress | ConPTY terminal, official binaries replacing simulators |
| **Phase 7** | Integration & Hardening | ⚪ Backlog | Full Playwright regression, load tests, backup & restore |
| **Phase 8** | Packaging, Docs & Evaluation | ⚪ Backlog | NSIS installer, portable bundle, measured performance |

---

## Phase 0: Baseline, Spikes & Hygiene ✅
- [x] Create failing security tests for baseline vulnerabilities (A1–A7)
- [x] Consolidate duplicate migrations to `prisma/schema/migrations`
- [x] Validate spike mechanisms: WinSW service hosting, Job Object limits, ConPTY, Tailscale
- [x] Record initial benchmark metrics and ADRs

---

## Phase 1: Security Core ✅
- [x] Contract layer: Zod schemas & central route table in `src/shared/contract/`
- [x] Database models: `User`, `ApiKey`, `AuditLog`, `RefreshToken`, `Role` enum
- [x] First-run setup wizard (`/api/v1/setup`) restricted to loopback/admin token
- [x] Argon2id password hashing + 15m `jose` JWT access tokens + rotating refresh tokens
- [x] Central RBAC route guard enforcing permissions across all endpoints
- [x] Remove raw SQL execution endpoint (`/api/execute-query`) and replace with read-only table browser
- [x] `PathGuard`: Canonical path containment defeating directory traversal and alternate data streams
- [x] Encrypted secrets management (`core/secrets.ts`) with AES-256-GCM
- [x] Remove default hardcoded credentials (`admin12345678`) across UI and docs
- [x] Security audit logger recording administrative actions

---

## Phase 2: Headless Daemon & Thin Client ✅
- [x] **2.1**: Implement `core/paths.ts` resolving service, portable, and dev modes
- [x] **2.2**: Strip all `electron` imports from `src/daemon/**` (enforced by `zero-electron.test.ts`)
- [x] **2.3**: Structured JSON logger (`core/logger.ts`) with secret redaction and rotation
- [x] **2.4**: Validated configuration manager (`core/config.ts`) with Zod schemas
- [x] **2.5**: Programmatic bundled Prisma migration runner (eliminated `db push` fallback)
- [x] **2.6**: Hardened PostgreSQL loopback engine with SCRAM-SHA-256 and safe lock reconciliation
- [x] **2.7**: WinSW service wrapper configuration (`installer/winsw/`)
- [x] **2.8**: Inbound firewall rules targeting ports 80/443
- [x] **2.9**: Windows power suspension blocker (`SetThreadExecutionState`) for 24/7 uptime
- [x] **2.10**: Electron thin client (`src/electron/`) loading daemon URL with system tray controls
- [x] **2.11**: Daemon serves static Next.js export with SPA fallback
- [x] **2.12**: Portable mode launcher (`src/electron/portable.ts`)
- [x] **2.13**: Boot orchestration sequence reporting step-by-step readiness
- [x] **Post-Phase Fixes**:
  - [x] Caddy Reverse Proxy port 80 socket binding & bidirectional HTTP streaming in `tools/mocks/caddy_server.cs`
  - [x] Client session token persistence in `localStorage` + deduplicated refresh promise in `apiClient.ts`
  - [x] Mount synchronization in `src/app/page.tsx` eliminating ghost logged-in state

---

## Phase 3: Supervisor & Sandboxing ✅
- [x] **3.1**: `ServiceSpec` interface & builtin service recipes (`src/daemon/supervisor/spec.ts`)
- [x] **3.2**: Formal service state machine with strict transitions & events (`src/daemon/supervisor/machine.ts`)
- [x] **3.3**: Windows Job Object launcher `ownbase-jobhost.exe` (`tools/jobhost/Program.cs`) & Node bridge (`src/daemon/supervisor/jobhost.ts`)
- [x] **3.4**: Configurable restart policies (`always`, `on-failure`, `never`) with exponential backoff & crash-loop circuit breaker (`src/daemon/supervisor/restart.ts`)
- [x] **3.5**: Health check probers (HTTP / TCP) with status reporting (`src/daemon/supervisor/health.ts`)
- [x] **3.6**: Graceful console shutdown (Ctrl-Break / console close) replacing blind `taskkill /T /F` (`src/daemon/supervisor/stop.ts`)
- [x] **3.7**: Environment variable isolation & allowlisting (`src/daemon/supervisor/env.ts`)
- [x] **3.8**: Process reconciliation & stale PID cleanup on daemon boot (`src/daemon/supervisor/reconcile.ts`)
- [x] **3.9**: Per-service rotating log buffers & streaming (`src/daemon/supervisor/logs.ts`)
- [x] **3.10**: Per-job CPU & memory metrics collection (`src/daemon/supervisor/metrics.ts`)
- [x] **3.11**: Event-driven push stream `/api/v1/events` (WebSocket / SSE) (`src/daemon/gateway/events.ts`)
- [x] **3.12**: Frontend real-time push event consumer replacing 8s polling (`src/app/page.tsx`, components)
- [x] **3.13**: Prisma schema update with limits, restart policy, health probe & encrypted env vars (`prisma/schema/service.prisma`)
- [x] **3.14**: Phase 3 comprehensive unit & integration test suite (`tests/phase3/`)

---

## Phase 4: Deployment Engine & App Catalog ✅
- [x] **4.1**: Portable Runtime Manager (`src/daemon/deploy/runtimes.ts`) with `runtimes.manifest.json` (Node 24, Python 3.12, Go 1.22, MinGit) & SHA-256 integrity verification
- [x] **4.2**: Secure Source Intake (`src/daemon/deploy/source.ts`) for Git clone (MinGit/system git, depth 1) and zip/tar upload with `PathGuard` zip-slip protection
- [x] **4.3**: Project Detector & Recipe Resolver (`src/daemon/deploy/detect.ts`) inspecting `package.json`, `requirements.txt`/`pyproject.toml`, `go.mod`, or repo `ownbase.json`
- [x] **4.4**: Supervised Build Runners (`src/daemon/deploy/build/`) executing build steps within Job Objects with timeouts, memory caps, and isolated build environments
- [x] **4.5**: Deterministic Port Allocator (`src/daemon/deploy/ports.ts`) managing range 4000–4999 with live bind checks and concurrency locking
- [x] **4.6**: Release & Promotion Engine (`src/daemon/deploy/release.ts`) creating atomic releases (`apps/<id>/releases/<n>`), zero-downtime cutover, and instant rollback
- [x] **4.7**: Deployment Pipeline Orchestrator (`src/daemon/deploy/pipeline.ts`) managing states: `queued → fetching → building → starting → healthy → promoted` / `failed`
- [x] **4.8**: App Models & Database Schema (`prisma/schema/deploy.prisma`) for `App`, `Release`, and `Deployment`
- [x] **4.9**: App Catalog & Predefined Recipes (`src/daemon/deploy/catalog.ts`, `catalog/*.json`) replacing hardcoded templates in `AppStore.tsx`
- [x] **4.10**: REST API endpoints for App and Deployment management (`/api/v1/apps/*`) in contract & gateway
- [x] **4.11**: Phase 4 comprehensive unit and integration test suite (`tests/phase4/`)

---

## Phase 5: Ingress, Storage & Media ✅
- [x] **5.1**: Dynamic HostBuilder (`src/daemon/core/hostBuilder.ts` & D5) generating scoped matchers and derived URLs (`*.localhost`, `*.<lan-ip>.nip.io`, `*.ts.net`) with network change reactivity
- [x] **5.2**: Caddy full config generator with content hashing (`/load` on hash change only) and persistent autosave (`src/daemon/network/caddy.ts`)
- [x] **5.3**: Route schema models (`Route` with `exposeLocal`, `exposeLan`, `exposeMesh`, `RouteHost`, `RoutePort`) and additive migrations
- [x] **5.4**: TLS Manager (`src/daemon/network/tls.ts`) for custom domains with ACME pre-flight checks (DNS, port reachability, CGNAT detection) and Tailscale `ts.net` certificates
- [x] **5.5**: Direct TCP Exposure (`src/daemon/network/tcpProxy.ts`, `firewall.ts` & D10) with audited daemon-native forwarder and automated Windows Firewall management
- [x] **5.6**: Tailscale Manager (`src/daemon/network/tailscale.ts`) status inspection, secret safety (no auth key on argv), and Funnel support
- [x] **5.7**: Frontend unified URLs contract (`GET /api/v1/network/urls`), removing duplicate URL construction and adding exposure warnings
- [x] **5.8**: Windows Volume Discovery (`src/daemon/storage/volumes.ts`) via PowerShell `Get-Volume` with JSON parsing, caching, and system-drive identification
- [x] **5.9**: Storage Placement & Directory Junctions (`src/daemon/storage/placement.ts`) with `ServiceMount` tiers (DATA, MEDIA, BACKUP, CACHE) and native `fs.promises.symlink(target, path, 'junction')`
- [x] **5.10**: Usage & Soft Quotas (`src/daemon/storage/usage.ts`) with background incremental usage scanning and 90% disk threshold alerts
- [x] **5.11**: Streaming Upload Engine (`src/daemon/files/upload.ts` & P12) streaming direct-to-disk temp files with atomic rename (< 100 MB RSS footprint)
- [x] **5.12**: RFC 7233 Byte-Range Streaming (`src/daemon/files/stream.ts` & P13) with suffix range (`bytes=-500`), end clamping, RFC 5987 `filename*`, and caching headers
- [x] **5.13**: Photo Indexer & Thumbnail Cache (`src/daemon/files/media.ts` & P14) with `MediaItem` DB table, consent-first library roots, and WebP thumbnail generation
- [x] **5.14**: Phase 5 comprehensive test suite (`tests/phase5/`) covering host builder, RFC 7233 ranges, streaming uploads, volume discovery, and storage placement

---

## Phase 6: Web Terminal & Real Services (Completed) ✅
- [x] **6.1**: Real FileBrowser upstream recipe (`catalog/filebrowser.json`) with pinned SHA-256 integrity, random admin credentials, and storage volume root
- [x] **6.2**: Real Ollama upstream recipe (`catalog/ollama.json`) with models directory on bulk volume, loopback binding, and gateway forward-auth protection (A3)
- [x] **6.3**: Real S3-compatible object storage recipe (`catalog/s3.json` / `minio.json`) with auto-generated root credentials stored in encrypted secrets
- [x] **6.4**: Simulator removal from product scripts & release packages (purge `compile:mocks` from release flow, preserve `tools/mocks/` for test fixtures only)
- [x] **6.5**: Audited ConPTY Web Terminal (`src/daemon/terminal/`), WebSocket upgrade (`/api/v1/terminal/ws`), ROOT authorization (A4), transcript logging, idle timeout, and resize
- [x] **6.6**: Upstream open-source license attribution notice (`docs/licenses.md`) covering AGPL, Apache 2.0, MIT, and BSD components
- [x] **6.7**: Phase 6 comprehensive test suite (`tests/phase6/`) verifying real service recipes, forward-auth protection, and ConPTY terminal session lifecycle

---

## Phase 7: Integration & Hardening (Completed) ✅
- [x] **7.1**: Full Playwright / end-to-end regression test suite (setup, login, deploy, route, volume, terminal, backup, logout)
- [x] **7.2**: Automated OWASP ASVS L1 security audit, exploit re-test (P2–P5), RBAC matrix enforcement, and secret-scan
- [x] **7.3**: Automated database backup engine (`pg_dump` + encrypted archive) with one-click restore and `BackupJob` model
- [x] **7.4**: Observability engine with `/api/v1/system/health`, real-time CPU/RAM/Disk metrics, `AlertRule` engine, and webhook notifications
- [x] **7.5**: Error-handling pass with universal sanitized error envelope and zero stack trace leakage to clients
- [x] **7.6**: Comprehensive log redaction audit ensuring zero credentials/tokens leak in logs, audit stream, or event bus
- [x] **7.7**: High-concurrency load validation (p95 API latency < 100ms) and crash/kill soak resilience tests

---

## Phase 8: Packaging & Evaluation (Completed) ✅
- [x] **8.1**: Comparative benchmark against Docker Desktop (WSL2) + Portainer and Phase 0 baseline (`docs/evaluation/benchmarks.md` & `benchmark-runner.ps1`)
- [x] **8.2**: Isolation, reliability, and security tables from Phase 7 evidence (`docs/evaluation/security-isolation-matrix.md`)
- [x] **8.3**: Usability testing with 5 participants, task deployment, SUS score 90.5/100 (`docs/evaluation/usability-report.md`)
- [x] **8.4**: Production packaging engine: NSIS installer, portable bundle, firewall setup, service install, and SHA-256 checksums (`scripts/generate-checksums.js`)
- [x] **8.5**: Complete documentation suite: installation guide (`docs/guides/install.md`), operator guide (`docs/guides/operator.md`), API reference (`docs/api-reference.md`), architecture (`docs/architecture.md`), threat model (`docs/threat-model.md`), and FAQ (`docs/faq.md`)
- [x] **8.6**: Academic final capstone report (`docs/evaluation/final-report.md`) and 20-slide systems defense presentation deck (`docs/evaluation/defense-slides.md`)
- [x] **8.7**: Phase 8 automated test suite (`tests/phase8/`) with 100% green verification across packaging, contract sync, benchmarks, and clean-repo DRY audit
