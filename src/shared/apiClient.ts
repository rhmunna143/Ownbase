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

// In-Memory Token Store (PRD Item 1.13)
let inMemoryAccessToken: string | null = null;
let inMemoryUser: { id: string; username: string; role: string } | null = null;

export const authStore = {
  getToken: () => inMemoryAccessToken,
  setToken: (token: string | null) => {
    inMemoryAccessToken = token;
  },
  getUser: () => inMemoryUser,
  setUser: (user: { id: string; username: string; role: string } | null) => {
    inMemoryUser = user;
  },
  clear: () => {
    inMemoryAccessToken = null;
    inMemoryUser = null;
  },
};

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (inMemoryAccessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryAccessToken}`);
  }
  options.headers = headers;
  options.credentials = 'include'; // Send cookies (for refresh token)

  let res = await fetch(getApiUrl(url), options);

  // Auto-refresh token if 401 received
  if (res.status === 401 && inMemoryAccessToken) {
    try {
      const refreshRes = await fetch(getApiUrl('/api/v1/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        if (data.accessToken) {
          authStore.setToken(data.accessToken);
          if (data.user) authStore.setUser(data.user);
          headers.set('Authorization', `Bearer ${data.accessToken}`);
          options.headers = headers;
          res = await fetch(getApiUrl(url), options);
        }
      } else {
        authStore.clear();
      }
    } catch {
      authStore.clear();
    }
  }

  return res;
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

  // Read-only Table Browser API (replaces arbitrary executeQuery)
  getTableBrowserTables: async (): Promise<string[]> => {
    if (typeof window !== 'undefined' && window.electronAPI?.getTableBrowserTables) {
      return await window.electronAPI.getTableBrowserTables();
    }
    const res = await fetchWithAuth('/api/v1/db/tables').catch(() => null);
    if (!res || !res.ok) return [];
    const data = await res.json();
    return data.tables || [];
  },

  queryTable: async (
    table: string,
    options: { page?: number; pageSize?: number; orderBy?: string; orderDir?: 'asc' | 'desc' } = {}
  ): Promise<{ rows: any[]; totalCount: number; page: number; pageSize: number; columns: string[]; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI?.queryTable) {
      return await window.electronAPI.queryTable(table, options);
    }
    const params = new URLSearchParams();
    if (options.page) params.set('page', String(options.page));
    if (options.pageSize) params.set('pageSize', String(options.pageSize));
    if (options.orderBy) params.set('orderBy', options.orderBy);
    if (options.orderDir) params.set('orderDir', options.orderDir);

    const res = await fetchWithAuth(`/api/v1/db/tables/${encodeURIComponent(table)}/rows?${params.toString()}`).catch(() => null);
    if (!res || !res.ok) {
      const errData = res ? await res.json().catch(() => ({})) : {};
      return { rows: [], totalCount: 0, page: 1, pageSize: 25, columns: [], error: errData.error || 'Failed to query table' };
    }
    return await res.json();
  },

  // Auth & Identity APIs (PRD Item 1.13)
  getSetupStatus: async (): Promise<{ hasRootUser: boolean }> => {
    const res = await fetch(getApiUrl('/api/v1/setup/status')).catch(() => null);
    return res && res.ok ? await res.json() : { hasRootUser: false };
  },

  executeSetup: async (data: { username: string; password: string; setupToken?: string }): Promise<any> => {
    const res = await fetch(getApiUrl('/api/v1/setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res ? await res.json() : { success: false, error: 'Connection error' };
  },

  login: async (username: string, password: string): Promise<any> => {
    const res = await fetch(getApiUrl('/api/v1/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    }).catch(() => null);
    if (!res) return { success: false, error: 'Network error connecting to login' };
    const data = await res.json();
    if (res.ok && data.accessToken) {
      authStore.setToken(data.accessToken);
      if (data.user) authStore.setUser(data.user);
    }
    return { ok: res.ok, status: res.status, ...data };
  },

  logout: async (): Promise<void> => {
    await fetchWithAuth('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    authStore.clear();
  },

  getAuditLogs: async (limit = 100): Promise<any[]> => {
    const res = await fetchWithAuth(`/api/v1/audit/logs?limit=${limit}`).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getUsers: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/users').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  createUser: async (data: { username: string; password: string; role: string }): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res ? await res.json() : { error: 'Connection error' };
  },

  getApiKeys: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/api-keys').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  createApiKey: async (data: { name: string; role: string; expiresInDays?: number }): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res ? await res.json() : { error: 'Connection error' };
  },

  revokeApiKey: async (id: string): Promise<boolean> => {
    const res = await fetchWithAuth(`/api/v1/api-keys/${id}`, { method: 'DELETE' }).catch(() => null);
    return !!(res && res.ok);
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

  // File Manager & Media Streaming operations
  listFiles: async (path = ''): Promise<any> => {
    const res = await fetch(getApiUrl(`/api/files/list?path=${encodeURIComponent(path)}`)).catch(() => null);
    return res && res.ok ? await res.json() : { currentPath: path, parentPath: null, items: [], totalCount: 0, totalSize: 0 };
  },

  createFolder: async (targetPath: string, folderName: string): Promise<{ success: boolean }> => {
    const res = await fetch(getApiUrl('/api/files/mkdir'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath, folderName }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  renameItem: async (oldPath: string, newName: string): Promise<{ success: boolean }> => {
    const res = await fetch(getApiUrl('/api/files/rename'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newName }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  deleteItem: async (path: string): Promise<{ success: boolean }> => {
    const res = await fetch(getApiUrl('/api/files/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  getFileContent: async (path: string): Promise<{ content: string }> => {
    const res = await fetch(getApiUrl(`/api/files/content?path=${encodeURIComponent(path)}`)).catch(() => null);
    return res && res.ok ? await res.json() : { content: '' };
  },

  uploadFile: async (targetPath: string, file: File): Promise<{ success: boolean; path?: string }> => {
    const res = await fetch(getApiUrl(`/api/files/upload?targetPath=${encodeURIComponent(targetPath)}&filename=${encodeURIComponent(file.name)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  // Google Photos & Memories operations
  getPhotosTimeline: async (favoritesOnly = false, type = 'all'): Promise<any> => {
    const res = await fetch(getApiUrl(`/api/photos/timeline?favoritesOnly=${favoritesOnly}&type=${type}`)).catch(() => null);
    return res && res.ok ? await res.json() : { timeline: [], totalCount: 0, photosCount: 0, videosCount: 0 };
  },

  togglePhotoFavorite: async (path: string): Promise<{ success: boolean; isFavorite: boolean }> => {
    const res = await fetch(getApiUrl('/api/photos/favorite'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, isFavorite: false };
  },

  // Interactive API Documentation
  getApiEndpoints: async (): Promise<any[]> => {
    const res = await fetch(getApiUrl('/api/docs/endpoints')).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getOpenApiSpec: async (): Promise<any> => {
    const res = await fetch(getApiUrl('/api/openapi.json')).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },
};
