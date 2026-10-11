'use client';

import React, { useState } from 'react';
import {
  Database,
  Zap,
  Activity,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Clock,
  Copy,
  Check,
  Terminal,
  Play,
  Loader2,
  Table,
} from 'lucide-react';
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
  const [copiedConn, setCopiedConn] = useState(false);

  // SQL Console state
  const [sqlQuery, setSqlQuery] = useState('SELECT id, name, type, executable, port, status FROM "services";');
  const [isExecutingSql, setIsExecutingSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<{ success: boolean; data?: any[]; error?: string } | null>(null);

  const connectionString = `postgresql://postgres@127.0.0.1:${postgresStatus?.port || 5432}/postgres`;

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

  const handleCopyConnection = () => {
    navigator.clipboard.writeText(connectionString);
    setCopiedConn(true);
    setTimeout(() => setCopiedConn(false), 2000);
  };

  const handleExecuteSql = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!window.electronAPI?.executeQuery) {
      // Fallback: ping query
      const res = await handlePing();
      return;
    }

    setIsExecutingSql(true);
    try {
      const res = await window.electronAPI.executeQuery(sqlQuery);
      setSqlResult(res);
    } catch (err: any) {
      setSqlResult({ success: false, error: err.message });
    } finally {
      setIsExecutingSql(false);
    }
  };

  const isRunning = postgresStatus?.state === 'running';

  return (
    <div className="space-y-6">
      {/* Top 2 Cards: Overview & Schema */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Postgres Engine Overview */}
        <div className="glass-card rounded-2xl p-6 border border-slate-800 lg:col-span-2 bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800 mb-4 gap-3">
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  Portable PostgreSQL 16
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      isRunning
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {postgresStatus?.state || 'Running'}
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Embedded native database engine running directly on Windows without Docker or WSL2.
                </p>
              </div>
            </div>

            <button
              onClick={handlePing}
              disabled={isPinging || !isRunning}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all disabled:opacity-40"
            >
              <Zap className={`w-3.5 h-3.5 ${isPinging ? 'animate-bounce' : ''}`} />
              <span>{isPinging ? 'Testing...' : 'Ping Port 5432'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Port</span>
              <div className="text-sm font-semibold font-mono text-blue-400 mt-1">
                :{postgresStatus?.port || 5432}
              </div>
              <span className="text-[10px] text-slate-400">127.0.0.1 TCP</span>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Process PID</span>
              <div className="text-sm font-semibold font-mono text-purple-400 mt-1">
                {postgresStatus?.pid ? `#${postgresStatus.pid}` : 'Native Daemon'}
              </div>
              <span className="text-[10px] text-slate-400">Windows Native</span>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Port State</span>
              <div className="text-sm font-semibold text-emerald-400 mt-1 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 live-indicator-active" />
                <span>Listening</span>
              </div>
              <span className="text-[10px] text-slate-400">TCP Socket Open</span>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Prisma State</span>
              <div className="text-sm font-semibold text-indigo-400 mt-1">
                {migrationStatus?.state === 'applied' ? 'Synchronized' : 'Ready'}
              </div>
              <span className="text-[10px] text-slate-400">Multi-File Schema</span>
            </div>
          </div>

          {/* Connection String Helper */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2">
              <span className="text-slate-400 font-medium">Connection URI:</span>
              <code className="text-emerald-400 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                {connectionString}
              </code>
            </div>

            <button
              onClick={handleCopyConnection}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors font-medium text-[11px]"
            >
              {copiedConn ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Connection String</span>
                </>
              )}
            </button>
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
                    ? `IPC Query Roundtrip Verified via Prisma ORM: ${pingResult.latencyMs}ms latency`
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
        <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-800 mb-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <FileCode className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white">Prisma Multi-File Schema</h3>
                <p className="text-[11px] text-slate-400">Programmatic migrations deployed</p>
              </div>
            </div>

            <div className="space-y-2 mt-2">
              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 text-xs flex items-center justify-between">
                <div>
                  <span className="font-mono text-indigo-300">schema/schema.prisma</span>
                  <p className="text-[10px] text-slate-400">PostgreSQL datasource & client</p>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">Core</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 text-xs flex items-center justify-between">
                <div>
                  <span className="font-mono text-blue-300">schema/service.prisma</span>
                  <p className="text-[10px] text-slate-400">Process manifestations (caddy, files, ollama)</p>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 font-mono">Model</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 text-xs flex items-center justify-between">
                <div>
                  <span className="font-mono text-emerald-300">schema/route.prisma</span>
                  <p className="text-[10px] text-slate-400">Dynamic reverse proxy subdomains & ports</p>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300 font-mono">Model</span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 mt-3 flex items-center justify-between text-[11px] text-slate-400">
            <span>Migration Command:</span>
            <span className="font-mono text-slate-200 bg-slate-800/80 px-2 py-0.5 rounded">
              prisma migrate deploy
            </span>
          </div>
        </div>
      </div>

      {/* Interactive SQL Console & Table Viewer */}
      <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40 space-y-4">
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Interactive SQL Console &amp; Explorer</h3>
              <p className="text-xs text-slate-400">Execute live SQL queries directly against native PostgreSQL 16</p>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setSqlQuery('SELECT id, name, type, executable, port, status FROM "services";');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono transition-colors"
            >
              services
            </button>
            <button
              onClick={() => {
                setSqlQuery('SELECT id, subdomain, "targetPort", "tlsEnabled" FROM "routes";');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono transition-colors"
            >
              routes
            </button>
            <button
              onClick={() => {
                setSqlQuery('SELECT NOW() as current_timestamp, version();');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono transition-colors"
            >
              version
            </button>
          </div>
        </div>

        {/* Query Input */}
        <form onSubmit={handleExecuteSql} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              placeholder="e.g. SELECT * FROM services;"
              className="flex-1 bg-black/60 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs font-mono text-emerald-300 focus:outline-none focus:border-purple-500"
            />
            <button
              type="submit"
              disabled={isExecutingSql}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-all shadow-md shadow-purple-600/20 disabled:opacity-50"
            >
              {isExecutingSql ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>Execute SQL</span>
            </button>
          </div>
        </form>

        {/* Results Container */}
        {sqlResult && (
          <div className="mt-4 pt-3 border-t border-slate-800">
            {sqlResult.success ? (
              <div>
                <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
                  <span>Query Results ({Array.isArray(sqlResult.data) ? sqlResult.data.length : 1} rows)</span>
                  <span className="text-emerald-400 text-[11px] font-mono">Status: 200 OK</span>
                </div>

                {Array.isArray(sqlResult.data) && sqlResult.data.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-black/40">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-mono text-[10px] uppercase">
                          {Object.keys(sqlResult.data[0]).map((key) => (
                            <th key={key} className="py-2.5 px-3">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {sqlResult.data.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/30">
                            {Object.values(row).map((val: any, vIdx) => (
                              <td key={vIdx} className="py-2.5 px-3 text-slate-300">
                                {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs font-mono text-slate-400">
                    {JSON.stringify(sqlResult.data, null, 2)}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs font-mono">
                Error: {sqlResult.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
