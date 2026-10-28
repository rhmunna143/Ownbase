# Security, Isolation & Reliability Matrix (Proposal §14 & PRD §8.2)

**Document Version:** 1.0.0  
**Status:** Validated against Phase 7 Regression Evidence  
**Scope:** Comparative security analysis between Ownbase Native Windows Server, Docker Desktop on Windows, and Traditional Unmanaged Windows Services.

---

## 1. Multi-Dimensional Isolation Matrix

| Isolation Dimension | Traditional Windows Services | Docker Desktop (WSL2 Backend) | Ownbase Native Architecture (`v1.0.0-rc1`) |
| :--- | :--- | :--- | :--- |
| **Compute / Memory Bounds** | None. A memory leak or CPU spin crashes the host or exhausts physical RAM. | Linux cgroups in WSL2 VM. Virtual machine allocation is heavy and static. | **Windows Job Objects (`JOBOBJECT_EXTENDED_LIMIT_INFORMATION`)**: Enforces hard commit memory limits and CPU rate limits per process tree via `ownbase-jobhost.exe`. |
| **Process Tree Termination** | Orphan child processes linger as zombies when parent terminates. | Container engine signals PID 1. Orphaned child processes inside container can remain if init is missing. | **`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`**: Closing Job Object handle atomically terminates the entire process tree without leaving zombie processes. |
| **Network Attack Surface** | Binds services directly to `0.0.0.0`. Insecure ports exposed across local LAN and public adapters. | Exposes published container ports (`-p 8080:8080`) to all interfaces via WSL2 port proxy (`wsl.exe -d ...`). | **Loopback-Only Ingress + Caddy Edge Proxy**: All managed backends bind strictly to `127.0.0.1`. Only ports 80/443 exposed via Private Firewall profile; LAN routes guarded by forward-auth. |
| **Filesystem Security** | Direct access to entire host filesystem; vulnerable to `../../` directory traversal. | Virtualized overlay filesystem (`ext4.vhdx`). Volume mounts (`-v C:\data:/data`) can be traversed if misconfigured. | **PathGuard & Junction Jails**: Resolves real canonical paths, blocks Alternate Data Streams (`file:stream`), drive specifiers, and restricts reads/writes to declared storage roots. |
| **Secrets & Credential Store** | Stored in plaintext config files (`.env`) or registry keys. | Plaintext environment variables in `docker-compose.yml` or container inspection metadata. | **Windows DPAPI + AES-256-GCM**: Master keys protected by machine DPAPI; secrets stored encrypted in database; master disaster recovery key backup with strict warning. |
| **Terminal / Console Access** | Open PowerShell/CMD prompt with elevated system privileges. | `docker exec -it` root shell into Linux container. | **Audited ConPTY Web Terminal**: Restricted exclusively to `ROOT` role with active WebSocket auth, session idle timeouts, transcript logging, and full audit tracking. |
| **Crash Recovery & Stability** | Service manager simple restart; susceptible to infinite crash-loops consuming CPU. | `restart: unless-stopped` can enter infinite crash-restart loops. | **Formal 7-State Supervisor with Circuit Breaker**: Exponential backoff (2s, 4s, 8s, 16s, 32s) and circuit breaker tripping after 3 consecutive crashes in 60s. |

---

## 2. Comprehensive Vulnerability Resolution Register (Phase 0 -> Phase 8)

All 16 vulnerabilities and architectural limitations (P1–P16) from the Phase 0 audit have been completely remediated and verified:

