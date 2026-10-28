Comprehensive Architectural Log & PaaS Engineering Blueprint
1. Project Context & Executive Summary
Project Name: Native Windows Server Hub (Production PaaS Upgrade)   
MD

Target Host OS: Bare-metal Windows 10 / Windows 11 (64-bit)   
MD

Primary Objective: Build a production-grade, industry-standard self-hosted Platform-as-a-Service (PaaS) and Personal Cloud Server that transforms any consumer or workstation Windows PC into an always-on, globally accessible server hub.   
MD

Core Constraint & Architectural Differentiator: Zero Virtualization Overhead. The platform runs strictly on bare metal without Docker Desktop, WSL2, or Hyper-V, orchestrating native Windows portable executables (.exe), native managed runtimes, and system-level networking.   
MD

2. Chronological Conversation & Engineering Evolution
Phase 0: The Legacy Virtualization & Container Problem
Initial Setup & Roadblocks: Initial exploration centered around running 1Panel, Docker containers, and Nginx Proxy Manager inside virtualized layers (VirtualBox/Proxmox) exposed via Ngrok foreground tunnels.

Friction Points:

Foreground tunnels (Ngrok CLI) collapse immediately upon terminal exit.

Docker Hub API rate limits and intermittent 500 Internal Server Error registry failures prevent container image pulls.

Strict dependency on Linux virtualization (WSL2 / Hyper-V) creates heavy memory footprints, complex virtual switch/port forwarding configurations, and severe friction for Windows end-users.

Strategic Pivot: Abandon container virtualization entirely on Windows. Reconstruct the entire orchestration stack as a native Windows desktop and background application using Electron, Node.js, portable Windows binaries, dynamic Caddy proxying, and Tailscale WireGuard mesh networking.   
MD

Phase 1: Prototype Development & Proof of Concept
A functional bare-metal prototype was designed, built, and verified:   
MD

Desktop Shell & Dashboard: Electron 32 desktop runtime wrapping a mobile-responsive Next.js 14 frontend styled with Tailwind CSS, Lucide icons, and ShadCN/UI patterns.   
MD

Data Layer: Portable PostgreSQL 16 initialized silently via initdb.exe, run on port 5432, and managed through a multi-file Prisma ORM 6 schema.   
MD

Ingress & Proxying: Caddy Server 2.8 running natively (caddy.exe) with dynamic route injection via its JSON REST Admin API on 127.0.0.1:2019.   
MD

Global Access: Native Tailscale integration (tailscale.exe) providing encrypted WireGuard mesh access alongside local LAN wildcard routing via nip.io.   
MD

Windows Defender Smart App Control (SAC) Hardened Binaries: Third-party services (filebrowser.exe, minio.exe) were compiled locally via Microsoft's built-in csc.exe (.NET Framework compiler) to satisfy Windows execution policies.   
MD

Media & File Streaming: Native RFC 7233 HTTP 206 Byte-Range streaming engine implemented for smooth 1080p/4K seeking on mobile devices.   
MD

24/7 Server Persistence: System tray minimization, Windows startup registry binding (app.setLoginItemSettings), and power suspension blocking via Electron's powerSaveBlocker (prevent-app-suspension).   
MD

Phase 2: Architectural Gap Analysis (Prototype vs. Industry-Standard PaaS)
A review was conducted to evaluate upgrading the working prototype into an enterprise-grade PaaS (comparable to Coolify, CasaOS, Render, and AWS Web Services) without rewriting everything from scratch:

