# ADR-004: Remote Access via Tailscale Mesh and Automatic TLS Certificates (Spike S4)

**Status:** Accepted (Spike S4: PASS)  
**Date:** October 19, 2026  
**Deciders:** Core Engineering Team  
**Consulted:** `UPGRADE_PRD.md` Section 3.2 (Decisions D3, D9), Spike S4

---

## Context and Problem Statement
Self-hosting servers on residential or office Windows machines frequently encounters Carrier-Grade NAT (CGNAT), dynamic IPs, ISP port 80/443 blocking, and complex router port forwarding configurations. Exposing ports directly to the internet poses high attack surface risks. Users need a seamless, secure way to access their Ownbase dashboard and deployed web apps remotely from mobile devices or other computers without opening router ports.

## Decision
We adopt **Tailscale** as the primary remote exposure and mesh networking mechanism:
1. **Daemon-Managed Tailscale Engine:** Tailscale CLI runs locally, joining an authorized tailnet via user-provided auth key passed securely via environment variable or stdin (never command-line arguments, per finding P5).
2. **MagicDNS & Tailscale TLS (`ts.net`):** Tailscale provides machine hostnames (`*.ts.net`) and generates valid Let's Encrypt certificates directly via the local Tailscale daemon (`tailscale cert`).
3. **Caddy Reverse Proxy Integration:** Caddy mounts the Tailscale certificate and routes traffic addressed to `<machine>.ts.net` into the internal service mesh.
4. **Tailscale Funnel (Optional Public Exposure):** For users wanting public internet access without port forwarding, Tailscale Funnel securely routes public HTTPS traffic to the local Caddy ingress.

## Spike S4 Evaluation Results
- **Test:** Installed and authenticated local Tailscale instance using an ephemeral auth key. Generated TLS certificate using `tailscale cert` and loaded into Caddy.
- **Verification:**
  1. Connected to dashboard and services from an iOS/Android client on mobile cellular network via the tailnet IP and `*.ts.net` domain.
  2. Verified valid Let's Encrypt HTTPS certificate loaded without browser warnings.
  3. Verified non-mesh LAN traffic remains blocked from directly accessing internal ports (`3001`, `5432`).
- **Result:** **PASS.**

## Consequences
- **Positive:** Zero port forwarding needed, bypasses CGNAT completely, free automatic HTTPS certificates, end-to-end WireGuard encryption.
- **Negative:** Requires user to have a free Tailscale account.
- **Alternative:** For purely local LAN setups, Caddy generates local self-signed internal CA certificates or uses `nip.io` with optional custom ACME.
