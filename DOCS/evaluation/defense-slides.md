# Systems Defense & Project Presentation Slides

**Project:** Ownbase: High-Performance, Bare-Metal Server Orchestration for Windows  
**Presenter:** rhmunna143  
**Target:** Engineering Capstone / Systems Architecture Defense  
**Format:** 20-Slide Structured Defense Outline with Talking Points & Evidence  

---

### Slide 1: Title & Overview
- **Header:** Ownbase — Native Windows Server Orchestration without Virtualization
- **Subtitle:** Eliminating the Hyper-V/WSL2 virtualization tax on consumer and edge hardware
- **Presenter:** rhmunna143
- **Talking Points:**
  - Introduce the paradox: Windows powers hundreds of millions of edge and desktop devices, yet self-hosting on Windows is considered painful and resource-heavy.
  - State the thesis: Native Win32 kernel primitives can provide enterprise-grade server orchestration with a 93% smaller memory footprint than Docker Desktop.

---

### Slide 2: The Problem: The Virtualization Penalty on Windows
- **Header:** The Problem with Docker Desktop on Windows
- **Key Visuals/Points:**
  - **Memory Bloat:** `vmmemWSL` allocates 1.5–2.0 GB RAM before a single container executes.
  - **Filesystem Translation:** Cross-boundary 9P translation between NTFS and `ext4.vhdx` degrades I/O throughput.
  - **Interactive Lock-in:** User logoff suspends the desktop application and halts background services.
  - **Security Gaps:** Unchecked `-p 8080:8080` port binds expose raw services to all network adapters without TLS.
- **Talking Points:**
  - Why standard solutions fail for small home servers, mini-PCs (4–8 GB RAM), or battery-powered laptop servers.

---

### Slide 3: Research Objective & Requirements
- **Header:** Project Objectives & Non-Functional Requirements
- **Key Points:**
  - **NFR-1 (Resource Efficiency):** Idle RAM under 150 MB (target achieved: **118.4 MB**).
  - **NFR-2 (24/7 Resilience):** Windows Service with delayed auto-start before user login; sleep prevention.
  - **NFR-3 (Zero-Downtime Deployments):** Atomic release symlinks with in-flight request buffering (< 2 seconds).
  - **NFR-4 (Security Hardening):** 100% OWASP ASVS L1 compliance; loopback-only service binding.
  - **NFR-5 (Disaster Recovery):** One-click encrypted backup and restore with SHA-256 integrity checks.

---

### Slide 4: System Architecture Overview
- **Header:** Multi-Layered Native Architecture
- **Key Visuals:** High-level component block diagram (Caddy Edge -> Daemon Gateway -> Supervisor -> Workloads).
- **Talking Points:**
  - **Caddy Edge Proxy:** The single public/LAN gateway on ports 80/443 with automated Let's Encrypt / Tailscale TLS.
  - **Headless Node.js Daemon:** Orchestrator running as `NT SERVICE\Ownbase` completely decoupled from Electron.
  - **Workloads Layer:** Node.js, Python standalone, Go apps, PostgreSQL 16, and FileBrowser.

---

### Slide 5: Core Innovation 1 — Windows Job Objects Supervisor
- **Header:** Process Tree Sandboxing via Win32 Job Objects
- **Key Points:**
  - Problem: Unmanaged child processes become runaway zombies or consume 100% CPU upon crashes.
  - Solution: Custom C# JobHost (`ownbase-jobhost.exe`) assigns child process trees to Win32 Job Objects.
  - Features:
    - Hard memory commit caps (`JOB_OBJECT_LIMIT_PROCESS_MEMORY`).
    - CPU rate control (`JOB_OBJECT_CPU_RATE_CONTROL_ENABLE`).
    - Atomic termination: `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` guarantees zero zombie processes.
    - Formal 7-state machine with exponential backoff and crash-loop circuit breaker.

---

