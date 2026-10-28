# Troubleshooting & Frequently Asked Questions (FAQ)

**Document Version:** 1.0.0  
**Scope:** Operating and troubleshooting Ownbase Native Windows Server Platform

---

### Q1: Why doesn't Ownbase require Docker Desktop or WSL2?
Ownbase orchestrates server workloads directly on the native Windows operating system using Win32 kernel primitives:
- **Windows Job Objects** enforce CPU rate limits and RAM commit caps without virtual machines.
- **Caddy Edge Proxy** handles reverse proxying, subdomain routing, and automatic TLS.
- **NTFS Filesystem** provides native NVMe performance with zero virtual disk (`ext4.vhdx`) translation overhead.
This saves 1.5–2.0 GB of baseline RAM and eliminates Hyper-V dependencies.

---

### Q2: How do I access Ownbase from other devices on my local network (LAN)?
1. Verify that your Windows network connection is set to **Private** (Windows Settings > Network & Internet > Properties > Network Profile Type = Private).
2. Open the Ownbase Web Dashboard, navigate to **Routes**, and toggle **Expose to LAN** on the target route.
3. Access the service using your server's local hostname or IP: `http://<server-name>.local` or `http://<lan-ip>`.
4. All LAN requests are automatically protected by forward-authentication: visitors must sign in with their Ownbase account before accessing the service.

---

### Q3: Why can't I connect directly to ports 5432, 8080, or 11434 from another computer?
By design, Ownbase enforces **strict loopback isolation (P2)**. All internal services (PostgreSQL on 5432, FileBrowser on 8080, Ollama on 11434) bind exclusively to `127.0.0.1`.
- This prevents unauthenticated attackers on your local Wi-Fi from bypassing security to query raw databases or private APIs.
- All incoming traffic must flow through the **Caddy Edge Reverse Proxy** on port 80 or 443, which validates authorization, routes subdomains, and terminates TLS.

---

### Q4: How do I access Ownbase securely from anywhere in the world?
Use the built-in **Tailscale Mesh Integration**:
1. Open Dashboard > Network > Tailscale.
2. Click **Connect Mesh** and authorize with your Tailscale account.
3. Ownbase receives a secure `100.x.y.z` IP and `.ts.net` MagicDNS hostname.
4. Automatic HTTPS certificates are provisioned via Tailscale ACME without opening firewall ports, configuring dynamic DNS, or port forwarding on your router.

---

### Q5: Windows Defender SmartScreen showed "Windows protected your PC". Is this safe?
Yes. Official open-source releases are distributed without costly corporate Extended Validation (EV) digital certificates. Because the binary is newly released, Windows displays a reputation notice.
- Click **"More info"** on the blue dialog.
- Click **"Run anyway"**.
- For enterprise environments, refer to [docs/guides/smartscreen-signing.md](file:///c:/Projects/native-windows-server-prototype/docs/guides/smartscreen-signing.md) for Authenticode signing instructions.

---

### Q6: A service keeps stopping or showing "Failed" status. How do I fix it?
Ownbase features a **Formal 7-State Process Supervisor with a Circuit Breaker**:
- If an application crashes 3 times within 60 seconds (e.g. due to a syntax error or missing environment variable), the supervisor transitions it to `failed` to prevent CPU exhaustion.
- **To troubleshoot:**
  1. Click the service in the Web Dashboard and view the **Recent Logs** tab.
  2. Or open the **Web Terminal** (ROOT access required) and run the command directly to see console output.
  3. Fix the issue in the application configuration or code.
  4. Click **Restart Service** in the dashboard to reset the circuit breaker and start fresh.

---

### Q7: What happens when the host computer reboots or the user logs off?
- **At Boot:** The Ownbase Server Daemon is registered as a standard Windows Service with `delayed-auto` start. It starts automatically at Windows boot before any user logs in.
- **At Logoff:** Workloads continue running uninterrupted in the background because the daemon runs under the `NT SERVICE\Ownbase` virtual service account.
- **Power Suspension Prevention:** Enable **24/7 Server Persistence** in Dashboard > System > Power Management. Ownbase activates `SetThreadExecutionState`, allowing the screen to turn off while keeping CPU, networking, and disks 100% active.

---

### Q8: How do I backup and restore my entire server to a fresh machine?
1. **Backup:** Navigate to Dashboard > Backups > click **Create Backup**. Ownbase generates an encrypted `.ownbase.bak` archive bundling database tables, configurations, and encrypted secrets.
2. **Restore:** On the new machine, install Ownbase, click **Restore from Backup**, select your `.ownbase.bak` archive, and enter your **Master Encryption Recovery Key**. All databases, services, routes, and users are restored automatically.

---

### Q9: Where are application data and database records stored on disk?
By default, all persistent server state is stored in:
```
C:\ProgramData\Ownbase\
  ├── postgres\   (PostgreSQL 16 relational database cluster)
  ├── storage\    (Managed file storage and application uploads)
  ├── caddy\      (Caddy proxy configurations and TLS certificates)
  ├── runtimes\   (Isolated Node, Python, and Go runtime binaries)
  ├── apps\       (Deployed application source code and release versions)
  ├── backups\    (Encrypted .ownbase.bak archive files)
  └── logs\       (Structured server and daemon logs)
```
Additional storage volumes (e.g. `D:\`, `E:\`) can be designated for bulk file storage and backups via Dashboard > Storage.
