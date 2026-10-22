/**
 * Resolves the accessible URL for a service subdomain based on the client's current network context
 * (localhost, Tailscale Mesh IP, LAN IP, Tailscale MagicDNS, or Custom Domain).
 */
export function getAccessibleServiceUrl(
  subdomain: string,
  targetPort?: number | null,
  customDomain?: string | null,
  tailscaleIp?: string | null
): string {
  // 1. If explicit custom domain registered for this route
  if (customDomain && customDomain.trim()) {
    const trimmed = customDomain.trim();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `http://${trimmed}`;
  }

  if (typeof window === 'undefined') {
    return `http://${subdomain}.localhost`;
  }

  const hostname = window.location.hostname.toLowerCase();
  const protocol = window.location.protocol || 'http:';

  // 2. Accessing from server local loopback machine
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `http://${subdomain}.localhost`;
  }

  // 3. Accessing via IP address (e.g. Tailscale 100.84.32.40 or LAN 192.168.x.x)
  // Use wildcard nip.io: resolves <subdomain>.<IP>.nip.io to <IP> globally on any device!
  const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  if (isIp) {
    return `${protocol}//${subdomain}.${hostname}.nip.io`;
  }

  // 4. Accessing via Tailscale MagicDNS (*.ts.net)
  if (hostname.endsWith('.ts.net')) {
    return `${protocol}//${subdomain}.${hostname}`;
  }

  // 5. Accessing via nip.io already (e.g. hub.100.84.32.40.nip.io)
  if (hostname.includes('.nip.io')) {
    const parts = hostname.split('.');
    parts[0] = subdomain;
    return `${protocol}//${parts.join('.')}`;
  }

  // 6. Accessing via custom apex/subdomain (e.g. ownbase.rhmunna.pro.bd)
  if (hostname.includes('.')) {
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      parts[0] = subdomain;
      return `${protocol}//${parts.join('.')}`;
    }
    return `${protocol}//${subdomain}.${hostname}`;
  }

  // Fallback: If tailscale IP is available
  if (tailscaleIp) {
    return `${protocol}//${subdomain}.${tailscaleIp}.nip.io`;
  }

  return `http://${subdomain}.${hostname}`;
}