### Slide 6: Core Innovation 2 — Strict Loopback & Forward-Auth Edge
- **Header:** Network Boundary & Ingress Hardening
- **Key Points:**
  - Every backend service binds strictly to `127.0.0.1`.
  - Windows Firewall blocks all inbound ports except 80 and 443 (Private profile).
  - **Forward Authentication:** When an external LAN client requests a service, Caddy proxies the request to `/api/v1/auth/forward-auth`. Only authenticated Ownbase sessions are admitted.
  - **Tailscale Mesh Integration:** Automatic discovery of 100.x.y.z IP and MagicDNS HTTPS certificates without router port forwarding.

---

### Slide 7: Core Innovation 3 — Canonical Filesystem Confinement (`PathGuard`)
- **Header:** Storage Containment & Streaming Engine
- **Key Points:**
  - Replaces fragile regex sanitization with `PathGuard`:
    - Evaluates canonical paths via `fs.realpathSync`.
    - Forbids Windows Alternate Data Streams (`:`).
    - Prevents directory traversal (`..`) and symlink escapes outside declared storage volumes.
  - **Streaming Direct-to-Disk Uploads:** Streams multi-GB files directly to disk with atomic rename; RAM footprint < 100 MB.
  - **RFC 7233 Byte-Range Streaming:** Smooth video seeking and partial downloads.

---

### Slide 8: Core Innovation 4 — Cryptographic Secrets & Backups
- **Header:** Disaster Recovery & Encrypted Backups (Acceptance A2)
- **Key Points:**
  - Database credentials and secrets encrypted via Windows machine DPAPI and AES-256-GCM.
  - Automated Backup Engine (`pg_dump` + config + encrypted secrets key).
  - Produces `.ownbase.bak` archives with SHA-256 integrity checksums.
  - One-click restore recovering users, services, routes, and configs on a fresh VM in under 3 seconds.
  - Strict disaster recovery warning: *"Lose this master key, lose secrets"*.

---

### Slide 9: Implementation Journey across 8 Phases
- **Header:** Engineering Roadmap & Milestones
- **Key Points (Summary Table):**
  - **Phase 0:** Audit & baseline metrics.
  - **Phases 1–3:** Contract-driven API, headless service daemon, Job Objects supervisor.
  - **Phases 4–5:** Multi-runtime engine, NTFS volume discovery, streaming uploads.
  - **Phase 6:** Audited ConPTY Web Terminal, upstream real service catalog, simulator purge.
  - **Phase 7:** Automated encrypted backups, observability engine, ASVS L1 security re-test.
  - **Phase 8:** Packaging, comparative benchmarks, and defense deliverables.

---

### Slide 10: Benchmark Results — Idle Memory Footprint
- **Header:** 93.6% RAM Reduction vs Docker Desktop
- **Data Chart / Bar Graph:**
  - Docker Desktop (WSL2): **1,842.0 MB**
  - Phase 0 Prototype: **201.5 MB**
  - Ownbase Native Daemon: **118.4 MB**
- **Talking Points:**
  - Ownbase enables running a full PostgreSQL 16 database, web API, and FileBrowser on hardware with only 4 GB RAM.
  - No 1.5 GB hypervisor tax.

---

### Slide 11: Benchmark Results — Cold Boot & Deployment Speed
- **Header:** Start-up & Deployment Velocity
- **Cold Boot Time:**
  - Docker Desktop: **24.60 seconds**
  - Ownbase Daemon: **2.12 seconds (11.6x faster)**
- **Application Deploy Time:**
  - Docker Compose: **12.85 seconds** (4 dropped packets)
  - Ownbase Atomic Symlink Switch: **1.41 seconds (9.1x faster, 0 dropped packets)**
- **Talking Points:**
  - Caddy holds connections in memory while the new process warms up; instantaneous cutover with zero downtime.

---

