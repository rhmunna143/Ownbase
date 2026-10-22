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

// Token & Session Storage (PRD Item 1.13)
let inMemoryAccessToken: string | null = null;
let inMemoryRefreshToken: string | null = null;
let inMemoryUser: { id: string; username: string; role: string } | null = null;

export const authStore = {
  getToken: (): string | null => {
    if (inMemoryAccessToken) return inMemoryAccessToken;
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('ownbase_access_token');
        if (saved) {
          inMemoryAccessToken = saved;
          return inMemoryAccessToken;
        }
      } catch {}
    }
    return null;
  },
  getAccessToken: (): string | null => {
    return authStore.getToken();
  },
  setToken: (token: string | null) => {
    inMemoryAccessToken = token;
    if (typeof window !== 'undefined') {
      try {
        if (token) {
          localStorage.setItem('ownbase_access_token', token);
        } else {
          localStorage.removeItem('ownbase_access_token');
        }
      } catch {}
    }
  },
  getRefreshToken: (): string | null => {
    if (inMemoryRefreshToken) return inMemoryRefreshToken;
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('ownbase_refresh_token');
        if (saved) {
          inMemoryRefreshToken = saved;
          return inMemoryRefreshToken;
        }
      } catch {}
    }
    return null;
  },
  setRefreshToken: (token: string | null) => {
    inMemoryRefreshToken = token;
    if (typeof window !== 'undefined') {
      try {
        if (token) {
          localStorage.setItem('ownbase_refresh_token', token);
        } else {
          localStorage.removeItem('ownbase_refresh_token');
        }
      } catch {}
    }
  },
  getUser: () => {
    if (inMemoryUser) return inMemoryUser;
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('ownbase_user');
        if (saved) {
          inMemoryUser = JSON.parse(saved);
          return inMemoryUser;
        }
      } catch {}
    }
    return null;
  },
  setUser: (user: { id: string; username: string; role: string } | null) => {
    inMemoryUser = user;
    if (typeof window !== 'undefined') {
      try {
        if (user) {
          localStorage.setItem('ownbase_user', JSON.stringify(user));
        } else {
          localStorage.removeItem('ownbase_user');
        }
      } catch {}
    }
  },
  clear: () => {
    inMemoryAccessToken = null;
    inMemoryRefreshToken = null;
    inMemoryUser = null;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('ownbase_access_token');
        localStorage.removeItem('ownbase_refresh_token');
        localStorage.removeItem('ownbase_user');
      } catch {}
    }
  },
};

let activeRefreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (activeRefreshPromise) return activeRefreshPromise;

  activeRefreshPromise = (async () => {
    try {
      const refreshToken = authStore.getRefreshToken();
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.accessToken) {
          authStore.setToken(data.accessToken);
          if (data.newRefreshToken) authStore.setRefreshToken(data.newRefreshToken);
          if (data.user) authStore.setUser(data.user);
          return data.accessToken;
        }
      }

      // If refresh failed with 401/400, clear invalid session
      authStore.clear();
      return null;
    } catch {
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = authStore.getToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  options.headers = headers;
  options.credentials = 'include'; // Send cookies (for refresh token)

  let res = await fetch(url, options);

  // Auto-refresh token if 401 received
  if (res.status === 401 && (token || authStore.getRefreshToken())) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      options.headers = headers;
      res = await fetch(url, options);
    }
  }

  return res;
}

