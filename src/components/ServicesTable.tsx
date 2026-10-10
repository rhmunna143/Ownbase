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
  LayoutGrid,
  List,
  ExternalLink,
  Copy,
  Check,
  FolderTree,
  Bot,
  Server,
  Zap,
  Globe,
  Database,
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
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [operatingIds, setOperatingIds] = useState<Record<string, string>>({}); // serviceId -> action ('starting'|'stopping'|'restarting')
  const [activeLogService, setActiveLogService] = useState<ServiceRecord | null>(null);
  const [serviceLogs, setServiceLogs] = useState<LogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
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

  const getServiceIcon = (service: ServiceRecord) => {
    switch (service.type) {
      case 'filebrowser':
        return <FolderTree className="w-5 h-5 text-emerald-400" />;
      case 'ollama':
        return <Bot className="w-5 h-5 text-purple-400" />;
      case 'caddy':
        return <Server className="w-5 h-5 text-blue-400" />;
      case 'nodejs':
        return <Zap className="w-5 h-5 text-green-400" />;
      case 'python':
        return <Globe className="w-5 h-5 text-indigo-400" />;
      default:
        return <Terminal className="w-5 h-5 text-amber-400" />;
    }
  };

  const getServiceUrl = (service: ServiceRecord) => {
    if (service.routes && service.routes.length > 0) {
      const r = service.routes[0];
      return `http://${r.subdomain}.localhost`;
    }
    if (service.port) {
      return `http://127.0.0.1:${service.port}`;
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* Top Bar with Controls */}
      <div className="glass-card rounded-2xl p-5 border border-slate-800 bg-slate-900/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <Layers className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              Installed Native Services
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {services.length} services
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Managed Windows processes supervised with automatic restart and <code>taskkill /T /F</code> cleanup.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* View Toggle */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-0.5 flex items-center">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'grid'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Card Grid View (1Panel style)"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'table'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Table View"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Service</span>
          </button>
        </div>
      </div>

      {/* Grid View (1Panel Style) */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service) => {
            const proc = processStatuses[service.id];
            const currentStatus = proc ? proc.status : service.status;
            const currentPid = proc?.pid || service.pid;
            const operating = operatingIds[service.id];
            const isRunning = currentStatus === 'running';
            const url = getServiceUrl(service);

            return (
              <div
                key={service.id}
                className="glass-card rounded-2xl p-5 border border-slate-800 bg-slate-900/40 hover:border-slate-700/80 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-800/90 border border-slate-700/70 flex items-center justify-center">
                        {getServiceIcon(service)}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white tracking-tight">{service.name}</h3>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5 flex items-center gap-1.5">
                          <span>{service.executable}</span>
                          {service.port && <span className="text-blue-400">:{service.port}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Status Pill */}
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
                  </div>

                  {service.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mt-2">
                      {service.description}
                    </p>
                  )}

                  {/* Credentials helper for FileBrowser */}
                  {service.type === 'filebrowser' && (
                    <div className="mt-3.5 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-[11px]">
                      <div className="text-slate-300">
                        <span className="text-slate-500 mr-1.5">Login:</span>
                        <code className="text-emerald-400 font-mono">admin</code>
                        <span className="text-slate-600 mx-1">/</span>
                        <code className="text-emerald-400 font-mono">admin12345678</code>
                      </div>
                      <button
                        onClick={() => copyToClipboard('admin12345678', `fb-${service.id}`)}
                        className="text-slate-400 hover:text-white p-1 rounded transition-colors"
                        title="Copy Password"
                      >
                        {copiedKey === `fb-${service.id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Info Pill Row */}
                  <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    {currentPid ? (
                      <span className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/40 text-purple-300">
                        PID #{currentPid}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/40 text-slate-500">
                        No Process
                      </span>
                    )}

                    <span className="px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/40 text-slate-400">
                      {service.autoStart ? 'Auto-Boot' : 'Manual'}
                    </span>

                    {url && (
                      <span className="px-2 py-0.5 rounded bg-blue-950/50 border border-blue-800/30 text-blue-300">
                        {service.routes?.[0]?.subdomain ? `${service.routes[0].subdomain}.localhost` : `:${service.port}`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    {/* View Logs Button */}
                    <button
                      onClick={() => handleOpenLogs(service)}
                      className="p-1.5 rounded-lg border border-slate-700/80 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                      title="View Console Logs"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>

                    {/* Open in Browser */}
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-600/30 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 transition-colors text-[11px]"
                        title={`Open ${url}`}
                      >
                        <span>Open</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Lifecycle Buttons */}
                  <div className="flex items-center space-x-1.5">
                    {isRunning ? (
                      <>
                        <button
                          onClick={() => handleRestart(service.id)}
                          disabled={!!operating}
                          className="p-1.5 rounded-lg border border-indigo-700/50 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/60 transition-colors disabled:opacity-50"
                          title="Restart Process"
                        >
                          <RotateCw className={`w-3.5 h-3.5 ${operating === 'restarting' ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleStop(service.id)}
                          disabled={!!operating}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-700/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 transition-colors text-[11px] font-semibold disabled:opacity-50"
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
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-700/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 transition-colors text-[11px] font-semibold disabled:opacity-50"
                      >
                        {operating === 'starting' ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3 fill-current" />
                        )}
                        <span>Start</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="glass-card rounded-2xl p-5 border border-slate-800 bg-slate-900/40 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                <th className="pb-3 px-3">Service Name</th>
                <th className="pb-3 px-3">Type</th>
                <th className="pb-3 px-3">Executable</th>
                <th className="pb-3 px-3">Port</th>
                <th className="pb-3 px-3">Status</th>
                <th className="pb-3 px-3">PID</th>
                <th className="pb-3 px-3">Auto Start</th>
                <th className="pb-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {services.map((service) => {
                const proc = processStatuses[service.id];
                const currentStatus = proc ? proc.status : service.status;
                const currentPid = proc?.pid || service.pid;
                const operating = operatingIds[service.id];
                const isRunning = currentStatus === 'running';

                return (
                  <tr key={service.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-200">{service.name}</div>
                      {service.type === 'filebrowser' && (
                        <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                          admin / admin12345678
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase">
                        {service.type}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-300">
                      {service.executable}
                    </td>
                    <td className="py-3 px-3 font-mono text-blue-400">
                      {service.port ? `:${service.port}` : 'Dynamic'}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border font-medium ${
                          isRunning
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
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
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                      {service.autoStart ? 'Yes (Boot)' : 'Manual'}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <button
                          onClick={() => handleOpenLogs(service)}
                          className="p-1.5 rounded-lg border border-slate-700/80 bg-slate-900 text-slate-300 hover:text-white"
                          title="View Logs"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        {isRunning ? (
                          <button
                            onClick={() => handleStop(service.id)}
                            disabled={!!operating}
                            className="px-2.5 py-1 rounded-lg border border-rose-700/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 text-[11px] font-medium"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStart(service.id)}
                            disabled={!!operating}
                            className="px-2.5 py-1 rounded-lg border border-emerald-700/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 text-[11px] font-medium"
                          >
                            Start
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal for Registering a New Service */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card rounded-2xl p-6 border border-slate-700 max-w-md w-full shadow-2xl bg-[#0d121f]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-sm font-semibold text-white">Add Native Service</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">Service Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My Express API"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Type Identifier</label>
                <input
                  type="text"
                  required
                  value={type}
                  onChange={(e) => setType(e.target.value.toLowerCase())}
                  placeholder="e.g. nodejs, python, custom"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Executable Path or Binary Name</label>
                <input
                  type="text"
                  required
                  value={executable}
                  onChange={(e) => setExecutable(e.target.value)}
                  placeholder="e.g. node.exe, caddy.exe, or C:\Path\app.exe"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">TCP Port (Optional)</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="e.g. 3000, 8080"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="modal-autostart"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-0"
                />
                <label htmlFor="modal-autostart" className="text-slate-300 cursor-pointer">
                  Auto-start on Windows Hub launch
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-600/20 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Add Service</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Viewer Slide-Over */}
      {activeLogService && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b101d] border border-slate-700 rounded-2xl p-5 max-w-3xl w-full shadow-2xl flex flex-col h-[520px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center space-x-2.5">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  Console Stream: {activeLogService.name}
                </h3>
              </div>
              <button
                onClick={() => setActiveLogService(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 bg-black/80 rounded-xl p-4 overflow-y-auto font-mono text-xs space-y-1 border border-slate-800">
              {isLoadingLogs ? (
                <div className="flex items-center justify-center h-full text-slate-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading stdout/stderr logs...</span>
                </div>
              ) : serviceLogs.length === 0 ? (
                <div className="text-slate-600 text-center py-10">
                  No output recorded for this service process yet.
                </div>
              ) : (
                serviceLogs.map((log) => (
                  <div key={log.id} className="flex items-start space-x-2 leading-relaxed">
                    <span className="text-slate-500 text-[10px] select-none shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`uppercase text-[9px] px-1 rounded shrink-0 ${
                        log.level === 'error'
                          ? 'bg-rose-950 text-rose-300'
                          : log.level === 'warn'
                          ? 'bg-amber-950 text-amber-300'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {log.level}
                    </span>
                    <span className="text-slate-200 break-all">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
