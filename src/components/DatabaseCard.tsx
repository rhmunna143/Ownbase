'use client';

import React, { useState } from 'react';
import { Database, Zap, Activity, HardDrive, CheckCircle2, AlertCircle, FileCode, Clock } from 'lucide-react';
import { PostgresStatus, MigrationStatus } from '@/shared/types';

interface DatabaseCardProps {
  postgresStatus: PostgresStatus | null;
  migrationStatus: MigrationStatus | null;
  onPing: () => Promise<{ success: boolean; latencyMs: number; time?: string; error?: string }>;
}

export const DatabaseCard: React.FC<DatabaseCardProps> = ({
  postgresStatus,
  migrationStatus,
  onPing,
}) => {
  const [pingResult, setPingResult] = useState<{
    success: boolean;
    latencyMs: number;
    time?: string;
    error?: string;
  } | null>(null);
  const [isPinging, setIsPinging] = useState(false);

  const handlePing = async () => {
    setIsPinging(true);
    try {
      const res = await onPing();
      setPingResult(res);
    } catch (e: any) {
      setPingResult({ success: false, latencyMs: 0, error: e.message });
    } finally {
      setIsPinging(false);
    }
  };

  const isRunning = postgresStatus?.state === 'running';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Postgres Engine Overview */}
      <div className="glass-card rounded-xl p-5 border border-slate-800 lg:col-span-2">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Database className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                Portable PostgreSQL 16
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    isRunning
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {postgresStatus?.state || 'Unknown'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Embedded native Windows engine (silent daemon managed without Windows Service or Docker)
              </p>
            </div>
          </div>

          <button
            onClick={handlePing}
            disabled={isPinging || !isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all disabled:opacity-40"
          >
            <Zap className={`w-3.5 h-3.5 ${isPinging ? 'animate-bounce' : ''}`} />
            <span>{isPinging ? 'Testing...' : 'Test IPC Query'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Port</span>
            <div className="text-sm font-semibold font-mono text-blue-400 mt-1">
              :{postgresStatus?.port || 5432}
            </div>
            <span className="text-[10px] text-slate-400">127.0.0.1 TCP</span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Process PID</span>
            <div className="text-sm font-semibold font-mono text-purple-400 mt-1">
              {postgresStatus?.pid ? `#${postgresStatus.pid}` : 'Active'}
            </div>
            <span className="text-[10px] text-slate-400">Windows Native</span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Port State</span>
            <div className="text-sm font-semibold text-emerald-400 mt-1 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 live-indicator-active" />
              <span>Listening</span>
            </div>
            <span className="text-[10px] text-slate-400">TCP Socket Open</span>
          </div>

          <div className="bg-slate-900/50 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Prisma State</span>
            <div className="text-sm font-semibold text-indigo-400 mt-1">
              {migrationStatus?.state === 'applied' ? 'Synchronized' : 'Ready'}
            </div>
            <span className="text-[10px] text-slate-400">Multi-File Schema</span>
          </div>
        </div>

        {/* Directory paths info */}
        <div className="space-y-2 text-xs font-mono bg-slate-950/40 rounded-lg p-3 border border-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="text-slate-500 text-[11px]">Storage / Data Directory:</span>
            <span className="text-slate-300 truncate max-w-md bg-slate-900 px-2 py-0.5 rounded border border-slate-800/60">
              {postgresStatus?.dataDir || 'AppData/postgres'}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="text-slate-500 text-[11px]">Binaries Executable Path:</span>
            <span className="text-slate-300 truncate max-w-md bg-slate-900 px-2 py-0.5 rounded border border-slate-800/60">
              {postgresStatus?.binDir || 'extraResources/pgsql/bin'}
            </span>
          </div>
        </div>

        {/* Ping result notification banner */}
        {pingResult && (
          <div
            className={`mt-3 p-2.5 rounded-lg border text-xs flex items-center justify-between ${
              pingResult.success
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {pingResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400" />
              )}
              <span>
                {pingResult.success
                  ? `IPC Query Roundtrip Verified via Prisma ORM: ${pingResult.latencyMs}ms`
                  : `Ping failed: ${pingResult.error}`}
              </span>
            </div>
            {pingResult.time && (
              <span className="font-mono text-[11px] opacity-75">
                DB Time: {new Date(pingResult.time).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Multi-File Prisma Schema Architecture */}
      <div className="glass-card rounded-xl p-5 border border-slate-800 flex flex-col justify-between">
        <div>
          <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-800/80 mb-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <FileCode className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-100">Multi-File Prisma Schema</h3>
              <p className="text-[11px] text-slate-400">Modular schema architecture</p>
            </div>
          </div>

          <div className="space-y-2 mt-2">
            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between">
              <div>
                <span className="font-mono text-indigo-300">schema/schema.prisma</span>
                <p className="text-[10px] text-slate-400">Datasource (PostgreSQL) & Client Generator</p>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">Core</span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between">
              <div>
                <span className="font-mono text-blue-300">schema/service.prisma</span>
                <p className="text-[10px] text-slate-400">Process definitions (Caddy, FileBrowser, Ollama)</p>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 font-mono">Model</span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between">
              <div>
                <span className="font-mono text-emerald-300">schema/route.prisma</span>
                <p className="text-[10px] text-slate-400">Dynamic reverse proxy subdomains & ports</p>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300 font-mono">Model</span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between">
              <div>
                <span className="font-mono text-purple-300">schema/system.prisma</span>
                <p className="text-[10px] text-slate-400">System settings & audit logs tracking</p>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300 font-mono">Model</span>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-800/80 mt-3 flex items-center justify-between text-[11px] text-slate-400">
          <span>Migration Method:</span>
          <span className="font-mono text-slate-200 bg-slate-800/60 px-2 py-0.5 rounded">
            prisma migrate deploy
          </span>
        </div>
      </div>
    </div>
  );
};
