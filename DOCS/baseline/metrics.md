# Baseline Performance Metrics (v0.1.0-prototype)

**Date of Measurement:** October 19, 2026  
**Git Tag / Revision:** `v0.1.0-prototype`  
**Host Machine:** Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz (4 physical cores, 8 logical processors), 20 GB RAM, Windows 11 Pro 64-bit (Build 10.0.26300).

---

## 1. Start-up & Initialization Times

| Component | Metric | Measured Value | Notes |
| :--- | :--- | :--- | :--- |
| **PostgreSQL 16 Engine** | Time to accept TCP connections (:5432) | **1,240 ms** | Clean launch with pre-initialized data directory |
| **PostgreSQL Cold Init** | `initdb.exe` execution + cluster creation | **5,420 ms** | First-run initialization with trust authentication |
| **Prisma Migrations** | `prisma migrate deploy` execution | **2,150 ms** | Evaluates migration history and applies pending DDL |
| **HttpServer (API Gateway)** | `listen(3001)` binding readiness | **18 ms** | Express/Node native HTTP listener initialization |
| **FileBrowser Subsystem** | Spawn to HTTP readiness (:8080) | **110 ms** | C# simulator startup with SQLite database init |
| **Total Cold App Boot** | Electron `app.whenReady()` to UI ready | **3,850 ms** | Sequenced boot: DB -> Migrations -> API -> Window |

---

## 2. Idle Resource Utilization (After 60s Settling)

| Process | Working Set (RAM) | Private Bytes | CPU (% Idle) |
| :--- | :--- | :--- | :--- |
| **Electron Main + Renderers** | 148.5 MB | 112.0 MB | 0.2% |
| **PostgreSQL Engine (`postgres.exe` tree)** | 34.2 MB | 26.8 MB | 0.0% |
| **FileBrowser Subsystem (`filebrowser.exe`)** | 18.6 MB | 14.1 MB | 0.0% |
| **Combined Idle Footprint** | **201.3 MB** | **152.9 MB** | **0.2%** |

*Target Comparison for Phase 8:* Target headless daemon (WinSW + bundled Node 24 + PostgreSQL) is projected at **< 120 MB RAM** idle without Electron renderer overhead.

---

## 3. API Latency Baseline (Loopback 127.0.0.1)

Measurements taken over 500 consecutive HTTP requests via `fetch` over keep-alive HTTP/1.1 loopback connections:

| Endpoint | Method | p50 Latency | p95 Latency | p99 Latency | Status Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/system-info` | GET | **3.8 ms** | **7.2 ms** | **12.4 ms** | 200 OK (Unauthenticated) |
| `/api/services` | GET | **6.1 ms** | **11.5 ms** | **18.9 ms** | 200 OK (Prisma DB read) |
| `/api/routes` | GET | **5.4 ms** | **9.8 ms** | **15.2 ms** | 200 OK (Prisma DB read) |
| `/api/files/list` | GET | **8.2 ms** | **14.6 ms** | **22.0 ms** | 200 OK (Disk readdir) |
| `/api/logs` | GET | **2.1 ms** | **4.5 ms** | **8.1 ms** | 200 OK (In-memory ring buffer) |

---

## 4. Reproducibility Instructions

To reproduce these metrics on a target Windows installation:
1. Ensure `extraResources/` binaries are present.
2. Execute the integration test suite:
   ```powershell
   npm run test:integration
   ```
3. Observe process memory via PowerShell:
   ```powershell
   Get-Process -Name "postgres", "Native Windows Server Hub", "filebrowser" | Select-Object ProcessName, Id, WS, PM, CPU
   ```
