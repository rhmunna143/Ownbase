# Product Requirements Document (PRD): Native Windows Server Hub

## 1. Project Overview
**Objective:** Develop a standalone Windows desktop application that transforms any standard Windows 11 PC into a fully functional, globally accessible server (VPS equivalent) using native Windows executables. The application will orchestrate local services, databases, and network tunneling without relying on complex virtualization like WSL2, Docker, or Hyper-V.

**Target Architecture:**
*   **Application Shell & Engine:** Electron.js (Node.js runtime)
*   **User Interface:** Next.js, Tailwind CSS, ShadCN/UI
*   **State Management:** Prisma ORM connected to a locally supervised PostgreSQL instance
*   **Networking / Proxy:** Caddy (dynamic API-driven reverse proxy), Tailscale (mesh VPN)
*   **Hosted Services:** FileBrowser (Nextcloud alternative), Ollama/Hermes (Local AI)

---

## 2. Phase 1: Core Foundation & Database Bootstrapping
**Goal:** Establish the Electron application shell and seamlessly embed a portable SQL database that initializes without user intervention.

*   **Electron & Next.js IPC:** Set up the Next.js frontend to run statically within the Electron window, establishing secure Inter-Process Communication (IPC) channels to the Node.js backend.
*   **Portable PostgreSQL Integration:**
    *   Package the official Windows portable PostgreSQL binary (`.zip` distribution) inside the Electron `extraResources` directory.
    *   On first launch, execute `initdb.exe -D <AppData>/postgres -U postgres` programmatically if the data directory is missing.
    *   Launch the database engine silently via `postgres.exe -D <AppData>/postgres -p 5432`.
*   **Prisma ORM Initialization:**
    *   Configure a multi-file Prisma schema (separating `service.prisma`, `route.prisma`, etc.).
    *   Upon verifying the PostgreSQL port is actively listening, execute programmatic database migrations (`npx prisma migrate deploy`) via Node.js before mounting the user interface.

---

## 3. Phase 2: The Native Process Supervisor
**Goal:** Build a robust background process manager to handle third-party Windows binaries and prevent "orphaned" zombie processes when the app closes.

*   **Process Registry:** Create a Node.js `ProcessSupervisor` class using `child_process.spawn()` to manage the lifecycles of `caddy.exe`, `filebrowser.exe`, and `ollama.exe`.
*   **Stdout/Stderr Logging:** Capture console outputs from the spawned binaries and stream them via IPC to the Next.js frontend for real-time log viewing.
*   **Graceful Termination:** Hook into Electron's `before-quit` event. Use Windows-native process killing (`taskkill /pid <PID> /T /F`) to forcefully terminate the entire process tree of supervised binaries before the main application exits.

---

## 4. Phase 3: Networking & Dynamic Proxy Routing
**Goal:** Implement the reverse proxy and secure tunneling to make the local services accessible globally.

*   **Caddy Admin API Integration:** 
    *   Launch `caddy.exe run --api 127.0.0.1:2019` via the supervisor.
    *   When a user provisions a new service in the UI (e.g., FileBrowser), have the backend send a JSON payload via an HTTP POST request to Caddy's REST API (`/config/apps/http/servers/srv0/routes`). This dynamically registers the new domain and port without requiring config files or server reboots.
*   **Tailscale Integration:**
    *   Expose UI inputs for the user's Tailscale Auth Key.
    *   Execute `tailscale.exe up --authkey=<KEY>` natively via `child_process.execFile()`.
    *   Query and display the active mesh IP address in the UI using `tailscale.exe ip -4`.

---

## 5. Phase 4: System Integration & App Lifecycle
**Goal:** Ensure the application behaves like a persistent 24/7 server rather than a standard desktop app.

*   **System Tray Management:** Intercept the standard window `close` event to hide the UI while keeping the Node.js engine and supervised processes running. Display a taskbar tray icon for restoring the dashboard or fully quitting the server.
*   **Windows Startup Registry:** Implement a toggle in the UI that utilizes Electron's `app.setLoginItemSettings()` to configure the application to launch automatically (and hidden) when Windows boots.
*   **Power State Overrides:** Integrate Electron's `powerSaveBlocker.start('prevent-app-suspension')` API. This prevents Windows 11 from throttling the CPU, sleeping the network adapter, or suspending processes when the laptop lid is closed (assuming Windows Power Options are set to "Do nothing").

---

## 6. Phase 5: Packaging & Distribution
**Goal:** Compile the ecosystem into a single, distributable Windows `.exe` installer.

*   **Next.js Static Export:** Configure Next.js to export a static bundle (`next build`) that can be loaded natively via Electron's `BrowserWindow.loadFile()`.
*   **Binary Bundling:** Use `electron-builder` to map the downloaded `.exe` dependencies (Caddy, PostgreSQL, FileBrowser) into an unpacked `bin` directory alongside the final application executable.
*   **NSIS Installer Generation:** Generate a one-click installer that extracts the files, sets up the AppData directories, and creates desktop shortcuts.