| ID | Phase 0 Vulnerability / Limitation | Remediation in Ownbase Native Architecture | Verified Test Suite |
| :--- | :--- | :--- | :--- |
| **P1** | Interactive Electron GUI monolith required for server operation; terminated on logout. | Separated into headless Windows Background Service (`WinSW` / `node.exe`) running under `NT SERVICE\Ownbase`. | `tests/phase2/zero-electron.test.ts` |
| **P2** | Unauthenticated raw port exposure on 0.0.0.0 across all subsystems. | Caddy edge reverse proxy ingress; managed services bound to loopback `127.0.0.1`; firewall restricted to 80/443. | `tests/security/p2-caddy-isolation.test.ts` |
| **P3** | Unauthenticated raw SQL execution endpoint (`/api/execute-query`) allowed arbitrary SQL injection. | Purged raw SQL endpoint; replaced with parameterized Prisma ORM and sanitized TableBrowser query engine. | `tests/security/p3-sql-injection.test.ts` |
| **P4** | File management endpoints vulnerable to path traversal (`../../`) and Alternate Data Streams. | Created `PathGuard` (`src/daemon/security/pathGuard.ts`) enforcing canonical root jails and blocking ADS colons. | `tests/security/p4-path-traversal.test.ts` |
| **P5** | Hardcoded default credentials (`admin12345678`) across FileBrowser and services. | First-run setup wizard (`/api/v1/setup`), random 24-character cryptographic password generation, and DPAPI encryption. | `tests/security/p5-hardcoded-credentials.test.ts` |
| **P6** | Stale `postmaster.pid` after abnormal shutdown blocked PostgreSQL from starting. | Added stale lock detector probing process table before removing dead lock files (`src/daemon/db/postgres.ts`). | `tests/phase2/postgres.test.ts` |
| **P7** | Unmanaged child process spawns caused zombie processes and runaway resource consumption. | Windows Job Objects integration (`ownbase-jobhost.exe`) with CPU rate limits, memory commit caps, and kill-on-close. | `tests/phase3/job-objects.test.ts` |
| **P8** | Incomplete mock simulators deployed in release packages. | Purged all simulators from production release scripts; replaced with real upstream catalog recipes. | `tests/phase6/simulator-purge.test.ts` |
| **P9** | Runtime version mismatch on host machines broke user application deployments. | Isolated per-app runtimes (Node 18/20/22, Python 3.10/3.11/3.12, Go 1.21/1.22) with atomic symlink releases. | `tests/phase4/runtimes.test.ts` |
| **P10** | Unrestricted terminal command execution without authorization or auditing. | Audited ConPTY terminal engine (`src/daemon/terminal/ws.ts`) restricted to `ROOT` role with session transcripts. | `tests/phase6/terminal-auth.test.ts` |
| **P11** | File storage tied to primary C: drive without volume discovery or quotas. | Multi-drive PowerShell volume discovery (`Get-Volume`), soft quota management, and bulk storage placement. | `tests/phase5/volume-discovery.test.ts` |
| **P12** | Entire upload buffered into RAM before writing to disk, causing OOM on multi-GB files. | Streaming upload engine direct-to-disk with atomic rename; bounded memory footprint (< 100 MB RSS). | `tests/phase5/streaming-upload.test.ts` |
| **P13** | File downloads lacked RFC 7233 byte-range support, preventing smooth video seeking. | Strict RFC 7233 range parser supporting suffix ranges (`bytes=-500`), end clamping, and RFC 5987 unicode filenames. | `tests/phase5/range-stream.test.ts` |
| **P14** | Personal directory photo scanning violated user privacy. | Consent-first library root management (`MediaItem` model) with non-blocking WebP thumbnail caching. | `tests/phase5/photo-indexer.test.ts` |
| **P15** | Secrets, JWTs, and database passwords leaked in log files and audit events. | Centralized secret redactor in `Logger` stripping authorization headers, tokens, and encryption keys. | `tests/phase2/logger.test.ts` |
| **P16** | No automated disaster recovery or database backup mechanism. | Automated encrypted backup engine (`pg_dump` + AES-256-GCM + SHA-256) with one-click restore (Acceptance A2). | `tests/phase7/backup-restore.test.ts` |

---

## 3. OWASP ASVS Level 1 Compliance Verification

Ownbase Native Windows Server complies with the **OWASP Application Security Verification Standard (ASVS) v4.0.3 Level 1**:

| ASVS Section | Verification Requirement | Ownbase Implementation | Compliance Status |
| :--- | :--- | :--- | :---: |
| **V1: Architecture** | Trusted boundary definition and centralized enforcement. | Single gateway entry point with centralized `ROUTE_TABLE` and middleware guards. | **PASS** |
| **V2: Authentication** | Secure password hashing, brute-force throttling, session revocation. | Argon2id password hashing, token bucket login throttling (`LoginThrottle`), and refresh token rotation. | **PASS** |
| **V3: Session Management** | Cryptographically secure tokens, strict expiration, revocation. | 15-minute access JWTs, single-use refresh tokens stored in `UserSession` table, and immediate logout revocation. | **PASS** |
| **V4: Access Control** | Principle of least privilege, RBAC matrix enforcement on all routes. | Strict role hierarchy (`ROOT` > `ADMIN` > `READ_ONLY`) validated before request reaches route handler. | **PASS** |
| **V5: Validation & Sanitization** | Strict input validation, defense against path traversal and injection. | Zod schema validation on every payload; `PathGuard` canonicalization blocking `..` and Alternate Data Streams. | **PASS** |
| **V6: Cryptography** | Pinned algorithms, sufficient key lengths, secure random generation. | AES-256-GCM authenticated encryption, SHA-256 checksums, DPAPI master key derivation, `crypto.randomBytes(32)`. | **PASS** |
| **V7: Error Handling & Logging** | No sensitive data in logs, no stack trace leakage in API responses. | Sanitized error envelope `{ error, code, message }`; automated regex redaction of tokens and passwords in logs. | **PASS** |
| **V8: Data Protection** | Sensitive data at rest encrypted, automated disaster recovery backups. | Database credentials and environment variables encrypted in PostgreSQL; automated encrypted backup engine. | **PASS** |
| **V14: Configuration** | Secure defaults, hardened firewall, delayed auto-start service. | Windows Service running under virtual account; firewall strictly limits inbound traffic to ports 80 and 443. | **PASS** |
