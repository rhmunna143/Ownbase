export interface PostgresStatus {
  state: 'uninitialized' | 'initializing' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  port: number;
  pid?: number;
  dataDir: string;
  binDir: string;
  version?: string;
  isPortListening: boolean;
  canConnect: boolean;
  error?: string;
}

export interface MigrationStatus {
  state: 'idle' | 'running' | 'applied' | 'error';
  migrationsCount?: number;
  appliedAt?: string;
  error?: string;
}

export interface BootstrapStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'success' | 'error';
  detail?: string;
  timestamp?: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  release: string;
  nodeVersion: string;
  electronVersion: string;
  appDataDir: string;
  appVersion: string;
  totalMemoryMb: number;
  freeMemoryMb: number;
}

export interface ServiceRecord {
  id: string;
  name: string;
  type: string;
  executable: string;
  port: number | null;
  status: string;
  autoStart: boolean;
  pid: number | null;
  description: string | null;
  config: any;
  createdAt: string;
  updatedAt: string;
  routes?: RouteRecord[];
}

export interface RouteRecord {
  id: string;
  serviceId: string;
  subdomain: string;
  targetPort: number;
  targetHost: string;
  tlsEnabled: boolean;
  customDomain: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  service?: {
    name: string;
    type: string;
  };
}

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'success';
  source: 'electron' | 'postgres' | 'prisma' | 'ipc' | 'system';
  message: string;
  timestamp: string;
}

export interface ElectronAPI {
  getSystemInfo: () => Promise<SystemInfo>;
  getPostgresStatus: () => Promise<PostgresStatus>;
  getMigrationStatus: () => Promise<MigrationStatus>;
  getBootstrapSteps: () => Promise<BootstrapStep[]>;
  pingDatabase: () => Promise<{ success: boolean; latencyMs: number; time?: string; error?: string }>;
  
  // Prisma operations
  getServices: () => Promise<ServiceRecord[]>;
  createService: (data: {
    name: string;
    type: string;
    executable: string;
    port?: number;
    description?: string;
    autoStart?: boolean;
  }) => Promise<ServiceRecord>;
  getRoutes: () => Promise<RouteRecord[]>;
  createRoute: (data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }) => Promise<RouteRecord>;
  
  // Logs
  getLogs: () => Promise<LogEntry[]>;
  onLogAdded: (callback: (log: LogEntry) => void) => () => void;
  onBootstrapUpdate: (callback: (steps: BootstrapStep[]) => void) => () => void;
  onPostgresStatusChange: (callback: (status: PostgresStatus) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
