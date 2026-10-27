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
  HardDrive,
  Flame,
  Code2,
  Boxes,
  Workflow,
  Trash2,
  Search,
  Upload,
} from 'lucide-react';
import { ServiceRecord, ProcessStatus, LogEntry } from '@/shared/types';
import { serverApi } from '@/shared/apiClient';
import { getAccessibleServiceUrl } from '@/shared/serviceUrl';
import { modalDialog } from '@/components/ModalDialog';

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
  onDeleteService?: (serviceId: string) => Promise<void>;
  getServiceLogs: (serviceId: string) => Promise<LogEntry[]>;
  isLoading: boolean;
}

interface ServiceVisualTheme {
  icon: React.ReactNode;
  bgClass: string;
  borderClass: string;
  badgeLabel: string;
  badgeClass: string;
}

export const getServiceVisualTheme = (service: ServiceRecord): ServiceVisualTheme => {
  const t = (service.type || '').toLowerCase();
  const n = (service.name || '').toLowerCase();
  const e = (service.executable || '').toLowerCase();
  const tmpl = ((service as any).templateId || '').toLowerCase();
  const haystack = `${t} ${n} ${e} ${tmpl}`;

  // 1. MinIO / S3 Object Storage
  if (haystack.includes('minio') || haystack.includes('s3') || haystack.includes('bucket')) {
    return {
      icon: <HardDrive className="w-5 h-5 text-amber-400" />,
      bgClass: 'bg-amber-500/10',
      borderClass: 'border-amber-500/30 group-hover:border-amber-500/50',
      badgeLabel: 'Object Storage',
      badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-800/40',
    };
  }

  // 2. PostgreSQL / Relational DB
  if (
    haystack.includes('postgres') ||
    haystack.includes('psql') ||
    haystack.includes('mysql') ||
    haystack.includes('mariadb') ||
    haystack.includes('sqlite') ||
    haystack.includes('database')
  ) {
    return {
      icon: <Database className="w-5 h-5 text-cyan-400" />,
      bgClass: 'bg-cyan-500/10',
      borderClass: 'border-cyan-500/30 group-hover:border-cyan-500/50',
      badgeLabel: 'Database',
      badgeClass: 'bg-cyan-950/60 text-cyan-300 border-cyan-800/40',
    };
  }

  // 3. Redis / In-memory Cache
  if (
    haystack.includes('redis') ||
    haystack.includes('keydb') ||
    haystack.includes('valkey') ||
    haystack.includes('memcached') ||
    haystack.includes('cache')
  ) {
    return {
      icon: <Flame className="w-5 h-5 text-rose-400" />,
      bgClass: 'bg-rose-500/10',
      borderClass: 'border-rose-500/30 group-hover:border-rose-500/50',
      badgeLabel: 'Cache',
      badgeClass: 'bg-rose-950/60 text-rose-300 border-rose-800/40',
    };
  }

  // 4. FileBrowser / Storage UI
  if (haystack.includes('filebrowser') || haystack.includes('file') || haystack.includes('explorer')) {
    return {
      icon: <FolderTree className="w-5 h-5 text-emerald-400" />,
      bgClass: 'bg-emerald-500/10',
      borderClass: 'border-emerald-500/30 group-hover:border-emerald-500/50',
      badgeLabel: 'File Manager',
      badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40',
    };
  }

  // Syncthing / Peer-to-Peer Sync & Backup
  if (haystack.includes('syncthing') || haystack.includes('sync') || haystack.includes('backup')) {
    return {
      icon: <RotateCw className="w-5 h-5 text-amber-400" />,
      bgClass: 'bg-amber-500/10',
      borderClass: 'border-amber-500/30 group-hover:border-amber-500/50',
      badgeLabel: 'P2P Sync',
      badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-800/40',
    };
  }

  // 5. Caddy / Reverse Proxy
  if (
    haystack.includes('caddy') ||
    haystack.includes('nginx') ||
    haystack.includes('proxy') ||
    haystack.includes('gateway') ||
    haystack.includes('traefik')
  ) {
    return {
      icon: <Server className="w-5 h-5 text-blue-400" />,
      bgClass: 'bg-blue-500/10',
      borderClass: 'border-blue-500/30 group-hover:border-blue-500/50',
      badgeLabel: 'Reverse Proxy',
      badgeClass: 'bg-blue-950/60 text-blue-300 border-blue-800/40',
    };
  }

  // 6. Ollama / AI / LLM
  if (
    haystack.includes('ollama') ||
    haystack.includes('ai') ||
    haystack.includes('llm') ||
    haystack.includes('vllm') ||
    haystack.includes('whisper')
  ) {
    return {
      icon: <Bot className="w-5 h-5 text-purple-400" />,
      bgClass: 'bg-purple-500/10',
      borderClass: 'border-purple-500/30 group-hover:border-purple-500/50',
      badgeLabel: 'AI / LLM',
      badgeClass: 'bg-purple-950/60 text-purple-300 border-purple-800/40',
    };
  }

  // 7. Node.js / JavaScript / TypeScript runtime
  if (
    haystack.includes('node') ||
    haystack.includes('express') ||
    haystack.includes('fastify') ||
    haystack.includes('bun') ||
    haystack.includes('deno') ||
    haystack.includes('next')
  ) {
    return {
      icon: <Zap className="w-5 h-5 text-green-400" />,
      bgClass: 'bg-green-500/10',
      borderClass: 'border-green-500/30 group-hover:border-green-500/50',
      badgeLabel: 'Node.js',
      badgeClass: 'bg-green-950/60 text-green-300 border-green-800/40',
    };
  }

  // 8. Python runtime / FastAPI / Flask
  if (
    haystack.includes('python') ||
    haystack.includes('fastapi') ||
    haystack.includes('flask') ||
    haystack.includes('django') ||
    haystack.includes('uvicorn')
  ) {
    return {
      icon: <Code2 className="w-5 h-5 text-sky-400" />,
      bgClass: 'bg-sky-500/10',
      borderClass: 'border-sky-500/30 group-hover:border-sky-500/50',
      badgeLabel: 'Python',
      badgeClass: 'bg-sky-950/60 text-sky-300 border-sky-800/40',
    };
  }

  // 9. Pipeline / Build / Release / Test services
  if (
    haystack.includes('pipeline') ||
    haystack.includes('release') ||
    haystack.includes('rollback') ||
    haystack.includes('test')
  ) {
    return {
      icon: <Workflow className="w-5 h-5 text-pink-400" />,
      bgClass: 'bg-pink-500/10',
      borderClass: 'border-pink-500/30 group-hover:border-pink-500/50',
      badgeLabel: 'Pipeline App',
      badgeClass: 'bg-pink-950/60 text-pink-300 border-pink-800/40',
    };
  }

  // 10. Web / Frontend / HTTP
  if (
    haystack.includes('web') ||
    haystack.includes('frontend') ||
    haystack.includes('site') ||
    haystack.includes('ui') ||
    haystack.includes('html')
  ) {
    return {
      icon: <Globe className="w-5 h-5 text-violet-400" />,
      bgClass: 'bg-violet-500/10',
      borderClass: 'border-violet-500/30 group-hover:border-violet-500/50',
      badgeLabel: 'Web Service',
      badgeClass: 'bg-violet-950/60 text-violet-300 border-violet-800/40',
    };
  }

  // 11. Generic binary / Go / Rust
  if (haystack.includes('binary') || haystack.includes('go') || haystack.includes('rust')) {
    return {
      icon: <Boxes className="w-5 h-5 text-indigo-400" />,
      bgClass: 'bg-indigo-500/10',
      borderClass: 'border-indigo-500/30 group-hover:border-indigo-500/50',
      badgeLabel: 'Native App',
      badgeClass: 'bg-indigo-950/60 text-indigo-300 border-indigo-800/40',
    };
  }

  // 12. Terminal & PowerShell Shell
  if (haystack.includes('terminal') || haystack.includes('powershell') || haystack.includes('ttyd')) {
    return {
      icon: <Terminal className="w-5 h-5 text-amber-400" />,
      bgClass: 'bg-amber-500/10',
      borderClass: 'border-amber-500/30 group-hover:border-amber-500/50',
      badgeLabel: 'Web Terminal',
      badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-800/40',
    };
  }

  // 13. OpenSSH Server
  if (haystack.includes('ssh') || haystack.includes('sshd') || haystack.includes('openssh')) {
    return {
      icon: <Terminal className="w-5 h-5 text-purple-400" />,
      bgClass: 'bg-purple-500/10',
      borderClass: 'border-purple-500/30 group-hover:border-purple-500/50',
      badgeLabel: 'SSH Server',
      badgeClass: 'bg-purple-950/60 text-purple-300 border-purple-800/40',
    };
  }

  // 14. PocketBase / Embedded SQLite
  if (haystack.includes('pocketbase') || haystack.includes('pb') || haystack.includes('sqlite')) {
    return {
      icon: <Database className="w-5 h-5 text-emerald-400" />,
      bgClass: 'bg-emerald-500/10',
      borderClass: 'border-emerald-500/30 group-hover:border-emerald-500/50',
      badgeLabel: 'SQLite / PB',
      badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40',
    };
  }

  // Fallback: Deterministic palette based on string hash so custom services don't all look identical
  const hash = service.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const palettes = [
    {
      icon: <Cpu className="w-5 h-5 text-teal-400" />,
      bg: 'bg-teal-500/10',
      border: 'border-teal-500/30',
      badge: 'Service',
      bclass: 'bg-teal-950/60 text-teal-300 border-teal-800/40',
    },
    {
      icon: <Boxes className="w-5 h-5 text-amber-400" />,
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      badge: 'Worker',
      bclass: 'bg-amber-950/60 text-amber-300 border-amber-800/40',
    },
    {
      icon: <Layers className="w-5 h-5 text-fuchsia-400" />,
      bg: 'bg-fuchsia-500/10',
      border: 'border-fuchsia-500/30',
      badge: 'Process',
      bclass: 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-800/40',
    },
    {
      icon: <Terminal className="w-5 h-5 text-slate-300" />,
      bg: 'bg-slate-500/10',
      border: 'border-slate-500/30',
      badge: 'Daemon',
      bclass: 'bg-slate-800 text-slate-300 border-slate-700',
    },
  ];
  const p = palettes[hash % palettes.length];
  return {
    icon: p.icon,
    bgClass: p.bg,
    borderClass: p.border,
    badgeLabel: p.badge,
    badgeClass: p.bclass,
  };
};

