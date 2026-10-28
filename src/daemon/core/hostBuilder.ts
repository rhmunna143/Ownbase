import os from 'os';
import { logger } from './logger';
import { eventBus } from './events';

export interface RouteIntent {
  subdomain: string;
  targetPort: number;
  targetHost?: string;
  customDomains?: string[];
  exposeLocal?: boolean;
  exposeLan?: boolean;
  exposeMesh?: boolean;
  tlsEnabled?: boolean;
  requiresAuth?: boolean;
}

export interface DerivedRouteUrl {
  type: 'local' | 'lan' | 'mesh' | 'custom';
  url: string;
  hostname: string;
  port: number;
  protocol: 'http' | 'https';
  warning?: string;
}

export interface RouteHostBuildResult {
  subdomain: string;
  caddyMatchers: string[];
  urls: DerivedRouteUrl[];
}

export interface NetworkInterfacesState {
  localIp: string;
  lanIps: string[];
  tailscaleIp?: string;
  tailscaleDomain?: string;
}

export class HostBuilder {
  private currentState: NetworkInterfacesState = {
    localIp: '127.0.0.1',
    lanIps: [],
  };
  private pollInterval?: NodeJS.Timeout;
  private changeListeners: Array<(state: NetworkInterfacesState) => void> = [];

  constructor() {
    this.refreshInterfaces();
  }

