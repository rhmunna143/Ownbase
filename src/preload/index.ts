import { contextBridge, ipcRenderer } from 'electron';
import { ElectronAPI, LogEntry, BootstrapStep, PostgresStatus } from '../shared/types';

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
};

contextBridge.exposeInMainWorld('electronAPI', api);