┌────────────────────────────────────────────────────────────────────────┐
│                          ARCHITECTURAL DELTA                           │
├──────────────────────────┬─────────────────────────────────────────────┤
│ Dimension                │ Prototype Implementation vs. Production PaaS│
├──────────────────────────┼─────────────────────────────────────────────┤
│ Core Engine Lifecycle    │ Electron Monolith ➔ Headless Windows Daemon │
│ Resource Sandboxing      │ Unrestricted Spawn ➔ Windows Job Objects    │
│ Secrets / Configs        │ Build-time .env ➔ First-Run OOBE & DB Salts │
│ Authentication           │ Open Local Ports ➔ Argon2id + Bearer JWT    │
│ Multi-Language Execution │ Fixed Binaries ➔ Managed Portable Runtimes  │
│ Storage Topology         │ Single AppData Path ➔ Multi-Drive Tiering   │
│ Ingress Capabilities     │ Single Subdomain ➔ Multi-Domain / Multi-Port│
└──────────────────────────┴─────────────────────────────────────────────┘
3. Production Architecture Specifications
3.1 Control Plane Decoupling (Windows Service Daemon)
To prevent server downtime when the UI closes, the monolith is divided into two distinct tiers:

The Headless System Engine (Windows Service):

Registered with the Windows Service Manager (auto-start on Windows boot prior to user login).

Supervises portable PostgreSQL, Caddy, Tailscale, background jobs, and application processes.

Exposes an internal REST / WebSocket API on 127.0.0.1:3001 secured with JWT authentication.   
MD

The Presentation Shell (Electron & Web):

Electron acts solely as a client connecting to 127.0.0.1:3001 via IPC or local HTTP.   
MD

The Next.js dashboard can be opened from Electron or any browser across LAN/Tailscale.   
MD

Plaintext
[ Windows 11 Boot (Pre-Login) ]
             │
             ▼
[ Native Core Daemon (Windows Service) ] ────► [ Windows Job Objects ]
   ├── Supervised PostgreSQL 16 (Port 5432)        ├── App 1: Node.js (RAM Cap: 1GB)
   ├── Supervised Caddy Proxy (Ports 80/443/2019)  ├── App 2: Django (RAM Cap: 2GB)
   ├── Tailscale WireGuard Mesh Tunnel             └── App 3: Go Binary (RAM Cap: 512MB)
   └── Internal REST / WebSocket API (:3001)
             ▲
             │ Authenticated HTTP/WS / Bearer JWT
             ▼
[ Clients / Presentation Layer ]
   ├── Desktop Electron Window (System Tray)
   ├── Mobile Phone Browser (via LAN *.nip.io)
   └── Remote Management (via Tailscale Mesh IP)
3.2 Packaging, OOBE Wizard & Secret Management
For standalone installer (Setup.exe) and single-file portable (-Portable.exe) distributions, credentials must not be hardcoded in .env files:   
MD

Configuration Storage Resolution:

Installed Mode: %APPDATA%\WindowsServerHub\config.json

Portable Mode: <ExecutableRoot>\data\config.json

Out-of-Box Experience (OOBE): On initial boot, if no root configuration is detected, the server enters provisioning mode and serves a setup wizard.

Master Password Hashing: Root credentials are encrypted using Argon2id and written to the database.

Symmetric Key Generation: A 256-bit encryption key (crypto.randomBytes(32)) is generated locally to encrypt third-party API tokens, S3 secret keys, and database passwords at rest.

3.3 Multi-Language Deployment Engine (Bare-Metal Execution)
Without Docker, the engine provides isolated, portable runtime environments directly on Windows:

Plaintext
C:\WindowsServerHub\runtimes\
  ├── node-v20-win-x64\     (Portable Node.js + npm.cmd)
  ├── python-3.11-embed\    (Portable Python with pip & venv support)
  └── go-1.22-win-x64\      (Portable Go Toolchain)
Deployment Lifecycle:

Source Retrieval: Git clone or archive upload to C:\WindowsServerHub\apps\<app_id>\.

Automated Build Execution:

Node.js / Next.js: Calls portable npm.cmd install && npm.cmd run build.

Python / Django: Invokes python -m venv .venv, installs dependencies via .venv\Scripts\pip.exe install -r requirements.txt, and applies database migrations.

