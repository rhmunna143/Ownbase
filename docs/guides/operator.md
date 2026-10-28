# Operator & Administration Guide: Ownbase Native Windows Server

**Document Version:** 1.0.0  
**Target Audience:** Server Operators, DevOps Engineers, System Administrators

---

## 1. Operating Model & Architecture Summary

Ownbase is designed around the **Trusted-Workload Server Model**:
- All managed services (PostgreSQL, Node apps, Python services, Go binaries, FileBrowser, Ollama) run as native Win32 processes bounded by **Windows Job Objects**.
- All backend services bind exclusively to the loopback interface (`127.0.0.1`).
- The **Caddy Edge Proxy** handles all inbound HTTP/HTTPS traffic, terminating TLS, routing subdomains, and enforcing forward-authentication for LAN routes.
- Persistent data is stored in `%ProgramData%\Ownbase` and designated NTFS storage volumes discovered via PowerShell (`Get-Volume`).

---

## 2. Network Exposure Choices

Ownbase provides four graduated exposure models depending on your security and access requirements:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Ownbase Ingress Flow                       │
└─────────────────────────────────────────────────────────────────┘
                                ▲
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
 1. Loopback Only        2. LAN Ingress         3. Tailscale Mesh
  (127.0.0.1:3001)        (Port 80/443)         (100.x.y.z:443)
  Local workstation        Local Wi-Fi/LAN       End-to-end encrypted
  development mode        requires Forward-Auth  secure remote mesh
                                                        │
                                                4. Public Cloudflare
                                                   Encrypted Tunnel
```

### Exposure Model 1: Loopback Only (Default)
- **Scope:** Accessible only from the local machine (`http://127.0.0.1:3001` or `http://localhost`).
- **Security:** Inbound traffic blocked by Windows Firewall; ideal for development or local offline servers.

### Exposure Model 2: Local Area Network (LAN)
- **Scope:** Accessible to other devices on the same home or office network (e.g., `http://server.local`).
- **Security:** Enabled via the **Expose to LAN** toggle on each route.
  - Requires Windows Network Profile set to **Private**.
  - All LAN requests are guarded by Caddy forward-authentication (`/api/v1/auth/forward-auth`). Unauthenticated visitors must log in to Ownbase before reaching the service.

### Exposure Model 3: Tailscale Mesh Network (Recommended for Remote Access)
- **Scope:** Direct peer-to-peer WireGuard mesh access from anywhere in the world.
- **Setup:**
  1. Open Dashboard > Network > Tailscale.
  2. Click **Connect Mesh** and authenticate with your Tailscale account.
  3. Ownbase detects the 100.x.y.z mesh IP and generates a `.ts.net` MagicDNS address.
  4. Automatic HTTPS certificates are provisioned via Tailscale ACME without opening external firewall ports or configuring port forwarding.

### Exposure Model 4: Cloudflare Tunnels (Public Internet Ingress)
- **Scope:** Exposing web services to the public internet on custom domain names (e.g. `https://files.example.com`).
- **Setup:** Run `cloudflared` pointing to `localhost:80`. Caddy routes traffic based on the incoming `Host` header.

---

## 3. Automated Backups & Disaster Recovery (Acceptance A2)

### Creating an Encrypted Backup Archive
1. In the Web Dashboard, navigate to the **Backups** tab.
2. Click **Create Backup**.
3. Choose the target storage volume (Default: primary backup directory in `%ProgramData%\Ownbase\backups`).
4. The backup engine:
   - Exports all database tables (`pg_dump` with structured JSON fallback).
   - Bundles `config.json` and system routing metadata.
   - Encrypts the master data key using AES-256-GCM.
   - Calculates the SHA-256 checksum and saves the `.ownbase.bak` archive.

### Performing a One-Click Restore (Fresh Machine / VM Recovery)
In the event of hardware failure or migrating to a clean Windows machine:
1. Install Ownbase on the clean machine.
2. In the setup wizard or Backups panel, click **Restore from Backup**.
3. Select the `.ownbase.bak` archive file.
4. Provide the **Master Encryption Recovery Key** generated during initial setup.
5. Ownbase automatically:
   - Validates the archive SHA-256 checksum against file contents.
   - Decrypts the master data key and database tables.
   - Re-applies database schemas, users, service definitions, and route mappings.
   - Re-attaches storage volume junctions and restarts workloads.

---

## 4. Upgrades & Migration Strategy

Ownbase adheres to a zero-data-loss, additive schema migration model:
- **Database Migrations:** All schema changes are packaged as additive SQL migrations in `prisma/schema/migrations/`.
- **Command:** `npm run prisma:deploy` (`npx prisma migrate deploy`).
- `prisma db push` is strictly prohibited in production to prevent unintended table dropping.
- If an in-place upgrade fails, the Process Supervisor rolls back the active application symlink to the previous working release folder.

---

## 5. 24/7 Power & Sleep Prevention

To ensure non-stop server operation on laptops or desktops without human interaction:
1. Open Dashboard > System > Power Management.
2. Enable **24/7 Server Persistence**.
3. Ownbase invokes `SetThreadExecutionState` with:
   - `ES_SYSTEM_REQUIRED`: Prevents system sleep/standby while the server daemon is active.
   - `ES_CONTINUOUS`: Maintains persistent execution state across user logoffs.
   - `ES_AWAYMODE_REQUIRED`: Allows the display to turn off while keeping CPU, network, and storage active.
