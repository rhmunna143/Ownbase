'use client';

import React, { useState } from 'react';
import {
  Globe,
  Plus,
  ArrowRight,
  Lock,
  Trash2,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Shield,
  Key,
  Network,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { RouteRecord, ServiceRecord, CaddyStatus, TailscaleStatus } from '@/shared/types';

interface RoutesTableProps {
  routes: RouteRecord[];
  services: ServiceRecord[];
  caddyStatus: CaddyStatus | null;
  tailscaleStatus: TailscaleStatus | null;
  onCreateRoute: (data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }) => Promise<void>;
  onDeleteRoute: (routeId: string) => Promise<void>;
  onSyncCaddy: () => Promise<void>;
  onTestRoute: (host: string) => Promise<{ success: boolean; status?: number; latencyMs: number; error?: string }>;
  onConnectTailscale: (authKey: string, hostname?: string) => Promise<void>;
  onDisconnectTailscale: () => Promise<void>;
  isLoading: boolean;
}

export const RoutesTable: React.FC<RoutesTableProps> = ({
  routes,
  services,
  caddyStatus,
  tailscaleStatus,
  onCreateRoute,
  onDeleteRoute,
  onSyncCaddy,
  onTestRoute,
  onConnectTailscale,
  onDisconnectTailscale,
  isLoading,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [targetPort, setTargetPort] = useState('');
  const [tlsEnabled, setTlsEnabled] = useState(true);
  const [customDomain, setCustomDomain] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [testingHost, setTestingHost] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; status?: number; latencyMs: number; error?: string }>>({});

  // Tailscale form states
  const [authKey, setAuthKey] = useState('');
  const [hostname, setHostname] = useState('windows-server-hub');
  const [isConnectingTs, setIsConnectingTs] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let finalSubdomain = subdomain.trim();
    if (!finalSubdomain && customDomain.trim()) {
      finalSubdomain = customDomain.trim().split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '') || 'app';
      setSubdomain(finalSubdomain);
    }

    if (!finalSubdomain) {
      setFormError('Please enter a Subdomain Prefix (e.g. files, hub, app) or a Custom Domain');
      return;
    }

    const portNum = parseInt(targetPort, 10);
    if (!targetPort || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setFormError('Please enter a valid upstream port number (1 - 65535)');
      return;
    }

    let finalServiceId = serviceId;
    if (!finalServiceId || finalServiceId === 'custom' || finalServiceId.endsWith('-preset')) {
      const match = services.find((s) => s.port === portNum);
      finalServiceId = match?.id || services[0]?.id || 'custom';
    }

    setIsSubmitting(true);
    try {
      await onCreateRoute({
        serviceId: finalServiceId,
        subdomain: finalSubdomain,
        targetPort: portNum,
        tlsEnabled,
        customDomain: customDomain.trim() || undefined,
      });
      setIsModalOpen(false);
      setSubdomain('');
      setTargetPort('');
      setCustomDomain('');
      setFormError(null);
    } catch (err: any) {
      setFormError(err.message || 'Failed to register route with Caddy reverse proxy');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await onSyncCaddy();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestRoute = async (host: string) => {
    setTestingHost(host);
    try {
      const res = await onTestRoute(host);
      setTestResults((prev) => ({ ...prev, [host]: res }));
    } finally {
      setTestingHost(null);
    }
  };

  const handleTailscaleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authKey) return;
    setIsConnectingTs(true);
    try {
      await onConnectTailscale(authKey, hostname);
      setAuthKey('');
    } finally {
      setIsConnectingTs(false);
    }
  };

  const copyMeshIp = () => {
    if (tailscaleStatus?.ip) {
      navigator.clipboard.writeText(tailscaleStatus.ip);
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 2000);
    }
  };

  const isCaddyActive = caddyStatus?.isListening ?? false;
  const isTailscaleConnected = tailscaleStatus?.connected ?? false;

  return (
    <div className="space-y-6">
      {/* SECTION 1: Tailscale Global Mesh Overlay */}
      <div className="glass-card rounded-xl p-5 border border-slate-800">
        <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800/80 mb-4 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Network className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                Tailscale Mesh VPN Integration
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    isTailscaleConnected
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {isTailscaleConnected ? 'Mesh Connected' : 'Disconnected'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Global encrypted access via WireGuard mesh overlay (executes <code>tailscale.exe up --authkey</code> natively).
              </p>
            </div>
          </div>

          {isTailscaleConnected && (
            <div className="flex items-center gap-2">
              <button
                onClick={onDisconnectTailscale}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {isTailscaleConnected ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3.5 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Active Mesh IPv4</span>
                <div className="text-base font-semibold font-mono text-indigo-400 mt-1 flex items-center gap-2">
                  <span>{tailscaleStatus?.ip}</span>
                  <button
                    onClick={copyMeshIp}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                    title="Copy Mesh IP"
                  >
                    {copiedIp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 live-indicator-active" />
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Encrypted Overlay</span>
              <div className="text-sm font-semibold text-slate-200 mt-1 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span>WireGuard Mesh Tunnel</span>
              </div>
              <span className="text-[10px] text-slate-400">Zero port-forwarding required</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Auth Token State</span>
              <div className="text-sm font-mono text-slate-300 mt-1">
                {tailscaleStatus?.authKeyMasked || 'Configured in DB'}
              </div>
              <span className="text-[10px] text-slate-400">Saved in PostgreSQL system_configs</span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleTailscaleConnect} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="sm:col-span-2">
              <label className="block text-slate-300 mb-1">Tailscale Auth Key (tskey-auth-...)</label>
              <div className="relative">
                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  placeholder="tskey-auth-k..."
                  value={authKey}
                  onChange={(e) => setAuthKey(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isConnectingTs || !authKey}
                className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 text-xs shadow-md shadow-indigo-600/20"
              >
                {isConnectingTs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />}
                <span>{isConnectingTs ? 'Connecting...' : 'Connect to Mesh'}</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* SECTION 2: Caddy Dynamic Reverse Proxy Routes */}
      <div className="glass-card rounded-xl p-5 border border-slate-800">
        <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800/80 mb-4 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Globe className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                Caddy Dynamic Reverse Proxy
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    isCaddyActive
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {isCaddyActive ? 'Admin API 127.0.0.1:2019 Active' : 'Caddy Gateway Offline'}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                  {caddyStatus?.activeRoutesCount || 0} active in Caddy
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Dynamic zero-reload routing via Caddy REST API (<code>/config/apps/http/servers/srv0/routes</code>).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing || !isCaddyActive}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40 shrink-0"
              title="Push all database routes to Caddy Admin API"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-blue-400' : ''}`} />
              <span>Sync Caddy</span>
            </button>

            <button
              onClick={() => {
                setFormError(null);
                if (services.length > 0 && !serviceId) {
                  setServiceId(services[0].id);
                  if (services[0].port) setTargetPort(services[0].port.toString());
                  setSubdomain(services[0].type || services[0].name.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                } else if (!serviceId) {
                  setServiceId('custom');
                  setTargetPort('3001');
                  setSubdomain('hub');
                }
                setIsModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Dynamic Route</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[680px]">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400 font-mono uppercase text-[10px]">
                <th className="pb-3 px-3">Subdomain Host & Domain</th>
                <th className="pb-3 px-3">Target Service</th>
                <th className="pb-3 px-3">Upstream Port</th>
                <th className="pb-3 px-3">Global Mesh Preview</th>
                <th className="pb-3 px-3">Proxy Test</th>
                <th className="pb-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {routes.map((route) => {
                const host = `${route.subdomain}.localhost`;
                const isTesting = testingHost === host || (route.customDomain && testingHost === route.customDomain);
                const testRes = testResults[host] || (route.customDomain ? testResults[route.customDomain] : undefined);
                const hasCustomDomain = !!route.customDomain;
                const customDomainUrl = hasCustomDomain
                  ? `${route.tlsEnabled ? 'https' : 'http'}://${route.customDomain}`
                  : null;

                return (
                  <tr key={route.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="space-y-1">
                        <div className="font-mono font-medium text-blue-300 flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span>{host}</span>
                        </div>
                        {hasCustomDomain && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 flex items-center gap-1 shadow-sm">
                              <Shield className="w-3 h-3 text-emerald-400" />
                              <span>{route.customDomain}</span>
                            </span>
                            <a
                              href={customDomainUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-400 hover:text-emerald-400 transition-colors p-0.5 rounded"
                              title={`Open ${customDomainUrl}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">
                          {route.service?.name || (route.targetPort === 3001 ? 'Ownbase Web Hub' : 'Custom Upstream')}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-indigo-400">
                      <div className="flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-slate-500" />
                        <span>{route.targetHost}:{route.targetPort}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {tailscaleStatus?.ip ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded border border-emerald-800/40">
                            http://{tailscaleStatus.ip}:{route.targetPort}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-[10px]">Connect Tailscale</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTestRoute(route.customDomain || host)}
                          disabled={isTesting || !isCaddyActive}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] transition-colors disabled:opacity-40"
                          title="Send test HTTP request through Caddy proxy"
                        >
                          <Zap className={`w-3 h-3 ${isTesting ? 'animate-bounce text-yellow-400' : 'text-slate-400'}`} />
                          <span>{isTesting ? 'Testing...' : 'Test'}</span>
                        </button>

                        {testRes && (
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              testRes.success
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                                : 'bg-rose-950/60 text-rose-300 border border-rose-800/40'
                            }`}
                          >
                            {testRes.success ? `${testRes.latencyMs}ms (${testRes.status})` : 'Failed'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => onDeleteRoute(route.id)}
                        className="p-1.5 rounded-lg border border-slate-700/80 bg-slate-900 text-slate-400 hover:text-rose-400 hover:border-rose-700/50 transition-colors"
                        title="Delete Route from Caddy and Database"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {routes.length === 0 && !isLoading && (
            <div className="text-center py-8 text-slate-500 text-xs">
              No routes mapped yet. Click &quot;Add Dynamic Route&quot; above to register your first Caddy route.
            </div>
          )}
        </div>

        {/* Modal for adding route */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#0f172a] border border-slate-700 rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-sm font-semibold text-slate-100 mb-1">Add Dynamic Proxy Route & Domain</h3>
              <p className="text-xs text-slate-400 mb-4">
                Registers host mapping dynamically into Caddy REST API without server restart.
              </p>

              {formError && (
                <div className="p-3 mb-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-slate-300 mb-1 font-medium">Target Native Service / Proxy Upstream</label>
                  <select
                    value={serviceId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setServiceId(val);
                      setFormError(null);
                      if (val === 'custom') {
                        // User enters custom port
                      } else if (val === 'ownbase-hub') {
                        setTargetPort('3001');
                        if (!subdomain) setSubdomain('hub');
                      } else if (val === 'filebrowser-preset') {
                        setTargetPort('8080');
                        if (!subdomain) setSubdomain('files');
                      } else if (val === 'terminal-preset') {
                        setTargetPort('7681');
                        if (!subdomain) setSubdomain('terminal');
                      } else if (val === 'minio-preset') {
                        setTargetPort('9000');
                        if (!subdomain) setSubdomain('s3');
                      } else if (val === 'syncthing-preset') {
                        setTargetPort('8384');
                        if (!subdomain) setSubdomain('syncthing');
                      } else if (val === 'ollama-preset') {
                        setTargetPort('11434');
                        if (!subdomain) setSubdomain('ai');
                      } else {
                        const s = services.find((x) => x.id === val);
                        if (s && s.port) {
                          setTargetPort(s.port.toString());
                        }
                        if (s && !subdomain) {
                          setSubdomain(s.type || s.name.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                        }
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500 text-xs"
                  >
                    <optgroup label="⚡ Platform & Custom Upstreams">
                      <option value="custom">⚡ Custom Upstream Port (Enter Port & Subdomain Below)</option>
                      <option value="ownbase-hub">🏠 Ownbase Web Hub Dashboard (Port 3001)</option>
                    </optgroup>
                    {services.length > 0 ? (
                      <optgroup label="Installed Server Services">
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.executable} {s.port ? `:${s.port}` : ''})
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      <optgroup label="Default Service Presets">
                        <option value="filebrowser-preset">📁 FileBrowser Storage (:8080)</option>
                        <option value="terminal-preset">💻 Web Terminal (:7681)</option>
                        <option value="minio-preset">📦 S3 Object Storage (:9000)</option>
                        <option value="syncthing-preset">🔄 Syncthing Sync (:8384)</option>
                        <option value="ollama-preset">🤖 Ollama AI Inference (:11434)</option>
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-medium">
                    Custom Domain <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ownbase.rhmunna.pro.bd or app.mydomain.com"
                    value={customDomain}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomDomain(val);
                      setFormError(null);
                      if (!subdomain || subdomain === 'hub' || subdomain === 'app') {
                        const cleanPrefix = val.split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
                        if (cleanPrefix) setSubdomain(cleanPrefix);
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono text-xs"
                  />
                  {customDomain && (
                    <div className="mt-1.5 p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-[11px] text-indigo-200 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5 text-indigo-300">
                        <Network className="w-3.5 h-3.5 text-indigo-400" />
                        <span>DNS Configuration Tip</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">
                        To point this domain to your server: In your DNS registrar (Cloudflare / Namecheap / GoDaddy), create a <strong>DNS A-record</strong> for{' '}
                        <code className="text-indigo-300 font-mono font-semibold">{customDomain}</code> pointing to your server's Public IP or Tailscale IP:{' '}
                        <code className="text-emerald-400 font-mono font-semibold">{tailscaleStatus?.ip || '100.84.32.40'}</code>.
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-medium">
                    Local Subdomain Prefix <span className="text-slate-500 font-normal">(*.localhost)</span>
                  </label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      required
                      placeholder="e.g. ownbase, files, ai"
                      value={subdomain}
                      onChange={(e) => {
                        setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                        setFormError(null);
                      }}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-l-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono text-xs"
                    />
                    <span className="bg-slate-800 border border-l-0 border-slate-700 px-3 py-2 rounded-r-lg text-slate-400 font-mono text-[11px]">
                      .localhost
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    Routes are accessible locally via http://{subdomain || 'app'}.localhost and over Tailscale mesh.
                  </span>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-medium">Target Upstream Port</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    placeholder="e.g. 3001 (Ownbase), 8080 (Storage), 7681 (Terminal)"
                    value={targetPort}
                    onChange={(e) => {
                      setTargetPort(e.target.value);
                      setFormError(null);
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono text-xs"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    Caddy automatically forwards incoming traffic to 127.0.0.1:{targetPort || '8080'}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="tlsEnabled"
                    checked={tlsEnabled}
                    onChange={(e) => setTlsEnabled(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                  />
                  <label htmlFor="tlsEnabled" className="text-slate-300 cursor-pointer select-none">
                    Enable automatic TLS encryption (HTTPS)
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      setFormError(null);
                    }}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-blue-600/20"
                  >
                    {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isSubmitting ? 'Registering with Caddy...' : 'Register Route'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
