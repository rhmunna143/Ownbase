# STRIDE Threat Model & Security Architecture

**Product:** Ownbase (formerly Native Windows Server Hub)  
**Status:** Phase 0 Baseline Threat Model  
**Date:** October 19, 2026  
**Reference:** `UPGRADE_PRD.md` Section 5 (Phase 0, Item 0.7), Findings P2–P5

---

## 1. System Overview & Trust Boundaries

The Ownbase security architecture establishes four primary trust boundaries:

```
[ UNTRUSTED: Public Internet / Mesh / LAN Clients ]
                      │
           (TB-1: Edge Ingress Boundary)
                      ▼
[ EDGE: Caddy Reverse Proxy (Ports 80/443, TLS, SNI) ]
                      │
           (TB-2: Gateway Ingress Boundary)
                      ▼
[ DAEMON GATEWAY: HTTP + WS on 127.0.0.1:3001 (JWT, RBAC, Rate Limiting) ]
                      │
           (TB-3: Host & Service Boundary)
                      ▼
[ SUPERVISED WORKLOADS: PostgreSQL (Scram), Job Objects, Apps, Toolchains ]
                      │
           (TB-4: OS & Storage Boundary)
                      ▼
[ LOCAL OPERATING SYSTEM: NTFS ACLs, DPAPI, ConPTY, Win32 Kernel ]
```

---

## 2. Subsystem 1: API Gateway (`/api/*`, `/ws`)

### 2.1 Trust Boundary
Crosses **TB-1** (via Caddy) and terminates at **TB-2**. Incoming requests originate from browsers (Electron or remote devices) over loopback, LAN, or Tailscale.

### 2.2 STRIDE Threat Matrix

| Threat Category | Threat Description | Baseline Defect | Planned Mitigation |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Attacker impersonates legitimate user or calls endpoints without credentials. | **P2:** No authentication on any route. | JWT access tokens (15-min life) signed with HMAC-SHA256, rotating HttpOnly refresh cookies, high-entropy 32-byte API keys (`auth/*`). |
| **Tampering** | Parameter manipulation, injection into SQL queries or configuration. | **P3:** Raw SQL allowed via `/api/execute-query`. | Delete `/api/execute-query`. Enforce strict Zod schema validation on all inputs; parameterized Prisma queries only. |
| **Repudiation** | An operator deletes services, routes, or files with no audit trail. | **P15:** In-memory logs only, no persistent audit log. | Append-only `AuditLog` table capturing actor, action, IP, timestamp, and entity ID. |
| **Information Disclosure** | Unauthenticated callers read system info, metrics, service PIDs, database credentials. | **P2:** `/api/system-info` and `/api/services` return all internal state to anyone. | RBAC guard requiring `READ_ONLY` or higher for telemetry; secrets masked in all responses. |
| **Denial of Service** | Flooding API with unauthenticated CPU-heavy requests (e.g. hashing) or large payloads. | **P12:** No request body size limits, unbounded parsing. | 1 MB body cap on JSON endpoints; IP-based and username-based rate limiting with exponential backoff on login. |
| **Elevation of Privilege** | Low-privilege user or unauthenticated client accesses administrative endpoints. | **P2:** All routes open to any caller. | Centralized RBAC guard with roles (`ROOT`, `ADMIN`, `OPERATOR`, `READ_ONLY`). Route table defines minimum role per path. |

---

## 3. Subsystem 2: File Service & Media Streaming

### 3.1 Trust Boundary
Crosses **TB-2** and interacts with **TB-4** (NTFS File System).

### 3.2 STRIDE Threat Matrix

| Threat Category | Threat Description | Baseline Defect | Planned Mitigation |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Client invokes file APIs under fake identity to access another user's files. | Unauthenticated file endpoints. | All file routes enforce authenticated user/token validation. |
| **Tampering** | Upload overwrites critical system files, executables, or files outside storage root. | **P4:** Single regex `../` strip leaves `....//` intact. | `PathGuard`: Rejects absolute paths, normalizes paths, asserts `path.relative(root, resolved)` does not start with `..`, and validates `fs.realpath` against symlink/junction escape. |
| **Repudiation** | Files deleted or corrupted with no record of requester. | No file mutation audit. | File write, delete, and rename events logged to `AuditLog`. |
| **Information Disclosure** | Directory traversal reads arbitrary files (`C:\Windows\System32\...`, SAM, SSH keys, user photos). | **P4:** Absolute paths (`C:\...`) directly resolved; external photos scanned without containment. | Strict containment check against explicit storage roots; alternate data streams (`::$DATA`) rejected; admin-configured library roots addressed as `rootId + relative`. |
| **Denial of Service** | Uploading multi-GB files exhausts Node.js heap memory; malformed HTTP Range requests hang the server. | **P12:** Entire file buffered in RAM (`saveFileBuffer`). **P13:** Broken range parser crashes on suffix `bytes=-500`. | Streaming `busboy`/chunked pipeline writing straight to disk; robust byte-range parser clamping `end` to file size and rejecting invalid ranges with 416. |
| **Elevation of Privilege** | Attacker writes executable or script into startup folders or replaces `extraResources/bin/*.exe`. | File uploads unconstrained. | Storage roots isolated to dedicated AppData/volume directories; execution permissions stripped. |

---

## 4. Subsystem 3: Web Terminal (ConPTY)

