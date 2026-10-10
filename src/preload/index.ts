import { contextBridge, ipcRenderer } from 'electron';
import { ElectronAPI, LogEntry, BootstrapStep, PostgresStatus, ProcessStatus } from '../shared/types';

const api: ElectronAPI = {
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getPostgresStatus: () => ipcRenderer.invoke('get-postgres-status'),
  getMigrationStatus: () => ipcRenderer.invoke('get-migration-status'),
  getBootstrapSteps: () => ipcRenderer.invoke('get-bootstrap-steps'),
  pingDatabase: () => ipcRenderer.invoke('ping-database'),

  getServices: () => ipcRenderer.invoke('get-services'),
  createService: (data) => ipcRenderer.invoke('create-service', data),
  getRoutes: () => ipcRenderer.invoke('get-routes'),
  createRoute: (data) => ipcRenderer.invoke('create-route', data),

  // Phase 2: Process Supervisor
  startService: (serviceId: string) => ipcRenderer.invoke('supervisor:start-service', serviceId),
  stopService: (serviceId: string) => ipcRenderer.invoke('supervisor:stop-service', serviceId),
  restartService: (serviceId: string) => ipcRenderer.invoke('supervisor:restart-service', serviceId),
  getProcessStatuses: () => ipcRenderer.invoke('supervisor:get-process-statuses'),
  getServiceLogs: (serviceId: string) => ipcRenderer.invoke('supervisor:get-service-logs', serviceId),

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
