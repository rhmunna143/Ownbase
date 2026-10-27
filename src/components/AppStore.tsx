'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Boxes,
  Download,
  FolderTree,
  Bot,
  Globe,
  Database,
  Terminal,
  Server,
  Zap,
  CheckCircle2,
  X,
  Plus,
  Play,
  RotateCw,
  ExternalLink,
  Loader2,
  Upload,
  Check,
  Search,
  HardDrive,
  FileCode,
  Sparkles,
} from 'lucide-react';
import { ServiceRecord } from '@/shared/types';
import { serverApi } from '@/shared/apiClient';
import { modalDialog } from '@/components/ModalDialog';

interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: React.ReactNode;
  defaultExecutable: string;
  defaultPort: number;
  defaultSubdomain: string;
  badge: string;
  isPackaged: boolean;
}

interface BinaryItem {
  id: string;
  name: string;
  filename: string;
  category: string;
  description: string;
  defaultPort: number;
  defaultSubdomain: string;
  badge: string;
  existsOnDisk: boolean;
  sizeBytes: number;
  downloadUrl: string;
  installed: boolean;
  serviceId?: string;
  serviceStatus?: string;
}

interface AppStoreProps {
  existingServices: ServiceRecord[];
  onCreateServiceWithRoute: (data: {
    name: string;
    type: string;
    executable: string;
    port: number;
    subdomain: string;
    description: string;
    autoStart: boolean;
  }) => Promise<void>;
  onStartService: (serviceId: string) => Promise<void>;
}