export const ServicesTable: React.FC<ServicesTableProps> = ({
  services,
  processStatuses,
  onCreateService,
  onStartService,
  onStopService,
  onRestartService,
  onDeleteService,
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

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');

  // Delete Confirmation Modal State
  const [deleteConfirmService, setDeleteConfirmService] = useState<ServiceRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [type, setType] = useState('custom');
  const [executable, setExecutable] = useState('');
  const [port, setPort] = useState<string>('');
  const [description, setDescription] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingExe, setIsUploadingExe] = useState(false);
  const [uploadExeProgress, setUploadExeProgress] = useState(0);
  const [uploadedExeName, setUploadedExeName] = useState<string | null>(null);

  const handleBinaryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingExe(true);
    setUploadExeProgress(0);
    try {
      const res = await serverApi.uploadBinary(file, (p) => {
        setUploadExeProgress(p.percent);
      });
      if (res.success && res.filename) {
        setExecutable(res.filename);
        setUploadedExeName(res.filename);
      } else {
        await modalDialog.alert(res.error || 'Binary upload failed', 'Upload Failed', 'danger');
      }
    } catch (err: any) {
      await modalDialog.alert(`Upload error: ${err.message}`, 'Upload Error', 'danger');
    } finally {
      setIsUploadingExe(false);
    }
  };

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

  const getServiceUrl = (service: ServiceRecord) => {
    if (service.routes && service.routes.length > 0) {
      const r = service.routes[0];
      return getAccessibleServiceUrl(r.subdomain, service.port, r.customDomain);
    }
    if (service.port) {
      const name = ((service.name || '') + ' ' + (service.type || '')).toLowerCase();
      if (name.includes('file')) return getAccessibleServiceUrl('files', service.port);
      if (name.includes('photo')) return getAccessibleServiceUrl('photos', service.port);
      if (name.includes('ai') || name.includes('ollama')) return getAccessibleServiceUrl('ai', service.port);
      if (name.includes('s3') || name.includes('minio')) return getAccessibleServiceUrl('s3', service.port);
      if (name.includes('terminal')) return getAccessibleServiceUrl('terminal', service.port);
      return `http://127.0.0.1:${service.port}`;
    }
    return null;
  };

  // Filter services by user query
  const filteredServices = services.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.type || '').toLowerCase().includes(q) ||
      s.executable.toLowerCase().includes(q) ||
      (s.port && s.port.toString().includes(q))
    );
  });

  return (
    <div className="space-y-4">
      {/* Top Bar with Controls */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 bg-slate-900/30 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white flex flex-wrap items-center gap-2">
              <span>Installed Native Services</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {services.length} registered
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                Job Object Sandboxed
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1 sm:line-clamp-none">
              Workloads enclosed in Win32 Job Objects with memory caps, CPU quotas, and crash recovery.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-between md:justify-end">
          {/* Quick Search */}
          <div className="relative flex-1 sm:w-48 sm:flex-initial min-w-[130px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter services..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900/80 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-all"
            />
          </div>

          {/* View Toggle */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-0.5 flex items-center shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'grid'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Card Grid View"
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Service</span>
          </button>
        </div>
      </div>

      {filteredServices.length === 0 && (
        <div className="glass-card rounded-2xl p-8 border border-slate-800 bg-slate-900/30 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/60 mx-auto flex items-center justify-center mb-3">
            <Search className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300">No services match your filter</p>
          <p className="text-xs text-slate-500 mt-1">
            Try adjusting your search query or add a new native service.
          </p>
        </div>
      )}

      {/* Grid View (1Panel Style) */}
      {viewMode === 'grid' && filteredServices.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredServices.map((service) => {
            const proc = processStatuses[service.id];
            const currentStatus = proc ? proc.status : service.status;
            const currentPid = proc?.pid || service.pid;
            const operating = operatingIds[service.id];
            const isRunning = currentStatus === 'running';
            const url = getServiceUrl(service);
            const cleanUrl = url ? url.split('?')[0].replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
            const theme = getServiceVisualTheme(service);

            return (
              <div
                key={service.id}
                className="group glass-card rounded-2xl p-5 border border-slate-800 bg-slate-900/40 hover:border-slate-700/80 transition-all flex flex-col justify-between min-w-0 overflow-hidden"
              >
                <div className="min-w-0">
                  {/* Card Header */}
                  <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-2 mb-3">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl ${theme.bgClass} border ${theme.borderClass} flex items-center justify-center transition-all shadow-inner shrink-0`}
                      >
                        {theme.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h3 className="text-sm font-semibold text-white tracking-tight truncate max-w-[130px] sm:max-w-[180px]">
                            {service.name}
                          </h3>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 ${theme.badgeClass}`}
                          >
                            {theme.badgeLabel}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5 flex items-center gap-1.5">
                          <span className="truncate max-w-[130px] sm:max-w-[160px]">{service.executable}</span>
                          {service.port && <span className="text-blue-400 shrink-0">:{service.port}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Status Pill */}
                    <span
                      className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border font-medium shrink-0 ${
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

                  {/* Authentication note for FileBrowser */}
                  {service.type === 'filebrowser' && (
                    <div className="mt-3.5 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-[11px]">
                      <div className="text-slate-300">
                        <span className="text-slate-500 mr-1.5">Access:</span>
                        <span className="text-emerald-400 font-medium">Configured in First-Run Setup</span>
                      </div>
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

                    {(service as any).maxMemoryMb && (
                      <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800/30 text-amber-300">
                        {(service as any).maxMemoryMb}MB Cap
                      </span>
                    )}

                    {(service as any).cpuLimitPct && (
                      <span className="px-2 py-0.5 rounded bg-indigo-950/50 border border-indigo-800/30 text-indigo-300">
                        {(service as any).cpuLimitPct}% CPU
                      </span>
                    )}

                    <span className="px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/40 text-slate-400">
                      policy: {(service as any).restartPolicy || 'always'}
                    </span>

                    {currentStatus === 'backoff' && (
                      <span className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 animate-pulse">
                        Restart Backoff
                      </span>
                    )}

                    {currentStatus === 'failed' && (
                      <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-500/50 text-rose-300 font-semibold">
                        Circuit Breaker Tripped
                      </span>
                    )}

                    {cleanUrl && (
                      <a
                        href={url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 rounded bg-blue-950/50 border border-blue-800/30 text-blue-300 hover:bg-blue-900/60 hover:text-blue-200 transition-colors truncate max-w-full inline-flex items-center gap-1 shrink-0"
                        title={`Open ${cleanUrl}`}
                      >
                        <Globe className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                        <span className="truncate">{cleanUrl}</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                    {/* View Logs Button */}
                    <button
                      onClick={() => handleOpenLogs(service)}
                      className="p-1.5 rounded-lg border border-slate-700/80 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
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
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-600/30 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 transition-colors text-[11px] shrink-0"
                        title={`Open ${cleanUrl || url}`}
                      >
                        <span>Open</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}

                    {/* Delete Service */}
                    {onDeleteService && (
                      <button
                        onClick={() => setDeleteConfirmService(service)}
                        disabled={!!operating || isDeleting}
                        className="p-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 hover:border-rose-800/50 transition-colors disabled:opacity-50 shrink-0"
                        title={`Delete ${service.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Lifecycle Buttons */}
                  <div className="flex items-center space-x-1.5 shrink-0">
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
      {viewMode === 'table' && filteredServices.length > 0 && (
        <div className="glass-card rounded-2xl p-5 border border-slate-800 bg-slate-900/40 overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[720px]">
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
              {filteredServices.map((service) => {
                const proc = processStatuses[service.id];
                const currentStatus = proc ? proc.status : service.status;
                const currentPid = proc?.pid || service.pid;
                const operating = operatingIds[service.id];
                const isRunning = currentStatus === 'running';
                const theme = getServiceVisualTheme(service);
                const url = getServiceUrl(service);
                const cleanUrl = url ? url.split('?')[0].replace(/^https?:\/\//, '').replace(/\/$/, '') : '';

                return (
                  <tr key={service.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center space-x-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg ${theme.bgClass} border ${theme.borderClass} flex items-center justify-center shrink-0`}
                        >
                          {React.cloneElement(theme.icon as React.ReactElement, { className: 'w-4 h-4' })}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                            <span>{service.name}</span>
                            <span
                              className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full border ${theme.badgeClass}`}
                            >
                              {theme.badgeLabel}
                            </span>
                          </div>
                          {service.type === 'filebrowser' && (
                            <div className="text-[10px] text-emerald-400 font-medium mt-0.5">
                              Configured in Setup
                            </div>
                          )}
                        </div>
                      </div>
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
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg border border-blue-600/30 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 transition-colors"
                            title={`Open ${cleanUrl || url}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
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
                        {onDeleteService && (
                          <button
                            onClick={() => setDeleteConfirmService(service)}
                            disabled={!!operating || isDeleting}
                            className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 hover:border-rose-800/50 transition-colors"
                            title={`Delete ${service.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* Delete Confirmation Modal */}
      {deleteConfirmService && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card rounded-2xl p-6 border border-rose-500/30 max-w-md w-full shadow-2xl bg-[#0d121f] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Delete Native Service</h3>
                <p className="text-xs text-slate-400">Permanently unregister and clean up service</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 mb-4 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Name:</span>
                <span className="text-white font-medium">{deleteConfirmService.name}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Executable:</span>
                <span className="text-slate-300 font-mono text-[11px] truncate max-w-[220px]">
                  {deleteConfirmService.executable}
                </span>
              </div>
              {deleteConfirmService.port && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Port:</span>
                  <span className="text-blue-400 font-mono text-[11px]">:{deleteConfirmService.port}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Are you sure you want to delete <span className="text-rose-300 font-semibold">{deleteConfirmService.name}</span>?
              If this service is running, its process will be immediately stopped and all mapped reverse proxy routes will be deleted.
            </p>

            {deleteError && (
              <div className="mb-4 p-2.5 rounded-lg bg-rose-950/50 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmService(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!onDeleteService || !deleteConfirmService) return;
                  setIsDeleting(true);
                  setDeleteError(null);
                  try {
                    await onDeleteService(deleteConfirmService.id);
                    setDeleteConfirmService(null);
                  } catch (err: any) {
                    setDeleteError(err.message || 'Failed to delete service');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/30 transition-all disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isDeleting ? 'Deleting...' : 'Delete Service'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for Registering a New Service */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card rounded-2xl p-6 border border-slate-700 max-w-md w-full shadow-2xl bg-[#0d121f] max-h-[90vh] overflow-y-auto">
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">Executable Path or Binary Name</label>
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 text-[11px] font-semibold transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isUploadingExe ? `Uploading ${uploadExeProgress}%...` : 'Upload .exe'}</span>
                    <input
                      type="file"
                      accept=".exe,.bat,.cmd,.ps1"
                      className="hidden"
                      disabled={isUploadingExe}
                      onChange={handleBinaryUpload}
                    />
                  </label>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={executable}
                    onChange={(e) => {
                      setExecutable(e.target.value);
                      setUploadedExeName(null);
                    }}
                    placeholder="e.g. node.exe, caddy.exe, or C:\Path\app.exe"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500 pr-24"
                  />
                  {uploadedExeName && (
                    <div className="absolute right-2 top-2 flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Uploaded</span>
                    </div>
                  )}
                </div>
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
                  Auto-start on Ownbase launch
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
          <div className="bg-[#0b101d] border border-slate-700 rounded-2xl p-5 max-w-3xl w-full shadow-2xl flex flex-col h-[520px] max-h-[90vh]">
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
