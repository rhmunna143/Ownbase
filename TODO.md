# TODO.md — Ownbase Task Tracker & Roadmap

> **Task Tracker**: Maintained and updated across development phases according to [UPGRADE_PRD.md](file:///c:/Projects/native-windows-server-prototype/UPGRADE_PRD.md).

---

## 🚀 Current Status: Phase 2 Completed & Verified &bull; Ready for Phase 3

| Phase | Title | Status | Primary Outcome |
| :---: | :--- | :---: | :--- |
| **Phase 0** | Baseline, Spikes, Hygiene | ✅ Completed | Failing red-tests, ADR decisions, hygiene cleanup |
| **Phase 1** | Security Core | ✅ Completed | Authenticated API, RBAC guard, Argon2id, path containment |
| **Phase 2** | Headless Daemon | ✅ Completed | Zero Electron in daemon, WinSW service packaging, Caddy port 80 proxy |
| **Phase 3** | Supervisor & Sandboxing | 🟡 Next Up | Windows Job Objects, process tree limits, health checks, event stream |
| **Phase 4** | Deployment Engine & Catalog | ⚪ Backlog | Git/zip to running app, recipes, app catalog |
| **Phase 5** | Ingress, Storage, Media | ⚪ Backlog | Multi-host routing, TLS, volumes, RFC 7233 byte-range streaming |
| **Phase 6** | Web Terminal & Real Services | ⚪ Backlog | ConPTY terminal, official binaries replacing simulators |
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

## Phase 3: Supervisor & Sandboxing (Next Up) 🟡
- [ ] **3.1**: Build `ownbase-jobhost.exe` (Go launcher) implementing Windows Job Objects:
  - `JOB_OBJECT_LIMIT_JOB_MEMORY` (whole tree memory limit)
  - `JOB_OBJECT_CPU_RATE_CONTROL` (hard CPU quota)
  - `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (zero orphaned grandchild processes)
- [ ] **3.2**: Refactor `src/daemon/supervisor/supervisor.ts` to execute child processes through `ownbase-jobhost.exe`
- [ ] **3.3**: Configurable restart policies (`always`, `on-failure`, `never`) with exponential backoff & crash loops detection
- [ ] **3.4**: Health check probers (HTTP status code, TCP ping, process alive check) with status reporting
- [ ] **3.5**: Event-driven WebSocket stream (`/api/v1/events`) replacing 8-second frontend polling
- [ ] **3.6**: Supervisor state persistence and crash recovery in PostgreSQL

---

## Phase 4: Deployment Engine & App Catalog ⚪
- [ ] **4.1**: Portable runtime manager (Node 24 LTS, Python 3.12, Go 1.22)
- [ ] **4.2**: Standard recipe format (`recipe.json`) specifying build/run commands, ports, and env vars
- [ ] **4.3**: Archive unpacker & deployment pipeline with atomic release swapping (`current` symlink/junction)
- [ ] **4.4**: 1-Click App Store catalog with one-click install/uninstall
- [ ] **4.5**: Rollback engine for failed deployments

---

## Phase 5: Ingress, Storage & Media ⚪
- [ ] **5.1**: Dynamic HostBuilder generating scoped hostnames (`*.localhost`, `*.<lan-ip>.nip.io`, `*.ts.net`)
- [ ] **5.2**: Automatic Let's Encrypt / ZeroSSL TLS certificates for custom domains
- [ ] **5.3**: Tailscale HTTPS certificates (`ts.net`) via Caddy integration
- [ ] **5.4**: Multi-volume storage manager supporting secondary drives (D:\, E:\)
- [ ] **5.5**: RFC 7233 byte-range streaming engine with streaming uploads (no RAM exhaustion)
- [ ] **5.6**: Photos background indexer with thumbnail caching (`sharp`, WebP)

---

## Phase 6: Web Terminal & Real Services ⚪
- [ ] **6.1**: Replace `filebrowser.exe` mock simulator with official pinned FileBrowser release
- [ ] **6.2**: Replace `ollama.exe` mock simulator with official Ollama Windows binary
- [ ] **6.3**: Replace `minio.exe` mock simulator with official MinIO / S3 binary
- [ ] **6.4**: Enforce gateway authentication (forward-auth) on Ollama and FileBrowser LAN routes
- [ ] **6.5**: Audited ConPTY web terminal (`node-pty` + `xterm.js`) restricted to ROOT users

---

## Phase 7: Integration & Hardening ⚪
- [ ] **7.1**: Playwright end-to-end regression test suite on Windows 10 & 11
- [ ] **7.2**: Automated OWASP ASVS L1 security audit & penetration tests
- [ ] **7.3**: Automated database backup job (`pg_dump`) with one-click restore
- [ ] **7.4**: Observability dashboard with CPU/RAM metrics and alert webhooks

---

## Phase 8: Packaging & Evaluation ⚪
- [ ] **8.1**: Production NSIS installer bundle (`npm run build:installer`)
- [ ] **8.2**: Zero-install standalone portable zip bundle (`npm run build:portable`)
- [ ] **8.3**: Clean VM validation on Windows 10 (22H2) and Windows 11
- [ ] **8.4**: Final documentation, user manual, and benchmarks report
