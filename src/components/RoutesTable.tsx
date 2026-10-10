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
    if (!serviceId || !subdomain || !targetPort) return;

    setIsSubmitting(true);
    try {
      await onCreateRoute({
        serviceId,
        subdomain,
        targetPort: parseInt(targetPort, 10),
        tlsEnabled,
        customDomain: customDomain || undefined,
      });
      setIsModalOpen(false);
      setSubdomain('');
      setTargetPort('');
      setCustomDomain('');
    } catch (err) {
      console.error(err);
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

          <div className="flex items-center space-x-2">
            <button
              onClick={handleSync}
              disabled={isSyncing || !isCaddyActive}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
              title="Push all database routes to Caddy Admin API"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-blue-400' : ''}`} />
              <span>Sync Caddy</span>
            </button>

            <button
              onClick={() => {
                if (services.length > 0 && !serviceId) {
                  setServiceId(services[0].id);
                  if (services[0].port) setTargetPort(services[0].port.toString());
                }
                setIsModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Dynamic Route</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400 font-mono uppercase text-[10px]">
                <th className="pb-3 px-3">Subdomain Host</th>
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
                const isTesting = testingHost === host;
                const testRes = testResults[host];

                return (
                  <tr key={route.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-mono font-medium text-blue-300 flex items-center gap-1.5">
                        <span>{host}</span>
                        {route.customDomain && (
                          <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 rounded">
                            ({route.customDomain})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      {route.service?.name || 'Linked Service'}
                    </td>
                    <td className="py-3 px-3 font-mono text-indigo-400">
                      <div className="flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-slate-500" />
                        <span>{route.targetHost}:{route.targetPort}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {tailscaleStatus?.ip ? (
                        <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded border border-emerald-800/40">
                          http://{tailscaleStatus.ip}:{route.targetPort}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-[10px]">Connect Tailscale</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTestRoute(host)}
                          disabled={isTesting || !isCaddyActive}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] transition-colors disabled:opacity-40"
                          title="Send test HTTP request through Caddy proxy"
                        >
                          <Zap className={`w-3 h-3 ${isTesting ? 'animate-bounce text-yellow-400' : 'text-slate-400'}`} />
                          <span>{isTesting ? 'Pinging...' : 'Test'}</span>
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
            <div className="bg-[#0f172a] border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-sm font-semibold text-slate-100 mb-1">Add Dynamic Proxy Route</h3>
              <p className="text-xs text-slate-400 mb-4">
                Registers host mapping dynamically into Caddy REST API without server restart.
              </p>

              <form onSubmit={handleSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-300 mb-1">Target Native Service</label>
                  <select
                    required
                    value={serviceId}
                    onChange={(e) => {
                      setServiceId(e.target.value);
                      const s = services.find((x) => x.id === e.target.value);
                      if (s && s.port) {
                        setTargetPort(s.port.toString());
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="" disabled>Select target service...</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.executable} {s.port ? `:${s.port}` : ''})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1">Subdomain Prefix</label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      required
                      placeholder="e.g. files, ai, storage"
                      value={subdomain}
                      onChange={(e) => setSubdomain(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-l-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <span className="bg-slate-800 border border-l-0 border-slate-700 px-3 py-1.5 rounded-r-lg text-slate-400 font-mono text-[11px]">
                      .localhost
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1">Target Upstream Port</label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. 8080"
                    value={targetPort}
                    onChange={(e) => setTargetPort(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1">Custom Domain (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. hub.mydomain.com"
                    value={customDomain}
                    onChange={(e) => setCustomDomain(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="tlsEnabled"
                    checked={tlsEnabled}
                    onChange={(e) => setTlsEnabled(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                  />
                  <label htmlFor="tlsEnabled" className="text-slate-300 cursor-pointer">
                    Enable automatic TLS encryption
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
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? 'Registering with Caddy...' : 'Register Route'}
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
