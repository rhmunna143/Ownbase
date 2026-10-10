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
} from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'services' | 'store' | 'routes' | 'database' | 'settings' | 'logs'
  >('overview');
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

    if (!window.electronAPI) {
      setIsElectronAvailable(false);
      return;
    }

    setIsRefreshing(true);
    try {
      const [sys, pg, mig, steps, srvs, rts, initialLogs, procStatuses, caddy, tailscale, life] = await Promise.all([
        window.electronAPI.getSystemInfo().catch(() => null),
        window.electronAPI.getPostgresStatus().catch(() => null),
        window.electronAPI.getMigrationStatus().catch(() => null),
        window.electronAPI.getBootstrapSteps().catch(() => []),
        window.electronAPI.getServices().catch(() => []),
        window.electronAPI.getRoutes().catch(() => []),
        window.electronAPI.getLogs().catch(() => []),
        window.electronAPI.getProcessStatuses().catch(() => ({})),
        window.electronAPI.getCaddyStatus?.().catch(() => null),
        window.electronAPI.getTailscaleStatus?.().catch(() => null),
        window.electronAPI.getLifecycleStatus?.().catch(() => null),
      ]);

      if (sys) setSystemInfo(sys);
      if (pg) setPostgresStatus(pg);
      if (mig) setMigrationStatus(mig);
      if (steps && steps.length > 0) setBootstrapSteps(steps);
      setServices(srvs || []);
      setRoutes(rts || []);
      setLogs(initialLogs || []);
      setProcessStatuses(procStatuses || {});
      if (caddy) setCaddyStatus(caddy);
      if (tailscale) setTailscaleStatus(tailscale);
      if (life) setLifecycleStatus(life);
    } catch (e) {
      console.error('Data fetch error:', e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();

    if (typeof window !== 'undefined' && window.electronAPI) {
      const cleanupLog = window.electronAPI.onLogAdded((log) => {
        setLogs((prev) => [...prev, log]);
      });

      const cleanupSteps = window.electronAPI.onBootstrapUpdate((steps) => {
        setBootstrapSteps(steps);
      });

      const cleanupPg = window.electronAPI.onPostgresStatusChange((status) => {
        setPostgresStatus(status);
      });

      const cleanupProcStatus = window.electronAPI.onProcessStatusChanged?.((proc) => {
        setProcessStatuses((prev) => ({
          ...prev,
          [proc.serviceId]: proc,
        }));
        setServices((prev) =>
          prev.map((s) =>
            s.id === proc.serviceId ? { ...s, status: proc.status, pid: proc.pid ?? null } : s
          )
        );
      });

      const cleanupServiceLog = window.electronAPI.onServiceLog?.(({ log }) => {
        setLogs((prev) => [...prev, log]);
      });

      return () => {
        cleanupLog?.();
        cleanupSteps?.();
        cleanupPg?.();
        cleanupProcStatus?.();
        cleanupServiceLog?.();
      };
    }
  }, [fetchAllData]);

  const handlePing = async () => {
    if (!window.electronAPI) {
      return { success: false, latencyMs: 0, error: 'Electron IPC unavailable' };
    }
    return await window.electronAPI.pingDatabase();
  };

  const handleStartService = async (serviceId: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.startService(serviceId);
    if (!res.success && res.error) {
      alert(`Start failed: ${res.error}`);
    }
    await fetchAllData();
  };

  const handleStopService = async (serviceId: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.stopService(serviceId);
    await fetchAllData();
  };

  const handleRestartService = async (serviceId: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.restartService(serviceId);
    await fetchAllData();
  };

  const handleGetServiceLogs = async (serviceId: string) => {
    if (!window.electronAPI) return [];
    return await window.electronAPI.getServiceLogs(serviceId);
  };

  const handleCreateService = async (data: {
    name: string;
    type: string;
    executable: string;
    port?: number;
    description?: string;
    autoStart?: boolean;
  }) => {
    if (!window.electronAPI) return;
    const newService = await window.electronAPI.createService(data);
    setServices((prev) => [...prev, newService]);
    await fetchAllData();
  };

  const handleCreateServiceWithRoute = async (data: {
    name: string;
    type: string;
    executable: string;
    port: number;
    subdomain: string;
    description: string;
    autoStart: boolean;
  }) => {
    if (!window.electronAPI) return;
    const newService = await window.electronAPI.createService({
      name: data.name,
      type: data.type,
      executable: data.executable,
      port: data.port,
      description: data.description,
      autoStart: data.autoStart,
    });
    if (newService && newService.id) {
      await window.electronAPI.createRoute({
        serviceId: newService.id,
        subdomain: data.subdomain,
        targetPort: data.port,
        tlsEnabled: true,
      });
      await window.electronAPI.startService(newService.id);
    }
    await fetchAllData();
  };

  const handleCreateRoute = async (data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }) => {
    if (!window.electronAPI) return;
    const newRoute = await window.electronAPI.createRoute(data);
    setRoutes((prev) => [...prev, newRoute]);
    const caddy = await window.electronAPI.getCaddyStatus?.().catch(() => null);
    if (caddy) setCaddyStatus(caddy);
  };

  const handleDeleteRoute = async (routeId: string) => {
    if (!window.electronAPI) return;
    const success = await window.electronAPI.deleteRoute(routeId);
    if (success) {
      setRoutes((prev) => prev.filter((r) => r.id !== routeId));
      const caddy = await window.electronAPI.getCaddyStatus?.().catch(() => null);
      if (caddy) setCaddyStatus(caddy);
    }
  };

  const handleSyncCaddy = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.syncCaddyRoutes();
    const caddy = await window.electronAPI.getCaddyStatus?.().catch(() => null);
    if (caddy) setCaddyStatus(caddy);
    if (!res.success && res.error) {
      alert(`Caddy sync error: ${res.error}`);
    }
  };

  const handleTestRoute = async (host: string) => {
    if (!window.electronAPI) {
      return { success: false, latencyMs: 0, error: 'Electron IPC unavailable' };
    }
    return await window.electronAPI.testCaddyRoute(host);
  };

  const handleConnectTailscale = async (authKey: string, hostname?: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.connectTailscale(authKey, hostname);
    const ts = await window.electronAPI.getTailscaleStatus?.().catch(() => null);
    if (ts) setTailscaleStatus(ts);
    if (!res.success && res.error) {
      alert(`Tailscale connect failed: ${res.error}`);
    }
  };

  const handleDisconnectTailscale = async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.disconnectTailscale();
    const ts = await window.electronAPI.getTailscaleStatus?.().catch(() => null);
    if (ts) setTailscaleStatus(ts);
  };

  const handleToggleAutoStart = async (enabled: boolean) => {
    if (!window.electronAPI?.setAutoStart) return;
    const res = await window.electronAPI.setAutoStart(enabled, true);
    if (res.success) {
      setLifecycleStatus((prev) => (prev ? { ...prev, autoStart: res.autoStart } : null));
    }
  };

  const handleTogglePowerBlocker = async (enabled: boolean) => {
    if (!window.electronAPI?.setPowerSaveBlocker) return;
    const res = await window.electronAPI.setPowerSaveBlocker(enabled);
    if (res.success) {
      setLifecycleStatus((prev) => (prev ? { ...prev, powerBlocker: res.powerBlocker } : null));
    }
  };

  const handleMinimizeToTray = async () => {
    if (!window.electronAPI?.minimizeToTray) return;
    await window.electronAPI.minimizeToTray();
  };

  const handleQuitApp = async () => {
    if (!window.electronAPI?.quitApp) return;
    if (confirm('Are you sure you want to stop all server processes and exit Native Windows Server Hub?')) {
      await window.electronAPI.quitApp();
    }
  };

  const runningServicesCount = services.filter((s) => {
    const p = processStatuses[s.id];
    return p ? p.status === 'running' : s.status === 'running';
  }).length;

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 flex flex-row font-sans">
      {/* 1Panel Left Fixed Sidebar */}
      <aside className="w-64 bg-[#0a0f1b] border-r border-slate-800/80 flex flex-col justify-between shrink-0 select-none z-20">
        <div>
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

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab('overview')}
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

            <button
              onClick={() => setActiveTab('services')}
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
              onClick={() => setActiveTab('store')}
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
              onClick={() => setActiveTab('routes')}
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
              onClick={() => setActiveTab('database')}
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
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'settings'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Settings className="w-4 h-4" />
                <span>Settings &amp; 24/7 Power</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'logs'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Terminal className="w-4 h-4" />
                <span>Console Logs</span>
              </div>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  activeTab === 'logs' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {logs.length}
              </span>
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <Header
          systemInfo={systemInfo}
          onRefresh={fetchAllData}
          isRefreshing={isRefreshing}
        />

        {!isElectronAvailable && (
          <div className="bg-amber-950/40 border-b border-amber-600/30 px-6 py-2 text-xs text-amber-300">
            ⚠️ Electron IPC API not detected in standard browser context. Run via &apos;npm run dev&apos; or &apos;npm start&apos; to test native IPC channels.
          </div>
        )}

        <main className="flex-1 p-6 space-y-6 max-w-7xl w-full mx-auto">
          {/* Overview / Dashboard Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Architecture Collapsible Stepper */}
              <BootstrapStepper steps={bootstrapSteps} />

              {/* 4-KPI Status Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card rounded-xl p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Relational Database</span>
                    <Database className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-lg font-bold text-white">PostgreSQL 16</div>
                  <div className="text-[11px] font-mono text-emerald-400 mt-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Port 5432 • Connected</span>
                  </div>
                </div>

                <div className="glass-card rounded-xl p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Supervised Services</span>
                    <Layers className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="text-lg font-bold text-white">
                    {runningServicesCount} / {services.length} Running
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Native Windows executables
                  </div>
                </div>

                <div className="glass-card rounded-xl p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Dynamic Mesh Proxy</span>
                    <Globe className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-lg font-bold text-white">Caddy Gateway</div>
                  <div className="text-[11px] font-mono text-purple-300 mt-1">
                    Port 80 • {routes.length} active routes
                  </div>
                </div>

                <div className="glass-card rounded-xl p-4 border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-medium">Persistence State</span>
                    <Power className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-lg font-bold text-white">24/7 Server Lock</div>
                  <div className="text-[11px] text-amber-300 mt-1">
                    App suspension prevented
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

              {/* Quick Launch Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="glass-card rounded-2xl p-5 border border-slate-800 bg-slate-900/40 flex items-center justify-between">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                      <FolderTree className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">FileBrowser Cloud Storage</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Native cloud drive • Login: <span className="text-emerald-400 font-mono">admin</span> / <span className="text-emerald-400 font-mono">admin12345678</span>
                      </p>
                    </div>
                  </div>
                  <a
                    href="http://files.localhost"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-all"
                  >
                    <span>Open Drive</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="glass-card rounded-2xl p-5 border border-slate-800 bg-slate-900/40 flex items-center justify-between">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                      <Bot className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">Ollama Local AI Engine</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Inference server • Endpoint: <span className="text-purple-300 font-mono">http://ai.localhost</span>
                      </p>
                    </div>
                  </div>
                  <a
                    href="http://ai.localhost"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition-all"
                  >
                    <span>Open AI Hub</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Installed Services Tab */}
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

          {/* 1-Click App Store Tab */}
          {activeTab === 'store' && (
            <AppStore
              existingServices={services}
              onCreateServiceWithRoute={handleCreateServiceWithRoute}
              onStartService={handleStartService}
            />
          )}

          {/* Routes / Domains Tab */}
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

          {/* Databases Tab */}
          {activeTab === 'database' && (
            <div className="space-y-6">
              <DatabaseCard
                postgresStatus={postgresStatus}
                migrationStatus={migrationStatus}
                onPing={handlePing}
              />
            </div>
          )}

          {/* Settings & 24/7 Power Tab */}
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

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <LogViewer logs={logs} onClear={() => setLogs([])} />
          )}
        </main>
      </div>
    </div>
  );
}
