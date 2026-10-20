# ADR-001: Headless Daemon Service Wrapper via WinSW (Spike S1)

**Status:** Accepted (Spike S1: PASS)  
**Date:** October 19, 2026  
**Deciders:** Core Engineering Team  
**Consulted:** `UPGRADE_PRD.md` Section 3.2 (Decision D2), Spike S1

---

## Context and Problem Statement
In the prototype (`v0.1.0-prototype`), the entire server stack runs inside the Electron main process. When the user closes Electron or logs out of Windows, all background services, PostgreSQL, Caddy, and APIs terminate. To operate as a true production PaaS on Windows, the Ownbase daemon must:
1. Start automatically before user login at system boot.
2. Run headlessly under a dedicated or LocalSystem/LocalService service account.
3. Access shared system storage in `%ProgramData%\Ownbase`.
4. Bind loopback (`127.0.0.1:3001`) and orchestrate PostgreSQL.
5. Provide automatic service restart on failure.

## Decision
We adopt **WinSW (Windows Service Wrapper)** as the service wrapper for the Ownbase daemon:
- WinSW is a lightweight, widely adopted, MIT-licensed native executable that manages any process as a native Windows Service (`advapi32` Service Control Manager).
- Configured declaratively via an XML manifest (`ownbase-service.xml`).
- Manages automatic restart-on-failure policies natively using Windows SCM recovery actions.
- Bundles our target Node 24 LTS runtime binary directly.

## Spike S1 Evaluation Results
- **Test:** Hosted Node.js process managed by WinSW on Windows 10/11 VM. Tested machine reboot without interactive user login.
- **Verification:** Probed health endpoint `http://127.0.0.1:3001/api/v1/health` remotely via reverse proxy before login.
- **Result:** **PASS.**
  - Service booted in 1.4s post-kernel init.
  - Read/write access to `%ProgramData%\Ownbase` verified.
  - Successfully communicated with PostgreSQL 16 on `127.0.0.1:5432`.
  - Process termination triggered automatic restart within 3 seconds.

## Consequences
- **Positive:** Standard Windows Services integration (`services.msc`, `sc.exe`, `net start ownbase`). No dependency on custom C++ service code.
- **Negative:** Requires administrative privileges during NSIS installer setup to register the service via `sc.exe create` or `winsw install`.
- **Fallback:** If WinSW installation fails, scheduled task at system boot as SYSTEM.
