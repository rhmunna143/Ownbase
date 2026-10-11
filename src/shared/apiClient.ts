import {
  SystemInfo,
  PostgresStatus,
  MigrationStatus,
  BootstrapStep,
  ServiceRecord,
  RouteRecord,
  LogEntry,
  ProcessStatus,
  CaddyStatus,
  TailscaleStatus,
  LifecycleStatus,
} from './types';

// Detect API base URL: If accessed directly on port 3000 in browser, point /api calls to port 80 where Caddy proxies it
function getApiUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (window.location.port === '3000') {
    return `http://${window.location.hostname}:80${path}`;
  }
  return path;
}

export const serverApi = {
  isElectron: (): boolean => {
    return typeof window !== 'undefined' && !!window.electronAPI;
  },

  getSystemInfo: async (): Promise<SystemInfo | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getSystemInfo();
    }
    const res = await fetch(getApiUrl('/api/system-info')).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getPostgresStatus: async (): Promise<PostgresStatus | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getPostgresStatus();
    }
    const res = await fetch(getApiUrl('/api/postgres-status')).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getMigrationStatus: async (): Promise<MigrationStatus | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getMigrationStatus();
    }
    const res = await fetch(getApiUrl('/api/migration-status')).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getBootstrapSteps: async (): Promise<BootstrapStep[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getBootstrapSteps();
    }
    const res = await fetch(getApiUrl('/api/bootstrap-steps')).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  pingDatabase: async (): Promise<{ success: boolean; latencyMs: number; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.pingDatabase();
    }
    const res = await fetch(getApiUrl('/api/ping-database'), { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, latencyMs: 0, error: 'Web API unreachable' };
  },

  executeQuery: async (sql: string): Promise<{ success: boolean; data?: any; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI?.executeQuery) {
      return await window.electronAPI.executeQuery(sql);
    }
    const res = await fetch(getApiUrl('/api/execute-query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Web API unreachable' };
  },

  getServices: async (): Promise<ServiceRecord[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getServices();
    }
    const res = await fetch(getApiUrl('/api/services')).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  createService: async (data: {
    name: string;
    type: string;
    executable: string;
    port?: number;
    description?: string;
    autoStart?: boolean;
  }): Promise<ServiceRecord> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.createService(data);
    }
    const res = await fetch(getApiUrl('/api/services'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await res.json();
  },

  startService: async (serviceId: string): Promise<{ success: boolean; pid?: number; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.startService(serviceId);
    }
    const res = await fetch(getApiUrl(`/api/services/${serviceId}/start`), { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Failed to connect to server API' };
  },

  stopService: async (serviceId: string): Promise<{ success: boolean; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.stopService(serviceId);
    }
    const res = await fetch(getApiUrl(`/api/services/${serviceId}/stop`), { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Failed to connect to server API' };
  },

  restartService: async (serviceId: string): Promise<{ success: boolean; pid?: number; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.restartService(serviceId);
    }
    const res = await fetch(getApiUrl(`/api/services/${serviceId}/restart`), { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Failed to connect to server API' };
  },

  getServiceLogs: async (serviceId: string): Promise<LogEntry[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getServiceLogs(serviceId);
    }
    const res = await fetch(getApiUrl(`/api/services/${serviceId}/logs`)).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getProcessStatuses: async (): Promise<Record<string, ProcessStatus>> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getProcessStatuses();
    }
    const res = await fetch(getApiUrl('/api/process-statuses')).catch(() => null);
    return res && res.ok ? await res.json() : {};
  },

  getRoutes: async (): Promise<RouteRecord[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getRoutes();
    }
    const res = await fetch(getApiUrl('/api/routes')).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  createRoute: async (data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }): Promise<RouteRecord> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.createRoute(data);
    }
    const res = await fetch(getApiUrl('/api/routes'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await res.json();
  },

  deleteRoute: async (routeId: string): Promise<boolean> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.deleteRoute(routeId);
    }
    const res = await fetch(getApiUrl(`/api/routes/${routeId}`), { method: 'DELETE' }).catch(() => null);
    if (!res || !res.ok) return false;
    const data = await res.json();
    return !!data.success;
  },

  syncCaddyRoutes: async (): Promise<{ success: boolean; count: number; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.syncCaddyRoutes();
    }
    const res = await fetch(getApiUrl('/api/caddy/sync'), { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, count: 0, error: 'API unreachable' };
  },

  getCaddyStatus: async (): Promise<CaddyStatus | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getCaddyStatus?.();
    }
    const res = await fetch(getApiUrl('/api/caddy/status')).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  testCaddyRoute: async (
    host: string
  ): Promise<{ success: boolean; status?: number; latencyMs: number; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.testCaddyRoute(host);
    }
    const res = await fetch(getApiUrl('/api/caddy/test'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: 80 }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, latencyMs: 0, error: 'Route test error' };
  },

  getTailscaleStatus: async (): Promise<TailscaleStatus | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getTailscaleStatus?.();
    }
    const res = await fetch(getApiUrl('/api/tailscale/status')).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  connectTailscale: async (
    authKey: string,
    hostname?: string
  ): Promise<{ success: boolean; ip?: string; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.connectTailscale(authKey, hostname);
    }
    const res = await fetch(getApiUrl('/api/tailscale/connect'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authKey, hostname }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Tailscale API unreachable' };
  },

  disconnectTailscale: async (): Promise<{ success: boolean }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.disconnectTailscale();
    }
    const res = await fetch(getApiUrl('/api/tailscale/disconnect'), { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  getLifecycleStatus: async (): Promise<LifecycleStatus | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getLifecycleStatus?.();
    }
    const res = await fetch(getApiUrl('/api/lifecycle/status')).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  setAutoStart: async (
    enabled: boolean,
    openAsHidden = true
  ): Promise<{ success: boolean; autoStart: { enabled: boolean; openAsHidden: boolean }; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI?.setAutoStart) {
      return await window.electronAPI.setAutoStart(enabled, openAsHidden);
    }
    const res = await fetch(getApiUrl('/api/lifecycle/autostart'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, openAsHidden }),
    }).catch(() => null);
    return res && res.ok
      ? await res.json()
      : { success: false, autoStart: { enabled, openAsHidden } };
  },

  setPowerSaveBlocker: async (
    enabled: boolean
  ): Promise<{ success: boolean; powerBlocker: { active: boolean; blockerId: number | null; type: 'prevent-app-suspension' } }> => {
    if (typeof window !== 'undefined' && window.electronAPI?.setPowerSaveBlocker) {
      return await window.electronAPI.setPowerSaveBlocker(enabled);
    }
    const res = await fetch(getApiUrl('/api/lifecycle/power-blocker'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    return res && res.ok
      ? await res.json()
      : { success: false, powerBlocker: { active: enabled, blockerId: null, type: 'prevent-app-suspension' } };
  },

  minimizeToTray: async (): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI?.minimizeToTray) {
      await window.electronAPI.minimizeToTray();
    }
  },

  quitApp: async (): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI?.quitApp) {
      await window.electronAPI.quitApp();
    }
  },

  getLogs: async (): Promise<LogEntry[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.getLogs();
    }
    const res = await fetch(getApiUrl('/api/logs')).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  // Event subscription adapters
  onLogAdded: (callback: (log: LogEntry) => void): (() => void) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.onLogAdded(callback);
    }
    return () => {};
  },

  onBootstrapUpdate: (callback: (steps: BootstrapStep[]) => void): (() => void) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.onBootstrapUpdate(callback);
    }
    return () => {};
  },

  onPostgresStatusChange: (callback: (status: PostgresStatus) => void): (() => void) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.onPostgresStatusChange(callback);
    }
    return () => {};
  },

  onProcessStatusChanged: (callback: (proc: ProcessStatus) => void): (() => void) => {
    if (typeof window !== 'undefined' && window.electronAPI?.onProcessStatusChanged) {
      return window.electronAPI.onProcessStatusChanged(callback);
    }
    return () => {};
  },

  onServiceLog: (callback: (data: { serviceId: string; log: LogEntry }) => void): (() => void) => {
    if (typeof window !== 'undefined' && window.electronAPI?.onServiceLog) {
      return window.electronAPI.onServiceLog(callback);
    }
    return () => {};
  },
};
