'use client';

import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Terminal,
  Play,
  Square,
  RotateCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  FileText,
  Clock,
  Cpu,
} from 'lucide-react';
import { ServiceRecord, ProcessStatus, LogEntry } from '@/shared/types';

interface ServicesTableProps {
  services: ServiceRecord[];
  processStatuses: Record<string, ProcessStatus>;
  onCreateService: (data: {
    name: string;
    type: string;
    executable: string;
    port?: number;
    description?: string;
    autoStart?: boolean;
  }) => Promise<void>;
  onStartService: (serviceId: string) => Promise<void>;
  onStopService: (serviceId: string) => Promise<void>;
  onRestartService: (serviceId: string) => Promise<void>;
  getServiceLogs: (serviceId: string) => Promise<LogEntry[]>;
  isLoading: boolean;
}

export const ServicesTable: React.FC<ServicesTableProps> = ({
  services,
  processStatuses,
  onCreateService,
  onStartService,
  onStopService,
  onRestartService,
  getServiceLogs,
  isLoading,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [operatingIds, setOperatingIds] = useState<Record<string, string>>({}); // serviceId -> action ('starting'|'stopping'|'restarting')
  const [activeLogService, setActiveLogService] = useState<ServiceRecord | null>(null);
  const [serviceLogs, setServiceLogs] = useState<LogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [type, setType] = useState('custom');
  const [executable, setExecutable] = useState('');
  const [port, setPort] = useState<string>('');
  const [description, setDescription] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStart = async (serviceId: string) => {
    setOperatingIds((prev) => ({ ...prev, [serviceId]: 'starting' }));
    try {
      await onStartService(serviceId);
    } finally {
      setOperatingIds((prev) => {
        const next = { ...prev };
        delete next[serviceId];
        return next;
      });
    }
  };

  const handleStop = async (serviceId: string) => {
    setOperatingIds((prev) => ({ ...prev, [serviceId]: 'stopping' }));
    try {
      await onStopService(serviceId);
    } finally {
      setOperatingIds((prev) => {
        const next = { ...prev };
        delete next[serviceId];
        return next;
      });
    }
  };

  const handleRestart = async (serviceId: string) => {
    setOperatingIds((prev) => ({ ...prev, [serviceId]: 'restarting' }));
    try {
      await onRestartService(serviceId);
    } finally {
      setOperatingIds((prev) => {
        const next = { ...prev };
        delete next[serviceId];
        return next;
      });
    }
  };

  const handleOpenLogs = async (service: ServiceRecord) => {
    setActiveLogService(service);
    setIsLoadingLogs(true);
    try {
      const logs = await getServiceLogs(service.id);
      setServiceLogs(logs);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !executable) return;

    setIsSubmitting(true);
    try {
      await onCreateService({
        name,
        type,
        executable,
        port: port ? parseInt(port, 10) : undefined,
        description,
        autoStart,
      });
      setIsModalOpen(false);
      setName('');
      setExecutable('');
      setPort('');
      setDescription('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass-card rounded-xl p-5 border border-slate-800">
      <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800/80 mb-4 gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Layers className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Supervised Native Services
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Phase 2 ProcessSupervisor
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live lifecycle supervision for caddy.exe, filebrowser.exe, ollama.exe with Windows taskkill process tree isolation.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Register New Service</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800/80 text-slate-400 font-mono uppercase text-[10px]">
              <th className="pb-3 px-3">Service Name</th>
              <th className="pb-3 px-3">Type</th>
              <th className="pb-3 px-3">Executable</th>
              <th className="pb-3 px-3">Port</th>
              <th className="pb-3 px-3">Supervisor Status</th>
              <th className="pb-3 px-3">PID</th>
              <th className="pb-3 px-3">Auto Start</th>
              <th className="pb-3 px-3 text-right">Lifecycle Control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {services.map((service) => {
              const proc = processStatuses[service.id];
              const currentStatus = proc ? proc.status : service.status;
              const currentPid = proc?.pid || service.pid;
              const operating = operatingIds[service.id];
              const isRunning = currentStatus === 'running';

              return (
                <tr key={service.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-3">
                    <div className="font-medium text-slate-200">{service.name}</div>
                    {service.description && (
                      <div className="text-[11px] text-slate-400 mt-0.5 max-w-xs truncate">{service.description}</div>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase">
                      {service.type}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-slate-500" />
                      <span>{service.executable}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-blue-400">
                    {service.port ? `:${service.port}` : 'Dynamic'}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border font-medium ${
                        isRunning
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : currentStatus === 'starting'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                          : currentStatus === 'stopping'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : currentStatus === 'crashed' || currentStatus === 'error'
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isRunning ? 'bg-emerald-400 live-indicator-active' : 'bg-slate-500'
                        }`}
                      />
                      <span className="capitalize">{operating || currentStatus}</span>
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono">
                    {currentPid ? (
                      <span className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/40 text-purple-300 text-[10px]">
                        #{currentPid}
                      </span>
                    ) : (
                      <span className="text-slate-600 text-[10px]">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <span className="text-[11px] font-mono text-slate-400">
                      {service.autoStart ? 'Yes (Boot)' : 'Manual'}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end space-x-1.5">
                      {/* Logs View Button */}
                      <button
                        onClick={() => handleOpenLogs(service)}
                        className="p-1.5 rounded-lg border border-slate-700/80 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                        title="View Live Stdout/Stderr Stream"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>

                      {/* Start / Stop Toggle */}
                      {isRunning ? (
                        <>
                          <button
                            onClick={() => handleRestart(service.id)}
                            disabled={!!operating}
                            className="p-1.5 rounded-lg border border-indigo-700/50 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/60 transition-colors disabled:opacity-50"
                            title="Restart Service Process"
                          >
                            <RotateCw className={`w-3.5 h-3.5 ${operating === 'restarting' ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleStop(service.id)}
                            disabled={!!operating}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-700/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 transition-colors text-[11px] font-medium disabled:opacity-50"
                            title="Forcefully Terminate Process Tree (taskkill /pid /T /F)"
                          >
                            {operating === 'stopping' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Square className="w-3 h-3" />
                            )}
                            <span>Stop</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleStart(service.id)}
                          disabled={!!operating}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-700/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 transition-colors text-[11px] font-medium disabled:opacity-50"
                          title="Spawn Process via ProcessSupervisor"
                        >
                          {operating === 'starting' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          <span>Start</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {services.length === 0 && !isLoading && (
          <div className="text-center py-8 text-slate-500 text-xs">
            No services registered yet. Click &quot;Register New Service&quot; above to add your first process.
          </div>
        )}
      </div>

      {/* Slide-Over Modal for Service Stdout/Stderr logs */}
      {activeLogService && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b101d] border border-slate-700 rounded-xl p-5 max-w-3xl w-full shadow-2xl flex flex-col h-[520px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Terminal className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    {activeLogService.name}
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {activeLogService.executable}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Live console output stream captured by ProcessSupervisor
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActiveLogService(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Log Stream Content */}
            <div className="flex-1 overflow-y-auto bg-[#070a10] rounded-lg p-3 font-mono text-[11px] border border-slate-900 space-y-1 select-text">
              {isLoadingLogs ? (
                <div className="text-center py-16 text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading recent logs...</span>
                </div>
              ) : serviceLogs.length === 0 ? (
                <div className="text-center py-16 text-slate-600 italic">
                  No console output captured yet. Start the service to view real-time stdout/stderr.
                </div>
              ) : (
                serviceLogs.map((log) => {
                  let textColor = 'text-slate-300';
                  if (log.level === 'error') textColor = 'text-rose-400';
                  if (log.level === 'warn') textColor = 'text-amber-400';
                  if (log.level === 'success') textColor = 'text-emerald-400';

                  return (
                    <div key={log.id} className="flex items-start gap-2 hover:bg-slate-900/40 px-1 py-0.5 rounded">
                      <span className="text-slate-600 text-[10px] shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`text-[10px] uppercase font-mono px-1 rounded bg-slate-800 text-slate-400`}>
                        {log.level}
                      </span>
                      <span className={`break-all ${textColor}`}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-800/80 mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>Streams via Electron IPC from child_process.spawn()</span>
              <button
                onClick={() => setActiveLogService(null)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for registering service */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100 mb-1">Register New Native Service</h3>
            <p className="text-xs text-slate-400 mb-4">
              Add a Windows executable to the process supervisor registry.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">Service Display Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Caddy Proxy Gateway"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Service Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="caddy">caddy</option>
                    <option value="filebrowser">filebrowser</option>
                    <option value="ollama">ollama</option>
                    <option value="custom">custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Service Port</label>
                  <input
                    type="number"
                    placeholder="e.g. 8080"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Binary Executable (.exe)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. caddy.exe or filebrowser.exe"
                  value={executable}
                  onChange={(e) => setExecutable(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Purpose of this service"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="autoStart"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                />
                <label htmlFor="autoStart" className="text-slate-300 cursor-pointer">
                  Auto-start when Server Hub boots
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Register Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