Go: Executes go build -o app.exe main.go.

Port Allocation: Dynamically assigns an unallocated TCP port within the private range 4000-4999.

Job Object Isolation: Enforces hard RAM/CPU boundaries using Windows Job Objects via native Win32 API bindings.

Dynamic Proxy Registration: Posts route configurations to Caddy's REST API at [http://127.0.0.1:2019/config/apps/http/servers/srv0/routes](http://127.0.0.1:2019/config/apps/http/servers/srv0/routes).

3.4 Interactive Shell & Web Terminal
Integrated directly into the Next.js UI using xterm.js.

Backend uses node-pty to spawn an authenticated powershell.exe process streaming over WebSockets, restricted to project and server directories.

4. Multi-Drive & Ingress Architecture
4.1 Storage Drive Selection & Multi-Drive Engine (Appendix 1)
The storage engine detects Windows physical volumes via PowerShell WMI queries and enables tiered disk allocation:

TypeScript
// Hardware volume discovery
Get-Volume | Where-Object { $_.DriveLetter -ne $null } | Select-Object DriveLetter, FileSystemLabel, FileSystem, Size, SizeRemaining | ConvertTo-Json
Storage Tiering:

Hot Tier (NVMe/SSD, e.g., C:\): PostgreSQL cluster data, Prisma migrations, Redis/Memurai cache, local AI weights (ollama.exe).   
MD

Cold/Bulk Tier (SATA SSD / HDD, e.g., D:\, E:\): Jellyfin media storage, photo backups, and MinIO multi-drive object buckets.   
MD

MinIO Multi-Drive Pooling: Multiple drive letters are passed directly to MinIO for native multi-mount operation:

PowerShell
minio.exe server D:\MinIO_Data E:\MinIO_Data --console-address :9001
NTFS Directory Junctions (mklink /J): For services limited to single-directory paths, NTFS junctions aggregate multiple drives into a unified virtual root without data duplication.

4.2 Multi-Domain & Multi-Binding Ingress (Appendix 2)
Services can bind to multiple hostnames across different network scopes simultaneously:

Local Loopback: web.localhost (zero network latency on host machine).   
MD

Local Wi-Fi Wildcard: web.192.168.0.102.nip.io (direct access on local Wi-Fi).   
MD

Encrypted Remote Mesh: web.100.84.32.40.nip.io or web.tailscale-alias.ts.net (secure remote access).   
MD