  /**
   * Refreshes local network interfaces and returns current IP state.
   */
  public refreshInterfaces(): NetworkInterfacesState {
    const interfaces = os.networkInterfaces();
    const lanIps: string[] = [];
    let detectedLanIp = '127.0.0.1';
    let detectedTailscaleIp: string | undefined;

    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;

      const isTailscaleNic = name.toLowerCase().includes('tailscale');

      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
          if (isTailscaleNic || net.address.startsWith('100.')) {
            detectedTailscaleIp = net.address;
          } else {
            lanIps.push(net.address);
            if (detectedLanIp === '127.0.0.1') {
              detectedLanIp = net.address;
            }
          }
        }
      }
    }

    const previousLanIp = this.currentState.localIp;
    const previousTsIp = this.currentState.tailscaleIp;

    this.currentState = {
      localIp: detectedLanIp,
      lanIps,
      tailscaleIp: detectedTailscaleIp,
      tailscaleDomain: this.currentState.tailscaleDomain,
    };

    if (previousLanIp !== '127.0.0.1' && previousLanIp !== detectedLanIp) {
      logger.info('host-builder', `Primary LAN IP changed from ${previousLanIp} to ${detectedLanIp}`);
      this.notifyChange();
    } else if (previousTsIp !== detectedTailscaleIp && detectedTailscaleIp) {
      logger.info('host-builder', `Tailscale IP updated: ${detectedTailscaleIp}`);
      this.notifyChange();
    }

    return this.currentState;
  }

  /**
   * Set custom Tailscale MagicDNS domain name (e.g. node.tailnet.ts.net).
   */
  public setTailscaleDomain(domain?: string) {
    if (this.currentState.tailscaleDomain !== domain) {
      this.currentState.tailscaleDomain = domain;
      this.notifyChange();
    }
  }

  public getNetworkState(): NetworkInterfacesState {
    return { ...this.currentState };
  }

  /**
   * Register a callback triggered when network interfaces or primary IPs change.
   */
  public onNetworkChange(listener: (state: NetworkInterfacesState) => void) {
    this.changeListeners.push(listener);
  }

  private notifyChange() {
    for (const listener of this.changeListeners) {
      try {
        listener(this.currentState);
      } catch (err: any) {
        logger.error('host-builder', `Error in network change listener: ${err.message}`);
      }
    }
  }

  /**
   * Start periodic network monitoring (default every 15s).
   */
  public startWatcher(intervalMs = 15000) {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => {
      this.refreshInterfaces();
    }, intervalMs);
  }

  public stopWatcher() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  /**
   * Builds Caddy host matchers and derived URLs for a given route intent.
   * Stale nip.io domains are never stored; they are derived on-the-fly.
   */
  public build(intent: RouteIntent, stateOverride?: Partial<NetworkInterfacesState>): RouteHostBuildResult {
    const state: NetworkInterfacesState = {
      ...this.currentState,
      ...stateOverride,
    };

    const exposeLocal = intent.exposeLocal ?? true;
    const exposeLan = intent.exposeLan ?? true;
    const exposeMesh = intent.exposeMesh ?? true;
    const isHttps = intent.tlsEnabled ?? true;

    const matchers: string[] = [];
    const urls: DerivedRouteUrl[] = [];

    const normSubdomain = intent.subdomain.trim().toLowerCase();

    // 1. Local loopback (*.localhost)
    if (exposeLocal) {
      const localHost = `${normSubdomain}.localhost`;
      matchers.push(localHost);
      urls.push({
        type: 'local',
        hostname: localHost,
        url: `http://${localHost}`,
        port: 80,
        protocol: 'http',
      });
    }

    // 2. Local LAN (*.<lan-ip>.nip.io and *.local)
    if (exposeLan) {
      const addedLanIps = new Set<string>();
      if (state.lanIps && state.lanIps.length > 0) {
        for (const ip of state.lanIps) {
          if (ip !== '127.0.0.1' && !addedLanIps.has(ip)) {
            addedLanIps.add(ip);
            const lanHost = `${normSubdomain}.${ip}.nip.io`;
            matchers.push(lanHost);
            urls.push({
              type: 'lan',
              hostname: lanHost,
              url: `http://${lanHost}`,
              port: 80,
              protocol: 'http',
              warning: !intent.requiresAuth ? 'Route is reachable by anyone on your local network without authentication' : undefined,
            });
          }
        }
      } else if (state.localIp && state.localIp !== '127.0.0.1') {
        const lanHost = `${normSubdomain}.${state.localIp}.nip.io`;
        matchers.push(lanHost);
        urls.push({
          type: 'lan',
          hostname: lanHost,
          url: `http://${lanHost}`,
          port: 80,
          protocol: 'http',
          warning: !intent.requiresAuth ? 'Route is reachable by anyone on your local network without authentication' : undefined,
        });
      }

      // Also add mDNS *.local host
      matchers.push(`${normSubdomain}.local`);
    }

    // 3. Tailscale mesh (*.ts.net or *.<ts-ip>.nip.io)
    if (exposeMesh) {
      if (state.tailscaleDomain) {
        const meshHost = `${normSubdomain}.${state.tailscaleDomain}`;
        matchers.push(meshHost);
        urls.push({
          type: 'mesh',
          hostname: meshHost,
          url: `https://${meshHost}`,
          port: 443,
          protocol: 'https',
        });
      }
      if (state.tailscaleIp) {
        const meshIpHost = `${normSubdomain}.${state.tailscaleIp}.nip.io`;
        matchers.push(meshIpHost);
        urls.push({
          type: 'mesh',
          hostname: meshIpHost,
          url: `http://${meshIpHost}`,
          port: 80,
          protocol: 'http',
        });
      }
    }

    // 4. Custom domains
    if (intent.customDomains && intent.customDomains.length > 0) {
      for (const cd of intent.customDomains) {
        const trimmed = cd.trim().toLowerCase();
        if (trimmed) {
          matchers.push(trimmed);
          urls.push({
            type: 'custom',
            hostname: trimmed,
            url: `${isHttps ? 'https' : 'http'}://${trimmed}`,
            port: isHttps ? 443 : 80,
            protocol: isHttps ? 'https' : 'http',
          });
        }
      }
    }

    return {
      subdomain: normSubdomain,
      caddyMatchers: Array.from(new Set(matchers)),
      urls,
    };
  }
}

export const hostBuilder = new HostBuilder();
