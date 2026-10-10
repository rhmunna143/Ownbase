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
} from '@/shared/types';
import { Server, Database, Globe, Terminal, ShieldCheck, Activity, Layers } from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'routes' | 'logs'>('overview');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [postgresStatus, setPostgresStatus] = useState<PostgresStatus | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [bootstrapSteps, setBootstrapSteps] = useState<BootstrapStep[]>([
    { id: 'electron-init', name: 'Electron Shell', description: 'Initializing desktop runtime environment', status: 'pending' },
    { id: 'postgres-bin', name: 'PostgreSQL Binaries', description: 'Locating portable PostgreSQL distribution', status: 'pending' },
    { id: 'postgres-initdb', name: 'Database Cluster', description: 'Validating/Initializing data directory (initdb)', status: 'pending' },
    { id: 'postgres-start', name: 'PostgreSQL Engine', description: 'Launching silent postgres.exe process', status: 'pending' },
    { id: 'postgres-port', name: 'TCP Port Probe', description: 'Verifying database port 5432 is listening', status: 'pending' },
    { id: 'prisma-migration', name: 'Prisma Migrations', description: 'Executing programmatic database migrations', status: 'pending' },
    { id: 'prisma-client', name: 'Data Layer', description: 'Initializing Prisma client and verifying models', status: 'pending' },
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
      const [sys, pg, mig, steps, srvs, rts, initialLogs] = await Promise.all([
        window.electronAPI.getSystemInfo().catch(() => null),
        window.electronAPI.getPostgresStatus().catch(() => null),
        window.electronAPI.getMigrationStatus().catch(() => null),
        window.electronAPI.getBootstrapSteps().catch(() => []),
        window.electronAPI.getServices().catch(() => []),
        window.electronAPI.getRoutes().catch(() => []),
        window.electronAPI.getLogs().catch(() => []),
      ]);

      if (sys) setSystemInfo(sys);
      if (pg) setPostgresStatus(pg);
      if (mig) setMigrationStatus(mig);
      if (steps && steps.length > 0) setBootstrapSteps(steps);
      setServices(srvs || []);
      setRoutes(rts || []);
      setLogs(initialLogs || []);
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

      return () => {
        cleanupLog?.();
        cleanupSteps?.();
        cleanupPg?.();
      };
    }
  }, [fetchAllData]);

  const handlePing = async () => {
    if (!window.electronAPI) {
      return { success: false, latencyMs: 0, error: 'Electron IPC unavailable' };
    }
    return await window.electronAPI.pingDatabase();
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
  };

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
        {/* Phase 1 Bootstrapper Stepper */}
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
            <span>Prisma Services Manifest ({services.length})</span>
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
            <span>Supervised Logs ({logs.length})</span>
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-card rounded-xl p-4 border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>IPC Security Model</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Renderer communicates with Node.js exclusively through isolated Electron contextBridge channels. Node integration is disabled in renderer.
                </p>
              </div>

              <div className="glass-card rounded-xl p-4 border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
                  <Activity className="w-4 h-4 text-blue-400" />
                  <span>Port Supervision</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  PostgreSQL engine runs on dedicated loopback port 5432. Active TCP probe verifies port readiness before applying schema migrations.
                </p>
              </div>

              <div className="glass-card rounded-xl p-4 border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <span>Zero Virtualization</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  No Docker daemon or WSL2 hypervisor required. Operates with portable Windows binaries inside AppData and extraResources.
                </p>
              </div>
            </div>

            <LogViewer logs={logs} onClear={() => setLogs([])} />
          </div>
        )}

        {activeTab === 'services' && (
          <ServicesTable
            services={services}
            onCreateService={handleCreateService}
            isLoading={isRefreshing}
          />
        )}

        {activeTab === 'routes' && (
          <RoutesTable
            routes={routes}
            services={services}
            onCreateRoute={handleCreateRoute}
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