export const serverApi = {
  isElectron: (): boolean => {
    return (
      typeof window !== 'undefined' &&
      (!!(window as any).thinClientAPI?.isElectron || !!(window as any).electronAPI)
    );
  },

  getSystemInfo: async (): Promise<SystemInfo | null> => {
    const res = await fetchWithAuth('/api/v1/system-info').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getPostgresStatus: async (): Promise<PostgresStatus | null> => {
    const res = await fetchWithAuth('/api/v1/postgres-status').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getMigrationStatus: async (): Promise<MigrationStatus | null> => {
    const res = await fetchWithAuth('/api/v1/migration-status').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getBootstrapSteps: async (): Promise<BootstrapStep[]> => {
    const res = await fetchWithAuth('/api/v1/bootstrap-steps').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  pingDatabase: async (): Promise<{ success: boolean; latencyMs: number; error?: string }> => {
    const res = await fetchWithAuth('/api/v1/ping-database', { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, latencyMs: 0, error: 'Web API unreachable' };
  },

  // Read-only Table Browser API (replaces arbitrary executeQuery)
  getTableBrowserTables: async (): Promise<string[]> => {
    const res = await fetchWithAuth('/api/v1/db/tables').catch(() => null);
    if (!res || !res.ok) return [];
    const data = await res.json();
    return data.tables || [];
  },

  queryTable: async (
    table: string,
    options: { page?: number; pageSize?: number; orderBy?: string; orderDir?: 'asc' | 'desc' } = {}
  ): Promise<{ rows: any[]; totalCount: number; page: number; pageSize: number; columns: string[]; error?: string }> => {
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
    const res = await fetch('/api/v1/setup/status').catch(() => null);
    return res && res.ok ? await res.json() : { hasRootUser: false };
  },

  executeSetup: async (data: { username: string; password: string; setupToken?: string }): Promise<any> => {
    const res = await fetch('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res ? await res.json() : { success: false, error: 'Connection error' };
  },

  restoreSession: async (): Promise<{ id: string; username: string; role: string } | null> => {
    const token = await refreshAccessToken();
    if (token) {
      return authStore.getUser();
    }
    return null;
  },

  login: async (username: string, password: string): Promise<any> => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    }).catch(() => null);
    if (!res) return { success: false, error: 'Network error connecting to login' };
    const data = await res.json();
    if (res.ok && data.accessToken) {
      authStore.setToken(data.accessToken);
      if (data.refreshToken) authStore.setRefreshToken(data.refreshToken);
      if (data.user) authStore.setUser(data.user);
    }
    return { ok: res.ok, status: res.status, ...data };
  },

  logout: async (): Promise<void> => {
    const refreshToken = authStore.getRefreshToken();
    await fetchWithAuth('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    }).catch(() => {});
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
    const res = await fetchWithAuth('/api/v1/services').catch(() => null);
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
    const res = await fetchWithAuth('/api/v1/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await res.json();
  },

  startService: async (serviceId: string): Promise<{ success: boolean; pid?: number; error?: string }> => {
    const res = await fetchWithAuth(`/api/v1/services/${serviceId}/start`, { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Failed to connect to server API' };
  },

  stopService: async (serviceId: string): Promise<{ success: boolean; error?: string }> => {
    const res = await fetchWithAuth(`/api/v1/services/${serviceId}/stop`, { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Failed to connect to server API' };
  },

  restartService: async (serviceId: string): Promise<{ success: boolean; pid?: number; error?: string }> => {
    const res = await fetchWithAuth(`/api/v1/services/${serviceId}/restart`, { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Failed to connect to server API' };
  },

  deleteService: async (serviceId: string): Promise<{ success: boolean; error?: string }> => {
    const res = await fetchWithAuth(`/api/v1/services/${serviceId}`, { method: 'DELETE' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Failed to delete service' };
  },

  getServiceLogs: async (serviceId: string): Promise<LogEntry[]> => {
    const res = await fetchWithAuth(`/api/v1/services/${serviceId}/logs`).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getProcessStatuses: async (): Promise<Record<string, ProcessStatus>> => {
    const res = await fetchWithAuth('/api/v1/process-statuses').catch(() => null);
    return res && res.ok ? await res.json() : {};
  },

  getRoutes: async (): Promise<RouteRecord[]> => {
    const res = await fetchWithAuth('/api/v1/routes').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  createRoute: async (data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }): Promise<RouteRecord> => {
    const res = await fetchWithAuth('/api/v1/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Failed to create route (${res.status})` }));
      throw new Error(err.error || err.message || `Failed to create route (${res.status})`);
    }
    return await res.json();
  },

  deleteRoute: async (routeId: string): Promise<boolean> => {
    const res = await fetchWithAuth(`/api/v1/routes/${routeId}`, { method: 'DELETE' }).catch(() => null);
    if (!res || !res.ok) return false;
    const data = await res.json();
    return !!data.success;
  },

  syncCaddyRoutes: async (): Promise<{ success: boolean; count: number; error?: string }> => {
    const res = await fetchWithAuth('/api/v1/caddy/sync', { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, count: 0, error: 'API unreachable' };
  },

  getCaddyStatus: async (): Promise<CaddyStatus | null> => {
    const res = await fetchWithAuth('/api/v1/caddy/status').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  testCaddyRoute: async (
    host: string
  ): Promise<{ success: boolean; status?: number; latencyMs: number; error?: string }> => {
    const res = await fetchWithAuth('/api/v1/caddy/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: 80 }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, latencyMs: 0, error: 'Route test error' };
  },

  getTailscaleStatus: async (): Promise<TailscaleStatus | null> => {
    const res = await fetchWithAuth('/api/v1/tailscale/status').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  connectTailscale: async (
    authKey: string,
    hostname?: string
  ): Promise<{ success: boolean; ip?: string; error?: string }> => {
    const res = await fetchWithAuth('/api/v1/tailscale/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authKey, hostname }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, error: 'Tailscale API unreachable' };
  },

  disconnectTailscale: async (): Promise<{ success: boolean }> => {
    const res = await fetchWithAuth('/api/v1/tailscale/disconnect', { method: 'POST' }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  getLifecycleStatus: async (): Promise<LifecycleStatus | null> => {
    const res = await fetchWithAuth('/api/v1/lifecycle/status').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  setAutoStart: async (
    enabled: boolean,
    openAsHidden = true
  ): Promise<{ success: boolean; autoStart: { enabled: boolean; openAsHidden: boolean }; error?: string }> => {
    const res = await fetchWithAuth('/api/v1/lifecycle/autostart', {
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
    const res = await fetchWithAuth('/api/v1/lifecycle/power-blocker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    return res && res.ok
      ? await res.json()
      : { success: false, powerBlocker: { active: enabled, blockerId: null, type: 'prevent-app-suspension' } };
  },

  minimizeToTray: async (): Promise<void> => {
    if (typeof window !== 'undefined' && (window as any).thinClientAPI?.minimize) {
      (window as any).thinClientAPI.minimize();
    }
  },

  quitApp: async (): Promise<void> => {
    if (typeof window !== 'undefined' && (window as any).thinClientAPI?.close) {
      (window as any).thinClientAPI.close();
    }
  },

  getLogs: async (): Promise<LogEntry[]> => {
    const res = await fetchWithAuth('/api/v1/logs').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  // Event subscription adapters via shared SSE multiplexer
  subscribeToEventStream: (handlers: {
    onConnected?: () => void;
    onSnapshot?: (snapshot: { services: Record<string, ProcessStatus>; postgres: PostgresStatus }) => void;
    onServiceStatus?: (status: ProcessStatus) => void;
    onServiceLog?: (data: { serviceId: string; log: LogEntry }) => void;
    onLog?: (log: LogEntry) => void;
    onPostgresStatus?: (status: PostgresStatus) => void;
    onBootstrapUpdate?: (steps: BootstrapStep[]) => void;
    onMetrics?: (metrics: any) => void;
  }): (() => void) => {
    if (typeof window === 'undefined') return () => {};
    try {
      const token = authStore.getToken();
      const url = token ? `/api/v1/events?token=${encodeURIComponent(token)}` : '/api/v1/events';
      const source = new EventSource(url);

      source.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (!parsed) return;

          if (parsed.type === 'connected') {
            handlers.onConnected?.();
          } else if (parsed.type === 'snapshot' && parsed.data) {
            handlers.onSnapshot?.(parsed.data);
          } else if (parsed.type === 'service-status' && parsed.data) {
            handlers.onServiceStatus?.(parsed.data);
          } else if (parsed.type === 'service-log' && parsed.data) {
            handlers.onServiceLog?.(parsed.data);
          } else if (parsed.type === 'log' && parsed.data) {
            if (parsed.data.source === 'metrics') {
              handlers.onMetrics?.(parsed.data.sample);
            } else {
              handlers.onLog?.(parsed.data);
            }
          } else if (parsed.type === 'postgres-status' && parsed.data) {
            handlers.onPostgresStatus?.(parsed.data);
          } else if (parsed.type === 'bootstrap-update' && parsed.data) {
            handlers.onBootstrapUpdate?.(parsed.data);
          }
        } catch {}
      };

      return () => source.close();
    } catch {
      return () => {};
    }
  },

  onLogAdded: (callback: (log: LogEntry) => void): (() => void) => {
    return serverApi.subscribeToEventStream({ onLog: callback });
  },

  onBootstrapUpdate: (callback: (steps: BootstrapStep[]) => void): (() => void) => {
    return serverApi.subscribeToEventStream({ onBootstrapUpdate: callback });
  },

  onPostgresStatusChange: (callback: (status: PostgresStatus) => void): (() => void) => {
    return serverApi.subscribeToEventStream({ onPostgresStatus: callback });
  },

  onProcessStatusChanged: (callback: (proc: ProcessStatus) => void): (() => void) => {
    return serverApi.subscribeToEventStream({ onServiceStatus: callback });
  },

  onServiceLog: (callback: (data: { serviceId: string; log: LogEntry }) => void): (() => void) => {
    return serverApi.subscribeToEventStream({ onServiceLog: callback });
  },

  // File Manager & Media Streaming operations
  listFiles: async (path = ''): Promise<any> => {
    const res = await fetchWithAuth(`/api/v1/files/list?path=${encodeURIComponent(path)}`).catch(() => null);
    return res && res.ok ? await res.json() : { currentPath: path, parentPath: null, items: [], totalCount: 0, totalSize: 0 };
  },

  createFolder: async (targetPath: string, folderName: string): Promise<{ success: boolean }> => {
    const res = await fetchWithAuth('/api/v1/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath, folderName }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  renameItem: async (oldPath: string, newName: string): Promise<{ success: boolean }> => {
    const res = await fetchWithAuth('/api/v1/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newName }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  deleteItem: async (path: string): Promise<{ success: boolean }> => {
    const res = await fetchWithAuth(`/api/v1/files/delete?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  getFileContent: async (path: string): Promise<{ content: string }> => {
    const res = await fetchWithAuth(`/api/v1/files/stream?path=${encodeURIComponent(path)}`).catch(() => null);
    return res && res.ok ? { content: await res.text() } : { content: '' };
  },

  uploadFile: (
    targetPath: string,
    file: File,
    onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
  ): Promise<{ success: boolean; path?: string }> => {
    return new Promise((resolve) => {
      const url = `/api/v1/files/upload?targetPath=${encodeURIComponent(targetPath)}&filename=${encodeURIComponent(file.name)}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;

      const token = authStore.getToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            const percent = Math.min(100, Math.round((e.loaded / e.total) * 100));
            onProgress({ loaded: e.loaded, total: e.total, percent });
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch {
            resolve({ success: true });
          }
        } else {
          resolve({ success: false });
        }
      };

      xhr.onerror = () => {
        resolve({ success: false });
      };

      xhr.ontimeout = () => {
        resolve({ success: false });
      };

      xhr.send(file);
    });
  },

  uploadBinary: (
    file: File,
    onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
  ): Promise<{ success: boolean; filename: string; path?: string; error?: string }> => {
    return new Promise((resolve) => {
      const url = `/api/v1/services/upload-binary?filename=${encodeURIComponent(file.name)}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;

      const token = authStore.getToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('x-filename', file.name);

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            const percent = Math.min(100, Math.round((e.loaded / e.total) * 100));
            onProgress({ loaded: e.loaded, total: e.total, percent });
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch {
            resolve({ success: true, filename: file.name });
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            resolve({ success: false, filename: file.name, error: err.error });
          } catch {
            resolve({ success: false, filename: file.name, error: `Upload failed (status ${xhr.status})` });
          }
        }
      };

      xhr.onerror = () => resolve({ success: false, filename: file.name, error: 'Network error during upload' });
      xhr.ontimeout = () => resolve({ success: false, filename: file.name, error: 'Upload timed out' });

      xhr.send(file);
    });
  },

  getSystemDrives: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/system/drives').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getStorageAllocation: async (): Promise<{ selectedDrive: string; storageRoot: string; mediaRoot: string; backupsRoot: string }> => {
    const res = await fetchWithAuth('/api/v1/system/storage-allocation').catch(() => null);
    return res && res.ok ? await res.json() : {
      selectedDrive: 'C:',
      storageRoot: 'C:\\ProgramData\\Ownbase\\storage',
      mediaRoot: 'C:\\ProgramData\\Ownbase\\storage\\Photos',
      backupsRoot: 'C:\\ProgramData\\Ownbase\\backups',
    };
  },

  updateStorageAllocation: async (data: { selectedDrive: string; storageRoot: string; mediaRoot: string; backupsRoot: string }): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/system/storage-allocation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  getSshStatus: async (): Promise<{ installed: boolean; running: boolean; port: number; host: string }> => {
    const res = await fetchWithAuth('/api/v1/system/ssh-status').catch(() => null);
    return res && res.ok ? await res.json() : { installed: false, running: false, port: 22, host: '127.0.0.1' };
  },

  toggleSsh: async (enable: boolean): Promise<{ success: boolean; running: boolean; error?: string; command?: string }> => {
    const res = await fetchWithAuth('/api/v1/system/ssh-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, running: false, error: 'Failed to communicate with SSH toggle service' };
  },

  applyFirewallRules: async (): Promise<{ success: boolean; message: string }> => {
    const res = await fetchWithAuth('/api/v1/system/firewall-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, message: 'Failed to apply rules' };
  },

  // Google Photos & Memories operations
  getPhotosTimeline: async (favoritesOnly = false, type = 'all'): Promise<any> => {
    const res = await fetchWithAuth(`/api/v1/photos/timeline?favoritesOnly=${favoritesOnly}&type=${type}`).catch(() => null);
    return res && res.ok ? await res.json() : { timeline: [], totalCount: 0, photosCount: 0, videosCount: 0 };
  },

  togglePhotoFavorite: async (path: string): Promise<{ success: boolean; isFavorite: boolean }> => {
    const res = await fetchWithAuth('/api/v1/photos/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false, isFavorite: false };
  },

  // Interactive API Documentation
  getApiEndpoints: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/docs/endpoints').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getOpenApiSpec: async (): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/openapi.json').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  // ==========================================
  // Phase 4: Apps, Deployments & Catalog
  // ==========================================
  getApps: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/apps').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  createApp: async (data: any): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getApp: async (id: string): Promise<any> => {
    const res = await fetchWithAuth(`/api/v1/apps/${id}`).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  deleteApp: async (id: string): Promise<{ success: boolean }> => {
    const res = await fetchWithAuth(`/api/v1/apps/${id}`, {
      method: 'DELETE',
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  deployApp: async (id: string, data: any = {}): Promise<any> => {
    const res = await fetchWithAuth(`/api/v1/apps/${id}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getDeployments: async (id: string): Promise<any[]> => {
    const res = await fetchWithAuth(`/api/v1/apps/${id}/deployments`).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getReleases: async (id: string): Promise<any[]> => {
    const res = await fetchWithAuth(`/api/v1/apps/${id}/releases`).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  rollbackApp: async (id: string, releaseId: string): Promise<any> => {
    const res = await fetchWithAuth(`/api/v1/apps/${id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ releaseId }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getCatalog: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/catalog').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  installCatalog: async (recipeId: string, options: any = {}): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/catalog/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipeId, ...options }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  // Phase 5 Ingress, Storage & Media
  getNetworkUrls: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/network/urls').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  checkTlsPreflight: async (domain: string): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/network/tls/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  listTcpProxies: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/network/tcp').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  startTcpProxy: async (data: any): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/network/tcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  stopTcpProxy: async (port: number): Promise<{ success: boolean }> => {
    const res = await fetchWithAuth(`/api/v1/network/tcp/${port}`, {
      method: 'DELETE',
    }).catch(() => null);
    return res && res.ok ? await res.json() : { success: false };
  },

  getVolumes: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/storage/volumes').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  refreshVolumes: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/storage/volumes/refresh', {
      method: 'POST',
    }).catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  getStorageMounts: async (): Promise<any[]> => {
    const res = await fetchWithAuth('/api/v1/storage/mounts').catch(() => null);
    return res && res.ok ? await res.json() : [];
  },

  createStorageMount: async (data: any): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/storage/mounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getStorageUsage: async (): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/storage/usage').catch(() => null);
    return res && res.ok ? await res.json() : null;
  },

  getMediaTimeline: async (params: { page?: number; pageSize?: number } = {}): Promise<any> => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const res = await fetchWithAuth(`/api/v1/media/timeline?${qs.toString()}`).catch(() => null);
    return res && res.ok ? await res.json() : { items: [], total: 0 };
  },

  triggerMediaScan: async (library = 'photos'): Promise<any> => {
    const res = await fetchWithAuth('/api/v1/media/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library }),
    }).catch(() => null);
    return res && res.ok ? await res.json() : null;
  },
};

