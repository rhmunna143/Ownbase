'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { BootstrapStepper } from '@/components/BootstrapStepper';
import { DatabaseCard } from '@/components/DatabaseCard';
import { ServicesTable } from '@/components/ServicesTable';
import { RoutesTable } from '@/components/RoutesTable';
import { LifecycleCard } from '@/components/LifecycleCard';
import { LogViewer } from '@/components/LogViewer';
import { DiagnosticsCard } from '@/components/DiagnosticsCard';
import { AppStore } from '@/components/AppStore';
import { NetworkAccessCard } from '@/components/NetworkAccessCard';
import { FileBrowserCard } from '@/components/FileBrowserCard';
import { PhotosGalleryCard } from '@/components/PhotosGalleryCard';
import { ApiDocsCard } from '@/components/ApiDocsCard';
import { SetupWizardModal } from '@/components/SetupWizardModal';
import { LoginModal } from '@/components/LoginModal';
import { SecurityAdminCard } from '@/components/SecurityAdminCard';
import { serverApi, authStore } from '@/shared/apiClient';
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
} from '@/shared/types';
import {
  LayoutDashboard,
  Layers,
  Boxes,
  Globe,
  Database,
  Terminal,
  Settings,
  ShieldCheck,
  Server,
  Activity,
  HardDrive,
  Cpu,
  Power,
  ExternalLink,
  ChevronRight,
  FolderTree,
  Bot,
  Minimize2,
  PowerOff,
  Camera,
  Code,
  X,
  Menu,
  Film,
} from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'files' | 'photos' | 'apidocs' | 'services' | 'store' | 'routes' | 'database' | 'security' | 'settings' | 'logs'
  >('overview');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string; role: string } | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [postgresStatus, setPostgresStatus] = useState<PostgresStatus | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [processStatuses, setProcessStatuses] = useState<Record<string, ProcessStatus>>({});
  const [caddyStatus, setCaddyStatus] = useState<CaddyStatus | null>(null);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState<LifecycleStatus | null>(null);
  const [bootstrapSteps, setBootstrapSteps] = useState<BootstrapStep[]>([
    { id: 'electron-init', name: 'Electron Shell', description: 'Initializing desktop runtime environment', status: 'pending' },
    { id: 'postgres-bin', name: 'PostgreSQL Binaries', description: 'Locating portable PostgreSQL distribution', status: 'pending' },
    { id: 'postgres-initdb', name: 'Database Cluster', description: 'Validating/Initializing data directory (initdb)', status: 'pending' },
    { id: 'postgres-start', name: 'PostgreSQL Engine', description: 'Launching silent postgres.exe process', status: 'pending' },
    { id: 'postgres-port', name: 'TCP Port Probe', description: 'Verifying database port 5432 is listening', status: 'pending' },
    { id: 'prisma-migration', name: 'Prisma Migrations', description: 'Executing programmatic database migrations', status: 'pending' },
    { id: 'prisma-client', name: 'Data Layer', description: 'Initializing Prisma client and verifying models', status: 'pending' },
    { id: 'supervisor-init', name: 'Process Supervisor', description: 'Supervising native processes (caddy, filebrowser, ollama)', status: 'pending' },
    { id: 'caddy-proxy', name: 'Dynamic Reverse Proxy', description: 'Caddy Admin REST API & dynamic routing', status: 'pending' },
    { id: 'tailscale-mesh', name: 'Tailscale Mesh VPN', description: 'WireGuard encrypted mesh overlay', status: 'pending' },
    { id: 'lifecycle-init', name: '24/7 Server Persistence', description: 'System tray & Windows power suspension blocker', status: 'pending' },
    { id: 'ui-ready', name: 'User Interface', description: 'Mounting dashboard and establishing IPC channels', status: 'pending' },
  ]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isElectronAvailable, setIsElectronAvailable] = useState<boolean>(true);

  const fetchAllData = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const hasElectron = serverApi.isElectron();
    setIsElectronAvailable(hasElectron);

    setIsRefreshing(true);
    try {
      const [sys, pg, mig, steps, srvs, rts, initialLogs, procStatuses, caddy, tailscale, life] = await Promise.all([
        serverApi.getSystemInfo().catch(() => null),
        serverApi.getPostgresStatus().catch(() => null),
        serverApi.getMigrationStatus().catch(() => null),
        serverApi.getBootstrapSteps().catch(() => []),
        serverApi.getServices().catch(() => []),
        serverApi.getRoutes().catch(() => []),
        serverApi.getLogs().catch(() => []),
        serverApi.getProcessStatuses().catch(() => ({})),
        serverApi.getCaddyStatus().catch(() => null),
        serverApi.getTailscaleStatus().catch(() => null),
        serverApi.getLifecycleStatus().catch(() => null),
      ]);

      if (sys) setSystemInfo(sys);
      if (pg) setPostgresStatus(pg);
      if (mig) setMigrationStatus(mig);
      if (steps && steps.length > 0) setBootstrapSteps(steps);
      if (srvs) setServices(srvs);
      if (rts) setRoutes(rts);
      if (initialLogs) setLogs(initialLogs);
      if (procStatuses) setProcessStatuses(procStatuses);
      if (caddy) setCaddyStatus(caddy);
      if (tailscale) setTailscaleStatus(tailscale);
      if (life) setLifecycleStatus(life);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname.toLowerCase();
      const search = window.location.search.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const path = window.location.pathname.toLowerCase();
      if (host.startsWith('photos.') || search.includes('tab=photos') || hash === '#photos' || path.startsWith('/photos')) {
        setActiveTab('photos');
      } else if (host.startsWith('files.') || search.includes('tab=files') || hash === '#files' || path.startsWith('/files')) {
        setActiveTab('files');
      } else if (search.includes('tab=security') || hash === '#security') {
        setActiveTab('security');
      }
    }

    serverApi.getSetupStatus().then((status) => {
      if (!status.hasRootUser) {
        setIsSetupWizardOpen(true);
      }
    }).catch(() => {});

    const initialUser = authStore.getUser();
    const initialToken = authStore.getToken();

    if (initialUser && initialToken) {
      setCurrentUser(initialUser);
      fetchAllData();
    } else {
      serverApi.restoreSession().then((restoredUser) => {
        if (restoredUser) {
          setCurrentUser(restoredUser);
        } else {
          setCurrentUser(null);
        }
        fetchAllData();
      }).catch(() => {
        setCurrentUser(null);
        fetchAllData();
      });
    }

    // Event subscriptions via single real-time SSE stream (PRD Item 3.11 & 3.12)
    const unsubStream = serverApi.subscribeToEventStream({
      onSnapshot: (snapshot) => {
        if (snapshot.services) setProcessStatuses(snapshot.services);
        if (snapshot.postgres) setPostgresStatus(snapshot.postgres);
      },
      onServiceStatus: (status) => {
        setProcessStatuses((prev) => ({
          ...prev,
          [status.serviceId]: status,
        }));
      },
      onPostgresStatus: (status) => {
        setPostgresStatus(status);
      },
      onBootstrapUpdate: (steps) => {
        setBootstrapSteps(steps);
      },
      onLog: (log) => {
        setLogs((prev) => [log, ...prev].slice(0, 500));
      },
    });

    // Gentle fallback background sync (60s instead of 8s continuous polling)
    const interval = setInterval(fetchAllData, 60000);

    return () => {
      unsubStream();
      clearInterval(interval);
    };
  }, [fetchAllData]);

  const handlePing = async () => {
    return await serverApi.pingDatabase();
  };

  const handleCreateService = async (data: {
    name: string;
    type: string;
    executable: string;
    port?: number;
    description?: string;
    autoStart?: boolean;
  }) => {
    await serverApi.createService(data);
    fetchAllData();
  };

  const handleCreateServiceWithRoute = async (data: {
    name: string;
    type: string;
    executable: string;
    port: number;
    description: string;
    subdomain: string;
  }) => {
    const svc = await serverApi.createService({
      name: data.name,
      type: data.type,
      executable: data.executable,
      port: data.port,
      description: data.description,
      autoStart: true,
    });

    if (svc && svc.id) {
      await serverApi.createRoute({
        serviceId: svc.id,
        subdomain: data.subdomain,
        targetPort: data.port,
        tlsEnabled: true,
      });
      await serverApi.syncCaddyRoutes();
    }

    fetchAllData();
  };

  const handleStartService = async (serviceId: string) => {
    await serverApi.startService(serviceId);
    fetchAllData();
  };

  const handleStopService = async (serviceId: string) => {
    await serverApi.stopService(serviceId);
    fetchAllData();
  };

  const handleRestartService = async (serviceId: string) => {
    await serverApi.restartService(serviceId);
    fetchAllData();
  };

  const handleGetServiceLogs = async (serviceId: string) => {
    return await serverApi.getServiceLogs(serviceId);
  };

  const handleCreateRoute = async (data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }) => {
    await serverApi.createRoute(data);
    fetchAllData();
  };

  const handleDeleteRoute = async (routeId: string) => {
    await serverApi.deleteRoute(routeId);
    fetchAllData();
  };

  const handleSyncCaddy = async () => {
    await serverApi.syncCaddyRoutes();
  };

  const handleTestRoute = async (host: string) => {
    return await serverApi.testCaddyRoute(host);
  };

  const handleConnectTailscale = async (authKey: string, hostname?: string) => {
    await serverApi.connectTailscale(authKey, hostname);
    fetchAllData();
  };

  const handleDisconnectTailscale = async () => {
    await serverApi.disconnectTailscale();
    fetchAllData();
  };

  const handleToggleAutoStart = async (enabled: boolean) => {
    await serverApi.setAutoStart(enabled);
    fetchAllData();
  };

  const handleTogglePowerBlocker = async (enabled: boolean) => {
    await serverApi.setPowerSaveBlocker(enabled);
    fetchAllData();
  };

  const handleMinimizeToTray = async () => {
    await serverApi.minimizeToTray();
  };

  const handleQuitApp = async () => {
    if (confirm('Are you sure you want to stop all server processes and exit Native Windows Server Hub?')) {
      await serverApi.quitApp();
    }
  };

  const handleLogout = async () => {
    await serverApi.logout();
    setCurrentUser(null);
    fetchAllData();
  };

  const runningServicesCount = services.filter((s) => {
    const p = processStatuses[s.id];
    return p ? p.status === 'running' : s.status === 'running';
  }).length;

  const navigateTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 flex flex-col md:flex-row font-sans overflow-x-hidden">
      {/* ======================================================== */}
      {/* 1. DESKTOP 1PANEL SIDEBAR (Hidden on mobile < md) */}
      {/* ======================================================== */}
      <aside className="hidden md:flex w-64 bg-[#0a0f1b] border-r border-slate-800/80 flex-col justify-between shrink-0 select-none z-20 min-h-screen sticky top-0 h-screen">
        <div className="overflow-y-auto flex-1">
          {/* Brand Header */}
          <div className="p-5 border-b border-slate-800/80 flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-[1px] shadow-lg shadow-blue-600/20">
              <div className="w-full h-full bg-[#0d121f] rounded-[11px] flex items-center justify-center">
                <Server className="w-4 h-4 text-blue-400" />
              </div>
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                Windows Hub
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  1Panel
                </span>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-indicator-active" />
                <span>24/7 Server Engine Active</span>
              </div>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => navigateTab('overview')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'overview'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </div>
              <ChevronRight className={`w-3.5 h-3.5 opacity-60 ${activeTab === 'overview' ? 'text-white' : ''}`} />
            </button>

            {/* NEW: Mobile-Friendly File Browser */}
            <button
              onClick={() => navigateTab('files')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'files'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <FolderTree className="w-4 h-4 text-emerald-400" />
                <span>File Explorer</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Stream
              </span>
            </button>

            {/* NEW: Google Photos & Memories */}
            <button
              onClick={() => navigateTab('photos')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'photos'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Camera className="w-4 h-4 text-indigo-400" />
                <span>Photos &amp; Memories</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                Photos
              </span>
            </button>

            {/* NEW: Universal REST API Explorer */}
            <button
              onClick={() => navigateTab('apidocs')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'apidocs'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Code className="w-4 h-4 text-emerald-400" />
                <span>API Docs &amp; SDK</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                OpenAPI
              </span>
            </button>

            <div className="pt-2 pb-1 px-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Management
            </div>

            <button
              onClick={() => navigateTab('services')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'services'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Layers className="w-4 h-4" />
                <span>Installed Apps</span>
              </div>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  activeTab === 'services' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {runningServicesCount}/{services.length}
              </span>
            </button>

            <button
              onClick={() => navigateTab('store')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'store'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Boxes className="w-4 h-4" />
                <span>App Store</span>
              </div>
              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                1-Click
              </span>
            </button>

            <button
              onClick={() => navigateTab('routes')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'routes'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Globe className="w-4 h-4" />
                <span>Websites &amp; Domains</span>
              </div>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  activeTab === 'routes' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {routes.length}
              </span>
            </button>

            <button
              onClick={() => navigateTab('database')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'database'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Database className="w-4 h-4" />
                <span>PostgreSQL Database</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400">:5432</span>
            </button>

            <button
              onClick={() => navigateTab('security')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'security'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <ShieldCheck className="w-4 h-4 text-purple-400" />
                <span>Security &amp; Users</span>
              </div>
              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30">
                RBAC
              </span>
            </button>

            <button
              onClick={() => navigateTab('settings')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'settings'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Settings className="w-4 h-4" />
                <span>Settings &amp; Power</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => navigateTab('logs')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'logs'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Terminal className="w-4 h-4" />
                <span>System Console Logs</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>
          </nav>
        </div>

        {/* Sidebar Footer: Quick Tray & Persistence Controls */}
        <div className="p-3.5 border-t border-slate-800/80 space-y-2 bg-slate-950/40">
          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] space-y-1">
            <div className="flex items-center justify-between text-slate-300 font-medium">
              <span>Sleep Prevention:</span>
              <span className="text-emerald-400 font-bold">ACTIVE</span>
            </div>
            <div className="text-[10px] text-slate-500">
              Windows power suspension blocked
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={handleMinimizeToTray}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              title="Minimize Hub window to Windows taskbar notification tray"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Hide to Tray</span>
            </button>

            <button
              onClick={handleQuitApp}
              className="p-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-900/50 text-rose-400 border border-rose-800/40 transition-colors"
              title="Stop All Services & Quit"
            >
              <PowerOff className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ======================================================== */}
      {/* 2. MOBILE SLIDE-OUT DRAWER (< md) */}
      {/* ======================================================== */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in"
          />

          {/* Drawer Menu */}
          <div className="relative w-72 max-w-[80vw] bg-[#0a0f1b] border-r border-slate-800 flex flex-col justify-between z-10 p-4 animate-in slide-in-from-left duration-200">
            <div className="overflow-y-auto flex-1 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-400" />
                  <span className="font-bold text-white text-sm">Native Windows Hub</span>
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                <button
                  onClick={() => navigateTab('overview')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'overview' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Dashboard Overview</span>
                </button>

                <button
                  onClick={() => navigateTab('files')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'files' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <FolderTree className="w-4 h-4 text-emerald-400" />
                  <span>File Explorer &amp; Video</span>
                </button>

                <button
                  onClick={() => navigateTab('photos')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'photos' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Camera className="w-4 h-4 text-indigo-400" />
                  <span>Photos &amp; Memories</span>
                </button>

                <button
                  onClick={() => navigateTab('apidocs')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'apidocs' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Code className="w-4 h-4 text-emerald-400" />
                  <span>API Docs &amp; SDK Explorer</span>
                </button>

                <button
                  onClick={() => navigateTab('services')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'services' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Layers className="w-4 h-4 text-blue-400" />
                  <span>Installed Apps ({runningServicesCount})</span>
                </button>

                <button
                  onClick={() => navigateTab('store')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'store' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Boxes className="w-4 h-4 text-purple-400" />
                  <span>1-Click App Store</span>
                </button>

                <button
                  onClick={() => navigateTab('routes')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'routes' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Globe className="w-4 h-4 text-amber-400" />
                  <span>Domains &amp; SSL Proxy</span>
                </button>

                <button
                  onClick={() => navigateTab('database')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'database' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>PostgreSQL 16 (:5432)</span>
                </button>

                <button
                  onClick={() => navigateTab('security')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'security' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-purple-400" />
                  <span>Security &amp; Users</span>
                </button>

                <button
                  onClick={() => navigateTab('settings')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Settings className="w-4 h-4 text-slate-300" />
                  <span>Settings &amp; Power</span>
                </button>

                <button
                  onClick={() => navigateTab('logs')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    activeTab === 'logs' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Terminal className="w-4 h-4 text-slate-400" />
                  <span>Console Logs</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center gap-2">
              <button
                onClick={handleQuitApp}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-rose-950/60 text-rose-400 border border-rose-800/40 text-xs font-semibold"
              >
                <PowerOff className="w-4 h-4" />
                <span>Stop Server</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. MAIN CONTENT AREA */}
      {/* ======================================================== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <Header
          systemInfo={systemInfo}
          onRefresh={fetchAllData}
          isRefreshing={isRefreshing}
          onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          currentUser={currentUser}
          onLoginClick={() => setIsLoginModalOpen(true)}
          onLogoutClick={handleLogout}
        />

        {!isElectronAvailable && (
          <div className="bg-blue-950/40 border-b border-blue-600/30 px-4 sm:px-6 py-2 text-[11px] sm:text-xs text-blue-300 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 live-indicator-active shrink-0" />
              <span className="truncate">Remote Mobile Session • Connected to Windows Server Hub</span>
            </div>
            <span className="text-[9px] sm:text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30 shrink-0">
              Web REST Gateway
            </span>
          </div>
        )}

        <main className="flex-1 p-3.5 sm:p-6 space-y-6 max-w-7xl w-full mx-auto pb-24 md:pb-8">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Architecture Stepper */}
              <BootstrapStepper steps={bootstrapSteps} />

              {/* 4-KPI Status Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="glass-card rounded-2xl p-3.5 sm:p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-1.5">
                    <span className="text-[11px] sm:text-xs font-medium">Relational DB</span>
                    <Database className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-base sm:text-lg font-bold text-white">PostgreSQL 16</div>
                  <div className="text-[10px] sm:text-[11px] font-mono text-emerald-400 mt-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Port 5432 Active</span>
                  </div>
                </div>

                <div className="glass-card rounded-2xl p-3.5 sm:p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-1.5">
                    <span className="text-[11px] sm:text-xs font-medium">Supervised Apps</span>
                    <Layers className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="text-base sm:text-lg font-bold text-white">
                    {runningServicesCount} / {services.length} Running
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-slate-400 mt-1">
                    Native Windows processes
                  </div>
                </div>

                <div className="glass-card rounded-2xl p-3.5 sm:p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-1.5">
                    <span className="text-[11px] sm:text-xs font-medium">Reverse Proxy</span>
                    <Globe className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-base sm:text-lg font-bold text-white">Caddy Gateway</div>
                  <div className="text-[10px] sm:text-[11px] font-mono text-purple-300 mt-1">
                    Port 80 • {routes.length} routes
                  </div>
                </div>

                <div className="glass-card rounded-2xl p-3.5 sm:p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-1.5">
                    <span className="text-[11px] sm:text-xs font-medium">24/7 Server</span>
                    <Power className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-base sm:text-lg font-bold text-white">Persistence Lock</div>
                  <div className="text-[10px] sm:text-[11px] text-amber-300 mt-1">
                    Sleep blocked
                  </div>
                </div>
              </div>

              {/* 1-Click System Self-Diagnosis & Verification */}
              <DiagnosticsCard
                services={services}
                processStatuses={processStatuses}
                onPingDatabase={handlePing}
                onTestRoute={handleTestRoute}
              />

              {/* Mobile, Local Wi-Fi Network & Tailscale VPN Access */}
              <NetworkAccessCard
                systemInfo={systemInfo}
                tailscaleStatus={tailscaleStatus}
                onConnectTailscale={handleConnectTailscale}
                onDisconnectTailscale={handleDisconnectTailscale}
              />

              {/* Quick Launch Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                <div
                  onClick={() => navigateTab('files')}
                  className="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 bg-slate-900/40 hover:border-emerald-500/40 transition-all flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center space-x-3.5">
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <FolderTree className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-sm font-semibold text-white">File &amp; Video Explorer</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        HTTP 206 video streaming &amp; drive
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                </div>

                <div
                  onClick={() => navigateTab('photos')}
                  className="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 bg-slate-900/40 hover:border-indigo-500/40 transition-all flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center space-x-3.5">
                    <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Camera className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-sm font-semibold text-white">Photos &amp; Memories</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Google Photos timeline &amp; albums
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                </div>

                <div
                  onClick={() => navigateTab('apidocs')}
                  className="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 bg-slate-900/40 hover:border-blue-500/40 transition-all flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center space-x-3.5">
                    <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Code className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-sm font-semibold text-white">Universal REST APIs</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        OpenAPI 3.0 docs &amp; runner
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FILE EXPLORER & VIDEO STREAMING */}
          {activeTab === 'files' && <FileBrowserCard />}

          {/* TAB 3: GOOGLE PHOTOS & MEMORIES */}
          {activeTab === 'photos' && <PhotosGalleryCard />}

          {/* TAB 4: API DOCUMENTATION & EXPLORER */}
          {activeTab === 'apidocs' && <ApiDocsCard />}

          {/* TAB 5: INSTALLED SERVICES */}
          {activeTab === 'services' && (
            <ServicesTable
              services={services}
              processStatuses={processStatuses}
              onCreateService={handleCreateService}
              onStartService={handleStartService}
              onStopService={handleStopService}
              onRestartService={handleRestartService}
              getServiceLogs={handleGetServiceLogs}
              isLoading={isRefreshing}
            />
          )}

          {/* TAB 6: 1-CLICK APP STORE */}
          {activeTab === 'store' && (
            <AppStore
              existingServices={services}
              onCreateServiceWithRoute={handleCreateServiceWithRoute}
              onStartService={handleStartService}
            />
          )}

          {/* TAB 7: WEBSITES & DOMAINS */}
          {activeTab === 'routes' && (
            <RoutesTable
              routes={routes}
              services={services}
              caddyStatus={caddyStatus}
              tailscaleStatus={tailscaleStatus}
              onCreateRoute={handleCreateRoute}
              onDeleteRoute={handleDeleteRoute}
              onSyncCaddy={handleSyncCaddy}
              onTestRoute={handleTestRoute}
              onConnectTailscale={handleConnectTailscale}
              onDisconnectTailscale={handleDisconnectTailscale}
              isLoading={isRefreshing}
            />
          )}

          {/* TAB 8: POSTGRESQL DATABASE */}
          {activeTab === 'database' && (
            <div className="space-y-6">
              <DatabaseCard
                postgresStatus={postgresStatus}
                migrationStatus={migrationStatus}
                onPing={handlePing}
              />
            </div>
          )}

          {/* TAB: SECURITY CORE & RBAC (PRD Phase 1) */}
          {activeTab === 'security' && <SecurityAdminCard />}

          {/* TAB 9: SETTINGS & 24/7 POWER */}
          {activeTab === 'settings' && (
            <LifecycleCard
              lifecycleStatus={lifecycleStatus}
              onToggleAutoStart={handleToggleAutoStart}
              onTogglePowerBlocker={handleTogglePowerBlocker}
              onMinimizeToTray={handleMinimizeToTray}
              onQuitApp={handleQuitApp}
              isLoading={isRefreshing}
            />
          )}

          {/* TAB 10: LOGS */}
          {activeTab === 'logs' && (
            <LogViewer logs={logs} onClear={() => setLogs([])} />
          )}
        </main>
      </div>

      {/* ======================================================== */}
      {/* 4. MOBILE BOTTOM NAVIGATION BAR (< md) */}
      {/* ======================================================== */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090d18]/95 backdrop-blur-lg border-t border-slate-800/90 px-2 py-1.5 flex items-center justify-around shadow-2xl">
        <button
          onClick={() => navigateTab('overview')}
          className={`flex flex-col items-center justify-center p-1.5 rounded-xl transition-all min-w-[56px] ${
            activeTab === 'overview' ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Home</span>
        </button>

        <button
          onClick={() => navigateTab('files')}
          className={`flex flex-col items-center justify-center p-1.5 rounded-xl transition-all min-w-[56px] ${
            activeTab === 'files' ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <FolderTree className="w-5 h-5 mb-0.5 text-emerald-400" />
          <span className="text-[10px]">Files</span>
        </button>

        <button
          onClick={() => navigateTab('photos')}
          className={`flex flex-col items-center justify-center p-1.5 rounded-xl transition-all min-w-[56px] ${
            activeTab === 'photos' ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Camera className="w-5 h-5 mb-0.5 text-indigo-400" />
          <span className="text-[10px]">Photos</span>
        </button>

        <button
          onClick={() => navigateTab('services')}
          className={`flex flex-col items-center justify-center p-1.5 rounded-xl transition-all min-w-[56px] ${
            activeTab === 'services' ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-5 h-5 mb-0.5 text-blue-400" />
          <span className="text-[10px]">Apps</span>
        </button>

        <button
          onClick={() => navigateTab('apidocs')}
          className={`flex flex-col items-center justify-center p-1.5 rounded-xl transition-all min-w-[56px] ${
            activeTab === 'apidocs' ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Code className="w-5 h-5 mb-0.5 text-emerald-400" />
          <span className="text-[10px]">APIs</span>
        </button>
      </div>

      {/* Security Modals (PRD Phase 1) */}
      <SetupWizardModal
        isOpen={isSetupWizardOpen}
        onSetupComplete={() => {
          setIsSetupWizardOpen(false);
          setCurrentUser(authStore.getUser());
          fetchAllData();
        }}
      />

      <LoginModal
        isOpen={isLoginModalOpen}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setIsLoginModalOpen(false);
          fetchAllData();
        }}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </div>
  );
}