### 4.1 Trust Boundary
Crosses **TB-2** into a pseudo-terminal session running under the daemon's host account (**TB-4**).

### 4.2 STRIDE Threat Matrix

| Threat Category | Threat Description | Baseline Defect | Planned Mitigation |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Unauthorized user connects to terminal WebSocket and executes OS commands. | Terminal prototype had no WS auth. | WebSocket connection requires a one-time cryptographic ticket issued via authenticated `POST /api/v1/auth/ws-ticket` to `ROOT` role only. |
| **Tampering** | In-flight manipulation of terminal stream commands or keystrokes. | Unencrypted WS connections over LAN. | Terminal only accessible over TLS (Caddy/Tailscale) or loopback; ticket expires in 30 seconds. |
| **Repudiation** | Administrator or compromised account executes destructive commands (`rmdir /s /q`) untracked. | No command or session auditing. | Complete terminal session logging (session start/stop, actor, IP, duration, audit log entry). |
| **Information Disclosure** | Shell session accesses environment secrets, database connection strings, or user files. | Parent environment copied to child processes. | Sanitized child environment; sensitive secrets scrubbed; shell process runs under low-privilege service account where applicable. |
| **Denial of Service** | Long-running terminal sessions consume unbounded memory or CPU (e.g. fork bombs). | Spawned shells have no resource bounds. | 15-minute idle session timeout; process tree assigned to Windows Job Object with memory and CPU hard limits. |
| **Elevation of Privilege** | User escapes shell restrictions to gain SYSTEM privileges. | Previous proposal claimed "restricted to project directory" (unrealistic in PowerShell). | **Honest Threat Model (D11):** Terminal is acknowledged as a full host shell, restricted strictly to `ROOT` role; run under least-privilege service account with NTFS ACLs. |

---

## 5. Subsystem 4: Deployment Engine & Recipe Pipeline

### 5.1 Trust Boundary
Receives source archives or git URLs from **TB-2**, compiles or installs dependencies, and executes processes in **TB-3**.

### 5.2 STRIDE Threat Matrix

| Threat Category | Threat Description | Baseline Defect | Planned Mitigation |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Attacker triggers fake deployment or impersonates git remote. | No deploy authentication. | Deploy endpoints restricted to `ADMIN`+ roles; Git SSH/HTTPS host key validation. |
| **Tampering** | Malicious zip archive contains path traversal entries (`../../Program Files/...`) to overwrite system binaries. | Unsafe archive extraction ("Zip Slip"). | `PathGuard` extraction filter: rejects any archive entry whose target resolves outside the isolated project directory. |
| **Repudiation** | App deployed or updated without record of source commit or deployer. | No deployment version history. | Deployment registry records commit hash, archive checksum, deployment timestamp, author, and rollback snapshot. |
| **Information Disclosure** | App build scripts print environment secrets, tokens, or database passwords in build logs. | Build logs streamed raw. | Secret masking filter on build output; environment isolation per recipe. |
| **Denial of Service** | Rogue build script or runaway app allocates all host memory or 100% CPU. | **P6:** No resource limits on child processes. | Windows Job Object limits (`JOB_OBJECT_LIMIT_JOB_MEMORY` capping whole process tree, CPU rate limiting). |
| **Elevation of Privilege** | Deploy script attempts to install global npm packages or modify system services. | Node/Python running global npm/pip. | Isolated portable runtimes (`python-build-standalone`, local project `node_modules`); execution under low-privilege service account. |

---

## 6. Subsystem 5: Edge Ingress & Network Gateway

### 6.1 Trust Boundary
Frontline interface crossing **TB-1**. Caddy manages external TLS, reverse proxying, and host routing to internal services.

### 6.2 STRIDE Threat Matrix

| Threat Category | Threat Description | Baseline Defect | Planned Mitigation |
| :--- | :--- | :--- | :--- |
| **Spoofing** | DNS spoofing, SNI mismatch, or HTTP Host header injection. | Baseline listens on all interfaces without host check. | Caddy matches explicit hostnames (`*.localhost`, `*.nip.io`, `*.ts.net`); rejects unmapped hosts with 404/403. |
| **Tampering** | Man-in-the-middle attacks on plaintext LAN traffic. | Baseline HTTP server has no TLS. | Automatic ACME TLS (Tailscale `ts.net` certificates or local self-signed CA); HTTP automatically redirected to HTTPS. |
| **Repudiation** | Network attacks or port scanning undetected. | Caddy access logs uncollected. | Structured JSON access logging enabled on Caddy edge proxy. |
| **Information Disclosure** | Cross-Origin Resource Sharing (CORS) wildcard leaks data to malicious web pages. | **P2:** `Access-Control-Allow-Origin: *` set on all responses. | Configurable CORS allowlist restricted to authorized origins (local loopback, configured domains). |
| **Denial of Service** | Flooding edge ports exhausts sockets or fills disk with logs. | Uncapped external connections. | Caddy connection rate limits, request timeouts (30s default), and log rotation. |
| **Elevation of Privilege** | Attacker accesses internal service ports directly from LAN (bypassing auth). | **P2 / README:** Direct exposure of 3001, 5432, 8080, 9000, 11434 to LAN. | **Decision D3:** All daemon and internal service ports bind **127.0.0.1 loopback only**. Caddy (80/443) is the single external listener. Windows Firewall blocks all other inbound ports. |