### Slide 12: Benchmark Results — API Gateway Latency
- **Header:** Loopback API Gateway Throughput
- **Test Setup:** 1,000 HTTP requests over 50 concurrent connections.
- **Latency Distribution:**
  - Docker Desktop (WSL2 bridge): p50 = 7.8 ms, p95 = 19.4 ms, p99 = 38.0 ms
  - Ownbase Native Gateway: **p50 = 1.8 ms, p95 = 4.6 ms, p99 = 9.2 ms**
- **SLA Compliance:** Exceeds PRD §7.3 requirement (p95 < 100 ms) by **21.7x**.

---

### Slide 13: Security Verification & ASVS L1 Compliance
- **Header:** Enterprise Security & Vulnerability Remediation
- **Key Points:**
  - **100% OWASP ASVS Level 1 Compliance** verified across 54 automated test suites (227 tests).
  - All 16 baseline vulnerabilities (P1–P16) resolved:
    - No unauthenticated SQL execution (P3).
    - No directory traversal (P4).
    - No hardcoded credentials (P5).
    - No secret leakage in logs or crash dumps (P15).

---

### Slide 14: Usability Study Findings (SUS: 90.5/100)
- **Header:** Developer & Operator Ergonomics
- **Study Demographics:** 5 participants (Junior Dev, Senior Backend, Sysadmin, DevOps, Freelancer).
- **Core Results:**
  - Task: Setup wizard -> Deploy app -> Create route -> Run backup.
  - Task Completion Rate: **100% (5/5)**.
  - Median Completion Time: **2 minutes 52 seconds**.
  - **System Usability Scale (SUS) Score: 90.5 / 100 (Grade A+, Best Imaginable)**.

---

### Slide 15: Audited ConPTY Web Terminal
- **Header:** Secure Host Terminal Management
- **Key Points:**
  - Built on Windows native ConPTY API via WebSocket bridge (`/api/v1/terminal/ws`).
  - Authorization restricted strictly to `ROOT` super-admin role.
  - Full bidirectional audit stream and session transcript logging to disk.
  - Automatic 15-minute inactivity timeout.

---

### Slide 16: Packaging & Delivery
- **Header:** Production Packaging Engine
- **Two Delivery Formats:**
  1. **NSIS Setup Wizard (`.exe`):** Automated service registration (`WinSW`), firewall configuration, ACLs, and desktop shortcuts.
  2. **Portable Standalone Package (`.exe` / `.zip`):** Runs anywhere with zero registry footprint.
- **Integrity Verification:** Automated SHA-256 checksum generation for all releases.

---

### Slide 17: Honest Limitations
- **Header:** System Boundaries & Technical Trade-offs
- **Key Points:**
  - **Single-Node Scope:** Designed for workstations, edge servers, and mini-PCs. No multi-node cluster consensus out of the box.
  - **Kernel Isolation Boundary:** Windows Job Objects provide strict resource caps, but not the complete kernel namespace virtualization of Linux containers.
  - **SmartScreen Reputation:** Unsigned open-source builds require standard "More info -> Run anyway" prompt on first run.

---

### Slide 18: Future Work
- **Header:** Roadmap & Research Directions
- **Key Areas:**
  - **Windows AppContainer Sandboxing:** Kernel-level filesystem and registry virtualization for untrusted workloads without VMs.
  - **Multi-Node Clustering:** Raft/Serf consensus coordination for multi-host failover and storage replication.
  - **MSIX Packaging:** Store-verified signed deployment.

---

### Slide 19: Conclusions
- **Header:** Final Summary & Impact
- **Key Takeaways:**
  - Proved that virtualization is unnecessary for running modern cloud servers on Windows.
  - Achieved **93.6% lower RAM**, **11.6x faster boot**, **9.1x faster deployments**, and **sub-5ms API latency**.
  - Delivered a robust, production-ready, open-source server platform for personal clouds and edge deployments.

---

### Slide 20: Questions & Discussion
- **Header:** Questions & Answers
- **Contact & Repository:**
  - Project Repository: `https://github.com/rhmunna143/Ownbase`
  - Documentation: `docs/` and `docs/evaluation/`
- **Thank you for your time and feedback!**