export const AppStore: React.FC<AppStoreProps> = ({
  existingServices,
  onCreateServiceWithRoute,
  onStartService,
}) => {
  const [activeView, setActiveView] = useState<'catalog' | 'binaries'>('catalog');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [executable, setExecutable] = useState('');
  const [port, setPort] = useState<number>(3000);
  const [subdomain, setSubdomain] = useState('');
  const [description, setDescription] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [catalogItems, setCatalogItems] = useState<Template[]>([]);
  const [binaries, setBinaries] = useState<BinaryItem[]>([]);
  const [binarySearch, setBinarySearch] = useState('');
  const [isLoadingBinaries, setIsLoadingBinaries] = useState(false);
  const [isUploadingExe, setIsUploadingExe] = useState(false);
  const [uploadExeProgress, setUploadExeProgress] = useState(0);
  const [uploadedExeName, setUploadedExeName] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const fetchBinaries = useCallback(async () => {
    setIsLoadingBinaries(true);
    try {
      const list = await serverApi.getBinariesList();
      if (Array.isArray(list)) {
        setBinaries(list);
      }
    } catch {} finally {
      setIsLoadingBinaries(false);
    }
  }, []);

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
        fetchBinaries();
      } else {
        await modalDialog.alert(res.error || 'Binary upload failed', 'Upload Failed', 'danger');
      }
    } catch (err: any) {
      await modalDialog.alert(`Upload error: ${err.message}`, 'Upload Error', 'danger');
    } finally {
      setIsUploadingExe(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    serverApi.getCatalog().then((recipes) => {
      if (!mounted || !Array.isArray(recipes) || recipes.length === 0) return;
      const mapped: Template[] = recipes.map((r: any) => {
        let iconElem = <Boxes className="w-6 h-6 text-cyan-400" />;
        if (r.icon === 'FolderTree') iconElem = <FolderTree className="w-6 h-6 text-emerald-400" />;
        else if (r.icon === 'Bot') iconElem = <Bot className="w-6 h-6 text-purple-400" />;
        else if (r.icon === 'Zap') iconElem = <Zap className="w-6 h-6 text-green-400" />;
        else if (r.icon === 'Globe') iconElem = <Globe className="w-6 h-6 text-blue-400" />;
        else if (r.icon === 'Server') iconElem = <Server className="w-6 h-6 text-indigo-400" />;
        else if (r.icon === 'Database') iconElem = <Database className="w-6 h-6 text-red-400" />;
        else if (r.icon === 'Terminal') iconElem = <Terminal className="w-6 h-6 text-amber-400" />;
        else if (r.icon === 'RefreshCw' || r.icon === 'RotateCw' || r.icon === 'FolderSync') iconElem = <RotateCw className="w-6 h-6 text-amber-400" />;

        return {
          id: r.id,
          name: r.name,
          category: r.category,
          description: r.description,
          icon: iconElem,
          defaultExecutable: r.spec?.command || r.spec?.startCommand || `${r.id}.exe`,
          defaultPort: r.defaultPort,
          defaultSubdomain: r.defaultSubdomain,
          badge: r.badge || 'Catalog Recipe',
          isPackaged: r.isPackaged ?? true,
        };
      });
      setCatalogItems(mapped);
    }).catch(() => {});

    fetchBinaries();

    return () => {
      mounted = false;
    };
  }, [fetchBinaries]);

  const templates: Template[] = [
    {
      id: 'filebrowser',
      name: 'FileBrowser Cloud Drive',
      category: 'Storage',
      description: 'Native personal cloud storage, file explorer, and media streaming drive with user access control.',
      icon: <FolderTree className="w-6 h-6 text-emerald-400" />,
      defaultExecutable: 'filebrowser.exe',
      defaultPort: 8080,
      defaultSubdomain: 'files',
      badge: 'Built-in Portable',
      isPackaged: true,
    },
    {
      id: 'ollama',
      name: 'Ollama AI Engine',
      category: 'AI / LLM',
      description: 'Dynamic local/hybrid AI inference server supporting Hermes 3, Llama 3, Mistral & OpenAI-compatible API.',
      icon: <Bot className="w-6 h-6 text-purple-400" />,
      defaultExecutable: 'ollama.exe',
      defaultPort: 11434,
      defaultSubdomain: 'ai',
      badge: 'Dynamic AI',
      isPackaged: true,
    },
    {
      id: 'minio',
      name: 'MinIO S3 Object Storage',
      category: 'Storage',
      description: 'High-performance, S3-compatible cloud object storage built for large-scale enterprise deployments.',
      icon: <Server className="w-6 h-6 text-rose-400" />,
      defaultExecutable: 'minio.exe',
      defaultPort: 9000,
      defaultSubdomain: 's3',
      badge: 'S3 Compatible',
      isPackaged: true,
    },
    {
      id: 'caddy',
      name: 'Caddy Reverse Proxy & TLS',
      category: 'Web',
      description: 'Automated reverse proxy, local TLS certificates, and subdomain router for *.localhost.',
      icon: <Globe className="w-6 h-6 text-blue-400" />,
      defaultExecutable: 'caddy.exe',
      defaultPort: 2019,
      defaultSubdomain: 'proxy',
      badge: 'Reverse Proxy',
      isPackaged: true,
    },
    {
      id: 'redis',
      name: 'Redis / Memurai Cache',
      category: 'Databases',
      description: 'In-memory data structure store used as a distributed cache, message broker, and streaming engine.',
      icon: <Database className="w-6 h-6 text-red-400" />,
      defaultExecutable: 'redis-server.exe',
      defaultPort: 6379,
      defaultSubdomain: 'redis',
      badge: 'Key-Value Cache',
      isPackaged: true,
    },
    {
      id: 'pocketbase',
      name: 'PocketBase Realtime Backend & DB',
      category: 'Databases',
      description: 'All-in-one embedded SQLite database, realtime subscriptions, authentication, and file storage.',
      icon: <Database className="w-6 h-6 text-emerald-400" />,
      defaultExecutable: 'pocketbase.exe',
      defaultPort: 8090,
      defaultSubdomain: 'pocketbase',
      badge: 'Realtime DB',
      isPackaged: true,
    },
    {
      id: 'syncthing',
      name: 'Syncthing Continuous Sync & Backup',
      category: 'Storage',
      description: 'Continuous, encrypted peer-to-peer file synchronization and backup between Android, iOS, Windows, Mac, and Linux.',
      icon: <RotateCw className="w-6 h-6 text-amber-400" />,
      defaultExecutable: 'syncthing.exe',
      defaultPort: 8384,
      defaultSubdomain: 'syncthing',
      badge: 'P2P Backup Engine',
      isPackaged: true,
    },
    {
      id: 'terminal',
      name: 'Web Terminal & PowerShell Console',
      category: 'Tools',
      description: 'Full interactive browser-based terminal with PowerShell and CMD access at terminal.localhost.',
      icon: <Terminal className="w-6 h-6 text-amber-400" />,
      defaultExecutable: 'terminal.exe',
      defaultPort: 7681,
      defaultSubdomain: 'terminal',
      badge: 'Browser Terminal',
      isPackaged: true,
    },
    {
      id: 'tailscale',
      name: 'Tailscale Mesh VPN',
      category: 'Tools',
      description: 'Zero-configuration WireGuard mesh networking for secure remote machine access anywhere.',
      icon: <Zap className="w-6 h-6 text-indigo-400" />,
      defaultExecutable: 'tailscale.exe',
      defaultPort: 41641,
      defaultSubdomain: 'mesh',
      badge: 'Mesh VPN',
      isPackaged: true,
    },
    {
      id: 'nodejs',
      name: 'Node.js Web App / API',
      category: 'Web',
      description: 'Host Next.js, Express, Fastify, NestJS, or Vite web apps as native background processes.',
      icon: <Zap className="w-6 h-6 text-green-400" />,
      defaultExecutable: 'node.exe',
      defaultPort: 3000,
      defaultSubdomain: 'node',
      badge: '1-Click Runtime',
      isPackaged: false,
    },
    {
      id: 'python',
      name: 'Python FastAPI / Flask',
      category: 'Web',
      description: 'High performance Python web framework running via Uvicorn, Gunicorn, or standard Python interpreter.',
      icon: <Globe className="w-6 h-6 text-blue-400" />,
      defaultExecutable: 'python.exe',
      defaultPort: 8000,
      defaultSubdomain: 'api',
      badge: '1-Click Runtime',
      isPackaged: false,
    },
    {
      id: 'postgres',
      name: 'PostgreSQL 16 Database Server',
      category: 'Databases',
      description: 'Enterprise-grade SQL database for web services, microservices, and apps with ACID compliance and JSONB support.',
      icon: <Database className="w-6 h-6 text-cyan-400" />,
      defaultExecutable: 'postgres.exe',
      defaultPort: 5432,
      defaultSubdomain: 'postgres',
      badge: 'Relational DB',
      isPackaged: true,
    },
    {
      id: 'custom',
      name: 'Custom Windows Binary (.exe)',
      category: 'Custom',
      description: 'Supervise any Windows executable, batch file (.bat), or CLI utility with auto-subdomain routing.',
      icon: <Terminal className="w-6 h-6 text-amber-400" />,
      defaultExecutable: 'custom-app.exe',
      defaultPort: 8085,
      defaultSubdomain: 'myapp',
      badge: 'Any Windows App',
      isPackaged: false,
    },
  ];

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setName(template.name);
    setExecutable(template.defaultExecutable);
    setPort(template.defaultPort);
    setSubdomain(template.defaultSubdomain);
    setDescription(template.description);
    setAutoStart(true);
  };

  const handleQuickInstall = async (item: {
    id: string;
    name: string;
    filename?: string;
    defaultExecutable?: string;
    defaultPort: number;
    defaultSubdomain: string;
    description: string;
  }) => {
    const exeName = item.filename || item.defaultExecutable || `${item.id}.exe`;
    setInstallingId(item.id);
    try {
      await onCreateServiceWithRoute({
        name: item.name,
        type: item.id,
        executable: exeName,
        port: item.defaultPort,
        subdomain: item.defaultSubdomain,
        description: item.description,
        autoStart: true,
      });
      fetchBinaries();
    } catch (err: any) {
      await modalDialog.alert(`Installation failed: ${err.message}`, 'Installation Failed', 'danger');
    } finally {
      setInstallingId(null);
    }
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !executable || !port || !subdomain) return;

    setIsSubmitting(true);
    try {
      await onCreateServiceWithRoute({
        name,
        type: selectedTemplate?.id || 'custom',
        executable,
        port,
        subdomain,
        description,
        autoStart,
      });
      setSelectedTemplate(null);
      fetchBinaries();
    } catch (err: any) {
      await modalDialog.alert(`Deployment failed: ${err.message}`, 'Deployment Failed', 'danger');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return 'Available';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getBinaryIcon = (filename: string) => {
    const f = filename.toLowerCase();
    if (f.includes('filebrowser')) return <FolderTree className="w-5 h-5 text-emerald-400" />;
    if (f.includes('ollama')) return <Bot className="w-5 h-5 text-purple-400" />;
    if (f.includes('minio')) return <Server className="w-5 h-5 text-rose-400" />;
    if (f.includes('caddy')) return <Globe className="w-5 h-5 text-blue-400" />;
    if (f.includes('redis')) return <Database className="w-5 h-5 text-red-400" />;
    if (f.includes('pocketbase')) return <Database className="w-5 h-5 text-emerald-400" />;
    if (f.includes('syncthing')) return <RotateCw className="w-5 h-5 text-amber-400" />;
    if (f.includes('terminal')) return <Terminal className="w-5 h-5 text-amber-400" />;
    if (f.includes('tailscale')) return <Zap className="w-5 h-5 text-indigo-400" />;
    return <Boxes className="w-5 h-5 text-cyan-400" />;
  };

  const categories = ['all', 'Storage', 'AI / LLM', 'Databases', 'Web', 'Tools', 'Custom'];

  const effectiveTemplates = catalogItems.length > 0 ? catalogItems : templates;

  const filteredTemplates = activeCategory === 'all'
    ? effectiveTemplates
    : effectiveTemplates.filter((t) => t.category.toLowerCase() === activeCategory.toLowerCase() || t.category.includes(activeCategory));

  const filteredBinaries = binaries.filter((b) => {
    if (!binarySearch) return true;
    const q = binarySearch.toLowerCase();
    return (
      b.name.toLowerCase().includes(q) ||
      b.filename.toLowerCase().includes(q) ||
      b.category.toLowerCase().includes(q) ||
      b.defaultSubdomain.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Banner with View Switcher */}
      <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Boxes className="w-5 h-5 text-indigo-400" />
              App Store &amp; Template Hub
            </h2>
            <div className="flex items-center bg-slate-800/80 p-0.5 rounded-xl border border-slate-700/60">
              <button
                onClick={() => setActiveView('catalog')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  activeView === 'catalog'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>1-Click Catalog</span>
              </button>
              <button
                onClick={() => {
                  setActiveView('binaries');
                  fetchBinaries();
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  activeView === 'binaries'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Template Hub (.exe)</span>
                {binaries.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-indigo-200">
                    {binaries.length}
                  </span>
                )}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
            Download native Windows <code>.exe</code> binaries directly to your machine or 1-click install them into your Ownbase server with instant <code>*.localhost</code> Caddy reverse proxy routing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="cursor-pointer flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all">
            <Upload className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isUploadingExe ? `Uploading ${uploadExeProgress}%...` : 'Upload .exe'}</span>
            <input
              type="file"
              accept=".exe,.bat,.cmd"
              className="hidden"
              disabled={isUploadingExe}
              onChange={handleBinaryUpload}
            />
          </label>

          <button
            onClick={() => handleSelectTemplate(templates[templates.length - 1])}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Deploy Custom App</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: TEMPLATE HUB OF .EXE BINARIES */}
      {activeView === 'binaries' && (
        <div className="space-y-4">
          {/* Search and Summary */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={binarySearch}
                onChange={(e) => setBinarySearch(e.target.value)}
                placeholder="Search .exe binaries (e.g. filebrowser, ollama, minio, redis, caddy)..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-[11px]">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span>{binaries.filter((b) => b.existsOnDisk).length} Ready on Disk</span>
              </span>
              <button
                onClick={fetchBinaries}
                disabled={isLoadingBinaries}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                title="Refresh Binaries"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isLoadingBinaries ? 'animate-spin text-indigo-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Binaries Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBinaries.map((b) => {
              const isInstalled = b.installed || existingServices.some(
                (s) => s.type === b.id || s.executable.toLowerCase().includes(b.filename.toLowerCase())
              );
              const isBusy = installingId === b.id;

              return (
                <div
                  key={b.id + b.filename}
                  className="glass-card rounded-xl p-5 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between bg-slate-900/40 group"
                >
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center group-hover:scale-105 transition-transform">
                        {getBinaryIcon(b.filename)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          {formatBytes(b.sizeBytes)}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-950/60 text-indigo-300 border border-indigo-700/50">
                          {b.badge}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-white tracking-tight">{b.name}</h3>
                    <div className="text-[11px] font-mono text-indigo-300 mt-0.5 flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-slate-400" />
                      <span>{b.filename}</span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400 mt-1.5 flex items-center gap-2">
                      <span>Port :{b.defaultPort}</span>
                      <span>•</span>
                      <span>{b.defaultSubdomain}.localhost</span>
                    </div>

                    <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                      {b.description}
                    </p>
                  </div>

                  <div className="mt-5 pt-3.5 border-t border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      {isInstalled ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Installed &amp; Managed
                        </span>
                      ) : b.existsOnDisk ? (
                        <span className="inline-flex items-center gap-1.5 text-cyan-400 font-medium text-[11px]">
                          <Check className="w-3.5 h-3.5" /> Ready to Run
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Packaged Binary</span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {/* Direct Download .exe Button */}
                      <a
                        href={serverApi.getBinaryDownloadUrl(b.filename)}
                        download={b.filename}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all hover:text-white shadow-sm"
                        title={`Download ${b.filename} directly to your PC`}
                      >
                        <Download className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Download .exe</span>
                      </a>

                      {/* 1-Click Install to Project Button */}
                      <button
                        onClick={() => handleQuickInstall(b)}
                        disabled={isBusy}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                          isInstalled
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current" />
                        )}
                        <span>{isInstalled ? 'Re-install' : 'Install & Run'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: 1-CLICK APPLICATION CATALOG */}
      {activeView === 'catalog' && (
        <div className="space-y-6">
          {/* Category Pills */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize whitespace-nowrap ${
                  activeCategory === cat
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Templates Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => {
              const isInstalled = existingServices.some(
                (s) => s.type === template.id || s.name.toLowerCase().includes(template.name.toLowerCase().slice(0, 6))
              );

              return (
                <div
                  key={template.id}
                  className="glass-card rounded-xl p-5 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between bg-slate-900/40 group"
                >
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-11 h-11 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center group-hover:scale-105 transition-transform">
                        {template.icon}
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {template.badge}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-white tracking-tight">{template.name}</h3>
                    <div className="text-[11px] font-mono text-slate-400 mt-1 flex items-center gap-2">
                      <span>Port :{template.defaultPort}</span>
                      <span>•</span>
                      <span>{template.defaultSubdomain}.localhost</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">
                      {template.description}
                    </p>
                  </div>

                  <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    {isInstalled ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                        <CheckCircle2 className="w-4 h-4" /> Installed &amp; Managed
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Ready to install</span>
                    )}

                    <div className="flex items-center gap-1.5">
                      {template.defaultExecutable?.toLowerCase().endsWith('.exe') && (
                        <a
                          href={serverApi.getBinaryDownloadUrl(template.defaultExecutable)}
                          download={template.defaultExecutable}
                          title={`Download ${template.defaultExecutable} directly to your machine`}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all hover:text-white"
                        >
                          <Download className="w-3.5 h-3.5 text-indigo-400" />
                          <span>.exe</span>
                        </a>
                      )}

                      <button
                        onClick={() => handleSelectTemplate(template)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          isInstalled
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{isInstalled ? 'Add Another' : '1-Click Install'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 1-Click Install & Configure Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card rounded-2xl p-6 border border-slate-700 w-full max-w-lg shadow-2xl bg-[#0d121f] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  {selectedTemplate.icon}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Deploy {selectedTemplate.name}
                  </h3>
                  <p className="text-xs text-slate-400">Configure port and dynamic domain route</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedTemplate(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDeploy} className="space-y-4 mt-5 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">Service Display Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">
                    Executable Binary (.exe) or Command
                  </label>
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 text-[11px] font-semibold transition-colors">
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
                    placeholder="e.g. syncthing.exe, node.exe, or C:\Apps\service.exe"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500 pr-24"
                  />
                  {uploadedExeName && (
                    <div className="absolute right-2 top-2 flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Uploaded</span>
                    </div>
                  )}
                </div>
                <div className="mt-2 p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 space-y-1.5 leading-relaxed">
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                    <span>How custom executables install &amp; resolve:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
                    <li><strong className="text-slate-300">App folder:</strong> Drop your binary into <code className="text-indigo-300">extraResources\bin\&lt;app&gt;.exe</code>.</li>
                    <li><strong className="text-slate-300">Absolute path:</strong> Specify any full path like <code className="text-indigo-300">C:\Apps\my-tool\server.exe</code>.</li>
                    <li><strong className="text-slate-300">Windows PATH:</strong> Any command already installed on your machine (e.g. <code className="text-indigo-300">node.exe</code>, <code className="text-indigo-300">python.exe</code>).</li>
                  </ul>
                  <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/80">
                    💡 Any native Windows service or daemon that listens on a TCP port can be supervised here.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-medium">Internal TCP Port</label>
                  <input
                    type="number"
                    required
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-medium">Subdomain Prefix</label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      required
                      value={subdomain}
                      onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-l-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <span className="bg-slate-800 border border-l-0 border-slate-700 rounded-r-lg px-2.5 py-2 text-slate-400 font-mono text-[11px]">
                      .localhost
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="app-autostart"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="app-autostart" className="text-slate-300 cursor-pointer">
                  Auto-start with Ownbase Server on boot
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deploying...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Deploy &amp; Start Service</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
