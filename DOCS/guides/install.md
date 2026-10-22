# Installation & Setup Guide: Ownbase Native Windows Server

**Document Version:** 1.0.0  
**Target Audience:** System Administrators, Self-Hosters, Developers  
**Supported Platforms:** Windows 10 (Build 19044 / 21H2 or later), Windows 11 (all builds), Windows Server 2022 / 2025 (x64)

---

## 1. Prerequisites & System Requirements

### Hardware Requirements
- **Processor:** 64-bit x86-64 processor (Intel Core 2nd Gen / AMD FX or newer) with at least 2 physical cores.
- **Memory (RAM):** 4 GB minimum (Ownbase core stack consumes only ~120 MB RAM; remainder is available for user applications).
- **Storage:** 2 GB free disk space for core binaries, PostgreSQL 16 cluster, and Caddy runtime.
- **Filesystem:** NTFS recommended (required for Windows Job Objects, directory junctions, and transactional atomic renames).

### Software Requirements
- **Operating System:** Windows 10 64-bit (21H2+), Windows 11 64-bit, or Windows Server 2022/2025.
- **PowerShell:** PowerShell 5.1 or PowerShell 7 (pre-installed on Windows 10/11).
- **Network Profile:** Private Network profile enabled on target network adapter (for local LAN reverse proxy access).
- **Virtualization:** **NONE REQUIRED.** Hyper-V, WSL2, and Docker Desktop are NOT needed.

---

## 2. Installation Options

Ownbase is distributed in two official formats:
1. **Windows Setup Installer (`.exe`)**: Recommended for production 24/7 background servers. Includes automatic Windows Service registration, firewall rules, and desktop shortcuts.
2. **Portable Standalone Package (`.exe` / `.zip`)**: Zero-install portable bundle. Runs in-place without touching Windows services or system registries.

---

## 3. Option A: Setup Wizard Installation (Recommended)

1. Download the latest installer:
   ```
   Native Windows Server Hub-Setup-1.0.0.exe
   ```
2. Verify the SHA-256 checksum:
   ```powershell
   Get-FileHash -Path ".\Native Windows Server Hub-Setup-1.0.0.exe" -Algorithm SHA256
   ```
3. Run the installer. If prompted by Windows UAC (User Account Control), click **Yes** to allow elevation.
4. Follow the setup wizard:
   - Select Destination Directory (Default: `C:\Program Files\Ownbase` or `%LOCALAPPDATA%\Programs\Ownbase`).
   - Leave "Create Desktop Shortcut" checked.
   - Click **Install**.
5. The installer automatically:
   - Copies bundled production runtimes (`extraResources/bin/`, PostgreSQL 16, Caddy).
   - Initializes `%ProgramData%\Ownbase` data directories with secure ACLs.
   - Runs `installer/firewall-rules.ps1` to permit inbound ports 80 and 443 strictly on the Private network profile.
   - Registers the **Ownbase Windows Service** (`delayed-auto` start type).
6. Click **Finish** to launch the Ownbase Dashboard.

---

## 4. Option B: Headless Windows Service Deployment (Command Line)

For headless Windows Server installations without an interactive GUI:

1. Extract the release binaries to `C:\Ownbase`.
2. Open an elevated PowerShell session (Run as Administrator):
   ```powershell
   cd C:\Ownbase\installer\winsw
   .\install-service.ps1
   ```
3. Configure the inbound firewall rules:
   ```powershell
   cd C:\Ownbase\installer
   .\firewall-rules.ps1
   ```
4. Verify service status:
   ```powershell
   Get-Service -Name "ownbase"
   ```
   Output:
   ```
   Status   Name               DisplayName
   ------   ----               -----------
   Running  ownbase            Ownbase Server Daemon
   ```
5. Access the Web Dashboard on `http://127.0.0.1:3001` or via Caddy on `http://localhost`.

---

## 5. First-Run Root Account Initialization

When accessing Ownbase for the first time:
1. Navigate to `http://localhost` (or `http://127.0.0.1:3001`).
2. The **First-Run Setup Wizard** will display:
   - Create a Root Administrator Username (e.g., `admin`).
   - Create a Strong Password (minimum 10 characters with upper, lower, numbers, and symbols).
3. The setup wizard displays your **Master Encryption Recovery Key**:
   > ⚠️ **CRITICAL SECURITY NOTICE**: Store this key in a secure password manager. It is required to restore encrypted database backups in disaster recovery scenarios.
4. Click **Complete Setup** to log in to the management dashboard.

---

## 6. Upgrades & Uninstallation

### Upgrades (In-Place)
To upgrade an existing installation:
1. Run the new installer over the existing directory.
2. The installer automatically stops the background service, updates binaries, deploys pending Prisma database migrations (`prisma migrate deploy`), and restarts the service.
3. User data in `%ProgramData%\Ownbase` and PostgreSQL tables are preserved intact.

### Clean Uninstallation
1. Open Windows **Settings > Apps > Installed Apps**.
2. Select **Native Windows Server Hub** and click **Uninstall**.
3. Choose whether to preserve application data and database records:
   - Default: All application databases, configuration files, and backup archives in `%ProgramData%\Ownbase` are **preserved** to prevent accidental data loss.
   - To purge all data, manually delete `%ProgramData%\Ownbase` after uninstallation.