Public FQDN: web.customdomain.com (automated ACME Let's Encrypt / ZeroSSL TLS certificates).

Direct TCP Port Listener: Raw socket listeners (e.g., 0.0.0.0:9023, constrained to valid ports 1–65535).

5. Unified Prisma Database Schema
The database models are split across functional files within prisma/schema/:

prisma/schema/main.prisma
Code snippet
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
prisma/schema/auth.prisma
Code snippet
model User {
  id           String        @id @default(uuid())
  username     String        @unique
  passwordHash String        // Argon2id hash
  role         Role          @default(ADMIN)
  apiKeys      ApiKey[]
  auditLogs    AuditLog[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
}

model ApiKey {
  id          String    @id @default(uuid())
  name        String
  keyHash     String    @unique
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
}

enum Role {
  ROOT
  ADMIN
  OPERATOR
  READ_ONLY
}
prisma/schema/service.prisma
Code snippet
model Service {
  id            String         @id @default(uuid())
  name          String         @unique
  appType       AppType        @default(NATIVE_BINARY)
  executable    String         // Path to .exe or startup script
  args          String[]
  workingDir    String
  internalPort  Int            @unique // Assigned port (e.g., 4001, 8080)
  status        ServiceStatus  @default(STOPPED)
  envVars       Json?          // Dynamic environment configuration
  maxMemoryMb   Int?           // Windows Job Object limit
  cpuLimit      Int?           // Percentage limit
  routes        Route[]
  mounts        ServiceMount[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

enum AppType {
  NATIVE_BINARY
  NODEJS
  PYTHON_DJANGO
  GOLANG
  DATABASE
}

enum ServiceStatus {
  STARTING
  RUNNING
  STOPPED
  ERROR
}
prisma/schema/storage.prisma
Code snippet
model StorageVolume {
  id          String         @id @default(uuid())
  driveLetter String         @unique // "C:", "D:", "E:"
  label       String
  fileSystem  String         @default("NTFS")
  totalBytes  BigInt
  isSystem    Boolean        @default(false)
  mounts      ServiceMount[]
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
}

model ServiceMount {
  id           String        @id @default(uuid())
  serviceId    String
  service      Service       @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  volumeId     String
  volume       StorageVolume @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  hostPath     String        // e.g., "D:\Media\Jellyfin"
  mountPurpose MountPurpose  @default(DATA)
  createdAt    DateTime      @default(now())
}

enum MountPurpose {
  DATA
  MEDIA
  BACKUP
  CACHE
}
prisma/schema/route.prisma
Code snippet
model Route {
  id           String      @id @default(uuid())
  serviceId    String
  service      Service     @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  caddyRouteId String      @unique
  targetPort   Int         // e.g., 4001
  hosts        RouteHost[]
  directPorts  RoutePort[]
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}

model RouteHost {
  id        String   @id @default(uuid())
  routeId   String
  route     Route    @relation(fields: [routeId], references: [id], onDelete: Cascade)
  hostname  String   @unique // "app.domain.com", "app.192.168.0.108.nip.io"
  scope     HostType @default(PUBLIC_CUSTOM)
  enableTls Boolean  @default(true)
}

model RoutePort {
  id          String   @id @default(uuid())
  routeId     String
  route       Route    @relation(fields: [routeId], references: [id], onDelete: Cascade)
  exposedPort Int      // Valid TCP/UDP range: 1 - 65535
  protocol    String   @default("TCP")

  @@unique([exposedPort, protocol])
}

enum HostType {
  LOCAL
  LAN_NIP
  TAILSCALE_MESH
  PUBLIC_CUSTOM
}
prisma/schema/settings.prisma
Code snippet
model SystemSetting {
  key       String   @id
  value     String
  isSecret  Boolean  @default(false)
  updatedAt DateTime @updatedAt
}

model AuditLog {
  id        String   @id @default(uuid())
  action    String
  details   Json?
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  createdAt DateTime @default(now())
}
6. Implementation & Refactoring Roadmap
Plaintext
Phase 1: Security, Auth & Service Extraction
  ├── Extract core logic from Electron into a standalone background service daemon
  ├── Implement First-Run OOBE setup wizard (root credentials generation)
  ├── Add Argon2id password hashing + JWT-based route guards
  └── Secure all internal REST/WebSocket endpoints on :3001

Phase 2: Multi-Drive Storage & Windows Job Objects Sandboxing
  ├── Implement PowerShell WMI volume detection service
  ├── Build storage allocation & NTFS directory junction manager
  ├── Implement Win32 Job Object bindings to enforce memory and CPU limits per process
  └── Support multi-drive paths for MinIO and media storage

Phase 3: Multi-Language Deployment Engine & Ingress Upgrades
  ├── Package portable Node.js, Python/pip, and Go runtimes
  ├── Implement automated build runners (npm build, venv pip install, go build)
  ├── Build dynamic TCP port allocator for custom deployments
  └── Implement Caddy multi-host array matcher with automated Let's Encrypt / ZeroSSL

Phase 4: Template Catalog & Web Terminal
  ├── Create JSON-based app recipe parser (Jellyfin, Memurai/Redis, Ollama models)
  ├── Integrate xterm.js + node-pty authenticated PowerShell terminal in Next.js UI
  └── Generate updated NSIS Setup and Portable builds with automated service registration