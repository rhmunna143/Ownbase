# ADR-003: Web Terminal Integration via node-pty and Windows ConPTY (Spike S3)

**Status:** Accepted (Spike S3: PASS)  
**Date:** October 19, 2026  
**Deciders:** Core Engineering Team  
**Consulted:** `UPGRADE_PRD.md` Section 3.2 (Decision D11), Spike S3

---

## Context and Problem Statement
Users require an interactive terminal in the web dashboard to inspect system diagnostics, run PowerShell commands, or debug deployed applications. On Windows, traditional standard I/O pipes do not support ANSI escape codes, cursor positioning, or interactive programs (like `vim`, `top`, or interactive CLI prompts). Microsoft introduced Windows Pseudo Console (ConPTY) in Windows 10 (Build 1809+) to resolve this. We need to verify whether `node-pty` using ConPTY works reliably in a headless service context on our target Node version.

## Decision
We adopt **`node-pty`** with the Windows ConPTY backend for terminal sessions:
- Spawns interactive PowerShell or cmd.exe sessions attached to a Windows Pseudo Console.
- Bridges the binary ConPTY stream over WebSocket (`/api/v1/terminal/ws`) directly to `xterm.js` in the frontend dashboard.
- Security Policy (Honest Threat Model D11):
  - In a Windows environment, a PowerShell session cannot be strictly sandboxed to a specific directory (the user can always `cd \` or run arbitrary binaries).
  - Terminal access is restricted strictly to users with the `ROOT` role.
  - WebSocket connection requires a short-lived (30s) single-use authentication ticket acquired via authenticated POST.
  - Terminal sessions enforce an idle timeout of 15 minutes.
  - All terminal session activations and closures are recorded in the `AuditLog`.

## Spike S3 Evaluation Results
- **Test:** Evaluated `node-pty` v1.0.x on Windows 11 with Node 24 and Node 20 runtimes inside a non-interactive service process.
- **Verification:**
  1. ConPTY initialization verified (`useConpty: true`).
  2. Full two-way interactive stream tested with PowerShell. ANSI color sequences, window resizing (`resize(cols, rows)`), and tab completion functioned correctly.
  3. Verified socket disconnect properly terminates the underlying ConPTY shell process without leaving orphaned `conhost.exe` processes.
- **Result:** **PASS.**

## Consequences
- **Positive:** Full terminal fidelity matching standard Windows Terminal in the browser.
- **Negative:** ConPTY requires Windows 10 1809 or higher (older builds unsupported, which aligns with our baseline of Win 10 22H2+).
- **Fallback:** If `node-pty` compilation fails on an environment, terminal feature is deprioritized to Could/cut.
