/**
 * Resolves the accessible URL for a service subdomain based on the client's current network context
 * (localhost, Tailscale Mesh IP, LAN IP, Tailscale MagicDNS, or Custom Domain).
 */
export function getAccessibleServiceUrl(
  subdomain: string,
  targetPort?: number | null,
  customDomain?: string | null,
  tailscaleIp?: string | null,
  explicitToken?: string | null
): string {
  let base = '';

  // 1. If explicit custom domain registered for this route
  if (customDomain && customDomain.trim()) {
    const trimmed = customDomain.trim();
    base = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `http://${trimmed}`;
  } else if (typeof window === 'undefined') {
    base = `http://${subdomain}.localhost`;
  } else {
    const hostname = window.location.hostname.toLowerCase();
    const protocol = window.location.protocol || 'http:';

    // 2. Accessing from server local loopback machine
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      base = `http://${subdomain}.localhost`;
    } else {
      // 3. Accessing via IP address (e.g. Tailscale 100.84.32.40 or LAN 192.168.x.x)
      // Use wildcard nip.io: resolves <subdomain>.<IP>.nip.io to <IP> globally on any device!
      const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
      if (isIp) {
        base = `${protocol}//${subdomain}.${hostname}.nip.io`;
      } else if (hostname.endsWith('.ts.net')) {
        // 4. Accessing via Tailscale MagicDNS (*.ts.net)
        base = `${protocol}//${subdomain}.${hostname}`;
      } else if (hostname.includes('.nip.io')) {
        // 5. Accessing via nip.io already (e.g. hub.100.84.32.40.nip.io)
        const parts = hostname.split('.');
        parts[0] = subdomain;
        base = `${protocol}//${parts.join('.')}`;
      } else if (hostname.includes('.')) {
        // 6. Accessing via custom apex/subdomain (e.g. ownbase.rhmunna.pro.bd)
        const parts = hostname.split('.');
        if (parts.length >= 3) {
          parts[0] = subdomain;
          base = `${protocol}//${parts.join('.')}`;
        } else {
          base = `${protocol}//${subdomain}.${hostname}`;
        }
      } else if (tailscaleIp) {
        // Fallback: If tailscale IP is available
        base = `${protocol}//${subdomain}.${tailscaleIp}.nip.io`;
      } else {
        base = `http://${subdomain}.${hostname}`;
      }
    }
  }

  // Attach token for seamless SSO into protected service subdomains
  if (subdomain !== 'hub' && typeof window !== 'undefined') {
    let token = explicitToken;
    if (!token) {
      try {
        token = localStorage.getItem('ownbase_access_token');
      } catch {}
    }
    if (token) {
      const sep = base.includes('?') ? '&' : '?';
      base += `${sep}token=${encodeURIComponent(token)}`;
    }
  }

  return base;
}
