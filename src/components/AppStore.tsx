'use client';

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { ServiceRecord } from '@/shared/types';
import { serverApi } from '@/shared/apiClient';

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

    return () => {
      mounted = false;
    };
  }, []);

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
      description: 'Local LLM inference server supporting Hermes 3, Llama 3, Mistral, and OpenAI-compatible API.',
      icon: <Bot className="w-6 h-6 text-purple-400" />,
      defaultExecutable: 'ollama.exe',
      defaultPort: 11434,
      defaultSubdomain: 'ai',
      badge: 'Built-in Portable',
      isPackaged: true,
    },
    {
      id: 'nodejs',
      name: 'Node.js Web App / API',
      category: 'Web Applications',
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
      category: 'Web Applications',
      description: 'High performance Python web framework running via Uvicorn, Gunicorn, or standard Python interpreter.',
      icon: <Globe className="w-6 h-6 text-blue-400" />,
      defaultExecutable: 'python.exe',
      defaultPort: 8000,
      defaultSubdomain: 'api',
      badge: '1-Click Runtime',
      isPackaged: false,
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
      isPackaged: false,
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
      isPackaged: false,
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
    } catch (err: any) {
      alert(`Deployment failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = ['all', 'Storage', 'AI & ML', 'Application', 'Database', 'Web', 'Tools', 'Custom'];

  const effectiveTemplates = catalogItems.length > 0 ? catalogItems : templates;

  const filteredTemplates = activeCategory === 'all'
    ? effectiveTemplates
    : effectiveTemplates.filter((t) => t.category.toLowerCase() === activeCategory.toLowerCase() || t.category.includes(activeCategory));

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/30 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Boxes className="w-5 h-5 text-indigo-400" />
            1-Click App Store &amp; Service Catalog
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Install and supervise native Windows servers simply. Every application is deployed as a native Windows process with automatic <code>*.localhost</code> Caddy reverse proxy routing.
          </p>
        </div>

        <button
          onClick={() => handleSelectTemplate(templates[templates.length - 1])}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Deploy Custom .exe</span>
        </button>
      </div>

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

              <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex items-center justify-between">
                {isInstalled ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                    <CheckCircle2 className="w-4 h-4" /> Installed &amp; Managed
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Ready to install</span>
                )}

                <button
                  onClick={() => handleSelectTemplate(template)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isInstalled
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isInstalled ? 'Add Another' : '1-Click Install'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 1-Click Install Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card rounded-2xl p-6 border border-slate-700 w-full max-w-lg shadow-2xl bg-[#0d121f]">
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
                <label className="block text-slate-300 mb-1 font-medium">
                  Executable Binary (.exe) or Command
                </label>
                <input
                  type="text"
                  required
                  value={executable}
                  onChange={(e) => setExecutable(e.target.value)}
                  placeholder="e.g. node.exe, python.exe, or C:\Apps\service.exe"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Searched automatically in <code>extraResources/bin</code>, project folder, and Windows PATH.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                  Auto-start with Windows Server Hub on boot
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
