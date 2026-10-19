# Dependency Baseline & Native Modules Audit (v0.1.0-prototype)

**Status:** Phase 0 Baseline Audit  
**Date:** October 19, 2026  
**Reference:** `UPGRADE_PRD.md` Section 3.2 (Decision D14), Section 5 (Phase 0, Item 0.5)

---

## 1. Electron & Framework Lifecycle Audit

| Component | Current Version | Support / EOL Status | Roadmap & Decision (D14) |
| :--- | :--- | :--- | :--- |
| **Electron** | `^32.2.0` | **EOL (End of Life in 2025)**. Electron 32 no longer receives Chromium security backports or V8 vulnerability fixes. | In Phase 2, the core server engine is decoupled from Electron into a standalone Node 24 headless daemon (D1). Electron is relegated to a thin-client tray/window wrapper. Upgrade the Electron shell to **Electron 34+ or 35 LTS** in Phase 8 toolchain refresh. |
| **Next.js** | `^14.2.15` | Active LTS (Next 14). Used for Static HTML Export (`output: 'export'`). | Retain Next.js 14 static export for the web UI; no dynamic server features needed. Fully supported in static mode. |
| **Node.js Target** | Node 20.x dev / Node 25 local | Node 20 LTS reached EOL April 2026. | Target **Node 24 LTS** for the daemon and deploy toolchain. |
| **Prisma ORM** | `^6.4.0` | Active (Prisma 6.x). | Deprecation warning on `package.json#prisma` will be addressed by migrating to `prisma.config.ts`. |

---

## 2. Security Vulnerability Scan (`npm audit`)

Audit performed on `package-lock.json` (`v0.1.0-prototype`):

```json
"metadata": {
  "vulnerabilities": {
    "info": 0,
    "low": 0,
    "moderate": 6,
    "high": 22,
    "critical": 2,
    "total": 30
  },
  "dependencies": {
    "prod": 61,
    "dev": 593,
    "total": 662
  }
}
```

### Risk Assessment:
- **Critical Vulnerabilities (2):** Both located in `tar` via devDependency chain `electron-builder` -> `@electron/rebuild` / `app-builder-lib`. Impact is limited to local packaging step, not production server runtime. Planned fix: Update `electron-builder` to `26.x` during toolchain upgrade.
- **High Vulnerabilities (22):** 
  - `tar` path traversal advisories (GHSA-34x7-hfp2-rc4v, GHSA-83g3-92jg-28cx) in dev packaging tooling.
  - `tailwindcss` sub-dependencies (`micromatch`, `fast-glob`, `chokidar`). No runtime exposure in static bundle.
- **Moderate Vulnerabilities (6):** `sprintf-js` in dev logging tooling (`roarr`).

---

## 3. Native C/C++ Modules Evaluation (Windows x64)

The planned architecture relies on key native modules for high performance and system interaction. Each candidate must provide prebuilt Windows x64 binaries to avoid requiring Visual Studio C++ build tools on end-user machines:

| Native Module | Target Phase | Purpose | Windows x64 Prebuild Availability | Evaluation & Fallback |
| :--- | :--- | :--- | :--- | :--- |
| **`argon2`** | Phase 1 | Argon2id password hashing (D7) | **Available.** Ships precompiled binaries via `node-pre-gyp` / GitHub releases for Windows x64 across Node versions. | Tested and verified. Fallback: `@noble/hashes` (pure WebAssembly/JS Argon2id, ~2x slower). |
| **`node-pty`** | Phase 6 | Windows ConPTY pseudo-terminal (D11, Spike S3) | **Available.** Prebuilt via `prebuild-install` for Win32 x64 with Windows ConPTY API support. | Tested in Spike S3. Requires Windows 10 build 1809+ for ConPTY. Fallback: Standard `child_process` pipe stream (non-interactive). |
| **`koffi`** | Phase 3 | Fast C FFI for Win32 API (Job Objects, process tokens) | **Available.** Zero-build out of the box; packages prebuilt DLLs for all major platforms including Windows x64. | Excellent stability and speed. Alternative to Go launcher `ownbase-jobhost.exe` if needed. |
| **`sharp`** | Phase 5 | High-performance image thumbnail generation | **Available.** Prebuilt libvips binaries via `@img/sharp-win32-x64`. | Zero build dependencies on user machine. Enables fast image pipeline without running full image decoders in JS. |
| **`jose`** | Phase 1 | JWT signing and verification | **Pure JS / WebCrypto.** | No native dependencies. Fast, standard WebCrypto implementation. |

---

## 4. Upstream Binary Assets (extraResources)

| Binary | Source | Current Checksum / Version | Target Upgrade Path |
| :--- | :--- | :--- | :--- |
| **`postgres.exe`** | PostgreSQL 16.4 Binaries | Official Windows 64-bit binaries | Retain PostgreSQL 16 LTS |
| **`caddy.exe`** | Caddy v2 | Caddy 2.8.4 Windows x64 | Retain official signed binary |
| **`filebrowser.exe`** | C# Mock Simulator | Local compilation | Replace in Phase 6 with upstream FileBrowser binary |
| **`minio.exe`** | C# Mock Simulator | Local compilation | Review AGPLv3 vs S3 alternative in Phase 6 |
| **`ollama.exe`** | C# Mock Simulator | Local compilation | Replace in Phase 6 with upstream Ollama Windows release |
| **`tailscale.exe`** | Official Tailscale CLI | Tailscale Windows CLI | Retain and manage join keys via stdin |
