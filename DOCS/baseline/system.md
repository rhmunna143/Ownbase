# Baseline System Architecture & Runtime Topology (v0.1.0-prototype)

**Status:** Prototype Baseline Freeze  
**Git Tag:** `v0.1.0-prototype`  
**Date:** October 19, 2026

---

## 1. Process & Runtime Architecture

In the `v0.1.0-prototype` baseline, the system operates as a monolithic Electron desktop application:

```
+-------------------------------------------------------------------------+
| Electron Main Process (PID: xxxx, Node.js + Chromium)                  |
|                                                                         |
|  ├── LifecycleManager (tray, power blocker)                             |
|  ├── PostgresManager (spawns postgres.exe directly)                     |
|  ├── PrismaManager (ORM connection over TCP 5432)                       |
|  ├── ProcessSupervisor (spawns child_process.spawn for native binaries) |
|  ├── CaddyManager (dynamic reverse proxy JSON config)                   |
|  └── WebApiServer (Express/Node HTTP server on 0.0.0.0:3001)            |
+-------------------------------------------------------------------------+
       |                                      |
       v (spawns child processes)             v (serves renderer)
+----------------------------+       +------------------------------------+
| External Child Processes   |       | BrowserWindow (Next.js Static UI)  |
| - postgres.exe (:5432)     |       | - Dashboard, Metrics, Terminal     |
| - caddy.exe (:80, :443)    |       | - Communicates via loopback fetch  |
| - filebrowser.exe (:8080)  |       |   and Electron IPC                 |
| - minio.exe (:9000)        |       +------------------------------------+
| - ollama.exe (:11434)      |
+----------------------------+
```

### Critical Defect Highlights of this Baseline
- **P1 (Lifecycle Tied to GUI):** The entire server stack (Postgres, Caddy, API, services) terminates whenever the Electron application window/tray is closed or the user logs out.
- **P2 (Unauthenticated API):** `httpServer.ts` listens on `0.0.0.0:3001` with `Access-Control-Allow-Origin: *` without authentication or authorization.
- **P3 (Raw SQL Execution):** `/api/execute-query` directly invokes `$queryRawUnsafe` with arbitrary SQL strings from any caller.
- **P4 (Path Traversal):** File manager resolution fails to verify canonical root containment and allows absolute drives (`C:\...`).
- **P5 (Hardcoded Default Passwords):** `admin / admin12345678` is hardcoded across UI components and supervisor configuration; Postgres is initialized with `trust` auth.

---

## 2. Port & Network Allocation Baseline

| Service | Port | Interface | Security State in Baseline | Target Phase Fix |
| :--- | :--- | :--- | :--- | :--- |
| **HttpServer (API)** | 3001 | `0.0.0.0` (All) | **CRITICAL: Unauthenticated, exposed to LAN** | Phase 1 (JWT/RBAC), Phase 2 (127.0.0.1 loopback only) |
| **PostgreSQL 16** | 5432 | `127.0.0.1` | `trust` auth (any local user connects as superuser) | Phase 1 (scram-sha-256 + generated password) |
| **Caddy Ingress** | 80 / 443 | `0.0.0.0` | Ingress proxy, dynamic admin API on 2019 | Phase 3 & 5 (Hardened edge gateway) |
| **Caddy Admin API** | 2019 | `127.0.0.1` | Loopback admin endpoint | Phase 3 (Secured admin socket/port) |
| **FileBrowser** | 8080 | `0.0.0.0` | Hardcoded `admin12345678` credentials | Phase 1 (Dynamic setup), Phase 6 (Real binary) |
| **MinIO S3** | 9000 | `0.0.0.0` | Default static root credentials | Phase 1 & 6 |
| **Ollama AI** | 11434 | `0.0.0.0` | C# Simulator with static replies | Phase 6 |

---

## 3. Storage & Persistence Layout

The baseline stores state in inconsistent, split directories under `%APPDATA%`:

1. **PostgreSQL Cluster:**  
   `%APPDATA%\NativeWindowsServerHub\postgres`  
   Initialized via `initdb.exe -U postgres -A trust -E UTF8`.

2. **FileBrowser Storage & Database:**  
   `%APPDATA%\native-windows-server-hub\storage`  
   `%APPDATA%\native-windows-server-hub\filebrowser.db` (SQLite)

3. **Prisma Schema & Migrations:**  
   `prisma/schema/` (Canonical SQLite/Postgres schema files).  
   *Note:* Deduplicated in Phase 0 by removing obsolete `prisma/migrations/`.

---

## 4. Hardware and Platform Compatibility Baseline

- **Operating System:** Windows 10 (22H2+) / Windows 11 (tested on Build 10.0.26300).
- **Architecture:** `x64` (64-bit Windows).
- **Execution Level:** `asInvoker` (Standard User elevation, UAC prompt required only during NSIS install).
- **Windows Subsystems:** Native Win32 API, NTFS Alternate Data Streams (`::$DATA`), Console Pseudo-terminals (ConPTY).
