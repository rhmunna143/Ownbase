'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { BootstrapStepper } from '@/components/BootstrapStepper';
import { DatabaseCard } from '@/components/DatabaseCard';
import { ServicesTable } from '@/components/ServicesTable';
import { RoutesTable } from '@/components/RoutesTable';
import { LogViewer } from '@/components/LogViewer';
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
} from '@/shared/types';
import { Server, Database, Globe, Terminal, ShieldCheck, Activity, Layers, Play, CheckCircle2 } from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'routes' | 'logs'>('overview');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [postgresStatus, setPostgresStatus] = useState<PostgresStatus | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [processStatuses, setProcessStatuses] = useState<Record<string, ProcessStatus>>({});
  const [caddyStatus, setCaddyStatus] = useState<CaddyStatus | null>(null);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
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
      const [sys, pg, mig, steps, srvs, rts, initialLogs, procStatuses, caddy, tailscale] = await Promise.all([
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

  const runningServicesCount = services.filter((s) => {
    const p = processStatuses[s.id];
    return p ? p.status === 'running' : s.status === 'running';
  }).length;

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col">
      <Header
        systemInfo={systemInfo}
        onRefresh={fetchAllData}
        isRefreshing={isRefreshing}
      />

      {!isElectronAvailable && (
        <div className="bg-amber-950/40 border-b border-amber-600/30 px-6 py-2.5 text-xs text-amber-300 flex items-center justify-between">
          <span>
            ⚠️ Electron IPC API not detected in standard browser context. Run via &apos;npm run dev&apos; or &apos;npm start&apos; to test native IPC channels.
          </span>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-6">
        {/* Architecture Bootstrapper Stepper */}
        <BootstrapStepper steps={bootstrapSteps} />

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all ${
              activeTab === 'overview'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>PostgreSQL &amp; Storage</span>
          </button>

          <button
            onClick={() => setActiveTab('services')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all ${
              activeTab === 'services'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Process Supervisor ({runningServicesCount}/{services.length} active)</span>
          </button>

          <button
            onClick={() => setActiveTab('routes')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all ${
              activeTab === 'routes'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Dynamic Proxy Routes ({routes.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all ${
              activeTab === 'logs'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Live Console Stream ({logs.length})</span>
          </button>
        </div>

        {/* Tab Content Panes */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <DatabaseCard
              postgresStatus={postgresStatus}
              migrationStatus={migrationStatus}
              onPing={handlePing}
            />

            {/* Phase 2 Supervisor Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-card rounded-xl p-4 border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Process Tree Termination</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Prevents zombie processes using Windows-native <code>taskkill /pid &lt;PID&gt; /T /F</code> on app exit or service stop.
                </p>
              </div>

              <div className="glass-card rounded-xl p-4 border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
                  <Terminal className="w-4 h-4 text-blue-400" />
                  <span>Real-Time Output Capture</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Streams stdout and stderr directly from spawned Windows binaries to the frontend console and in-memory ring buffers.
                </p>
              </div>

              <div className="glass-card rounded-xl p-4 border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <span>Native Process Registry</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  PostgreSQL-synchronized state machine tracking PIDs, exit codes, and auto-restart policies for all services.
                </p>
              </div>
            </div>

            <LogViewer logs={logs} onClear={() => setLogs([])} />
          </div>
        )}

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

        {activeTab === 'logs' && (
          <LogViewer logs={logs} onClear={() => setLogs([])} />
        )}
      </main>
    </div>
  );
}
