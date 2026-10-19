import { contextBridge, ipcRenderer } from 'electron';
import {
  ElectronAPI,
  LogEntry,
  BootstrapStep,
  PostgresStatus,
  ProcessStatus,
  CaddyStatus,
  TailscaleStatus,
  LifecycleStatus,
} from '../shared/types';

const api: ElectronAPI = {
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getPostgresStatus: () => ipcRenderer.invoke('get-postgres-status'),
  getMigrationStatus: () => ipcRenderer.invoke('get-migration-status'),
  getBootstrapSteps: () => ipcRenderer.invoke('get-bootstrap-steps'),
  pingDatabase: () => ipcRenderer.invoke('ping-database'),
  getTableBrowserTables: () => ipcRenderer.invoke('table-browser:get-tables'),
  queryTable: (table: string, options?: any) => ipcRenderer.invoke('table-browser:query-table', table, options),

  getServices: () => ipcRenderer.invoke('get-services'),
  createService: (data) => ipcRenderer.invoke('create-service', data),
  getRoutes: () => ipcRenderer.invoke('get-routes'),
  createRoute: (data) => ipcRenderer.invoke('create-route', data),
  deleteRoute: (routeId: string) => ipcRenderer.invoke('delete-route', routeId),

  // Phase 2: Process Supervisor
  startService: (serviceId: string) => ipcRenderer.invoke('supervisor:start-service', serviceId),
  stopService: (serviceId: string) => ipcRenderer.invoke('supervisor:stop-service', serviceId),
  restartService: (serviceId: string) => ipcRenderer.invoke('supervisor:restart-service', serviceId),
  getProcessStatuses: () => ipcRenderer.invoke('supervisor:get-process-statuses'),
  getServiceLogs: (serviceId: string) => ipcRenderer.invoke('supervisor:get-service-logs', serviceId),

  // Phase 3: Caddy Dynamic Reverse Proxy
  getCaddyStatus: () => ipcRenderer.invoke('caddy:get-status'),
  syncCaddyRoutes: () => ipcRenderer.invoke('caddy:sync-routes'),
  testCaddyRoute: (host: string) => ipcRenderer.invoke('caddy:test-route', host),

  // Phase 3: Tailscale Mesh Tunneling
  getTailscaleStatus: () => ipcRenderer.invoke('tailscale:get-status'),
  connectTailscale: (authKey: string, hostname?: string) => ipcRenderer.invoke('tailscale:connect', authKey, hostname),
  disconnectTailscale: () => ipcRenderer.invoke('tailscale:disconnect'),

  // Phase 4: System Integration & App Lifecycle
  getLifecycleStatus: () => ipcRenderer.invoke('lifecycle:get-status'),
  setAutoStart: (enabled: boolean, openAsHidden?: boolean) => ipcRenderer.invoke('lifecycle:set-auto-start', enabled, openAsHidden),
  setPowerSaveBlocker: (enabled: boolean) => ipcRenderer.invoke('lifecycle:set-power-blocker', enabled),
  minimizeToTray: () => ipcRenderer.invoke('lifecycle:minimize-to-tray'),
  quitApp: () => ipcRenderer.invoke('lifecycle:quit-app'),

  getLogs: () => ipcRenderer.invoke('get-logs'),

  onLogAdded: (callback: (log: LogEntry) => void) => {
    const handler = (_event: any, log: LogEntry) => callback(log);
    ipcRenderer.on('log-added', handler);
    return () => {
      ipcRenderer.removeListener('log-added', handler);
    };
  },

  onBootstrapUpdate: (callback: (steps: BootstrapStep[]) => void) => {
    const handler = (_event: any, steps: BootstrapStep[]) => callback(steps);
    ipcRenderer.on('bootstrap-update', handler);
    return () => {
      ipcRenderer.removeListener('bootstrap-update', handler);
    };
  },

  onPostgresStatusChange: (callback: (status: PostgresStatus) => void) => {
    const handler = (_event: any, status: PostgresStatus) => callback(status);
    ipcRenderer.on('postgres-status-changed', handler);
    return () => {
      ipcRenderer.removeListener('postgres-status-changed', handler);
    };
  },

  onProcessStatusChanged: (callback: (status: ProcessStatus) => void) => {
    const handler = (_event: any, status: ProcessStatus) => callback(status);
    ipcRenderer.on('process-status-changed', handler);
    return () => {
      ipcRenderer.removeListener('process-status-changed', handler);
    };
  },

  onServiceLog: (callback: (data: { serviceId: string; log: LogEntry }) => void) => {
    const handler = (_event: any, data: { serviceId: string; log: LogEntry }) => callback(data);
    ipcRenderer.on('service-log', handler);
    return () => {
      ipcRenderer.removeListener('service-log', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
