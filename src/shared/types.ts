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
  localIp?: string;
  tailscaleIp?: string;
  allIps?: string[];
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

export interface ProcessStatus {
  serviceId: string;
  name: string;
  type: string;
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'crashed';
  pid?: number;
  startTime?: string;
  restartCount: number;
  error?: string;
}

export interface CaddyStatus {
  adminApiUrl: string;
  isListening: boolean;
  activeRoutesCount: number;
  error?: string;
}

export interface TailscaleStatus {
  connected: boolean;
  ip: string | null;
  binaryPath: string;
  authKeyMasked?: string;
  lastChecked?: string;
  error?: string;
}

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'success';
  source: 'electron' | 'postgres' | 'prisma' | 'ipc' | 'system' | 'supervisor' | 'caddy' | 'filebrowser' | 'ollama' | 'tailscale' | string;
  message: string;
  timestamp: string;
  serviceId?: string;
}

export interface ElectronAPI {
  getSystemInfo: () => Promise<SystemInfo>;
  getPostgresStatus: () => Promise<PostgresStatus>;
  getMigrationStatus: () => Promise<MigrationStatus>;
  getBootstrapSteps: () => Promise<BootstrapStep[]>;
  pingDatabase: () => Promise<{ success: boolean; latencyMs: number; time?: string; error?: string }>;
  executeQuery?: (sql: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  
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
  deleteRoute: (routeId: string) => Promise<boolean>;
  
  // Phase 2: Process Supervisor operations
  startService: (serviceId: string) => Promise<{ success: boolean; pid?: number; error?: string }>;
  stopService: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
  restartService: (serviceId: string) => Promise<{ success: boolean; pid?: number; error?: string }>;
  getProcessStatuses: () => Promise<Record<string, ProcessStatus>>;
  getServiceLogs: (serviceId: string) => Promise<LogEntry[]>;
  
  // Phase 3: Networking & Dynamic Proxy Routing
  getCaddyStatus: () => Promise<CaddyStatus>;
  syncCaddyRoutes: () => Promise<{ success: boolean; count: number; error?: string }>;
  testCaddyRoute: (host: string) => Promise<{ success: boolean; status?: number; latencyMs: number; error?: string }>;
  
  // Phase 3: Tailscale Mesh Tunneling
  getTailscaleStatus: () => Promise<TailscaleStatus>;
  connectTailscale: (authKey: string, hostname?: string) => Promise<{ success: boolean; ip?: string; error?: string }>;
  disconnectTailscale: () => Promise<{ success: boolean; error?: string }>;

  // Phase 4: System Integration & App Lifecycle
  getLifecycleStatus: () => Promise<LifecycleStatus>;
  setAutoStart: (enabled: boolean, openAsHidden?: boolean) => Promise<{ success: boolean; autoStart: { enabled: boolean; openAsHidden: boolean } }>;
  setPowerSaveBlocker: (enabled: boolean) => Promise<{ success: boolean; powerBlocker: { active: boolean; blockerId: number | null; type: 'prevent-app-suspension' } }>;
  minimizeToTray: () => Promise<void>;
  quitApp: () => Promise<void>;

  // Logs & Events
  getLogs: () => Promise<LogEntry[]>;
  onLogAdded: (callback: (log: LogEntry) => void) => () => void;
  onBootstrapUpdate: (callback: (steps: BootstrapStep[]) => void) => () => void;
  onPostgresStatusChange: (callback: (status: PostgresStatus) => void) => () => void;
  onProcessStatusChanged: (callback: (status: ProcessStatus) => void) => () => void;
  onServiceLog: (callback: (data: { serviceId: string; log: LogEntry }) => void) => () => void;
}

export interface LifecycleStatus {
  trayActive: boolean;
  isMinimizedToTray: boolean;
  powerBlocker: {
    active: boolean;
    blockerId: number | null;
    type: 'prevent-app-suspension';
  };
  autoStart: {
    enabled: boolean;
    openAsHidden: boolean;
  };
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  extension: string;
  mimeType: string;
  isVideo: boolean;
  isImage: boolean;
  isAudio: boolean;
  isText: boolean;
}

export interface FileListResponse {
  currentPath: string;
  parentPath: string | null;
  items: FileItem[];
  totalCount: number;
  totalSize: number;
  storageRoot: string;
}

export interface PhotoItem {
  id: string;
  name: string;
  path: string;
  type: 'photo' | 'video';
  mimeType: string;
  size: number;
  date: string;
  dateFormatted: string;
  groupKey: string;
  mediaUrl: string;
  streamUrl: string;
  isFavorite: boolean;
  durationSec?: number;
}

export interface PhotoTimelineSection {
  dateHeader: string;
  items: PhotoItem[];
}

export interface PhotosResponse {
  timeline: PhotoTimelineSection[];
  totalCount: number;
  photosCount: number;
  videosCount: number;
}

export interface ApiEndpointDoc {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  category: string;
  summary: string;
  description: string;
  parameters?: Array<{
    name: string;
    type: string;
    required?: boolean;
    description: string;
    in: 'query' | 'body' | 'path';
    default?: any;
  }>;
  sampleRequest?: any;
  sampleResponse?: any;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

