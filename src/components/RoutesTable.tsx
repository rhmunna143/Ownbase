'use client';

import React, { useState } from 'react';
import { Globe, Plus, ArrowRight, Shield, ShieldCheck, Lock } from 'lucide-react';
import { RouteRecord, ServiceRecord } from '@/shared/types';

interface RoutesTableProps {
  routes: RouteRecord[];
  services: ServiceRecord[];
  onCreateRoute: (data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }) => Promise<void>;
  isLoading: boolean;
}

export const RoutesTable: React.FC<RoutesTableProps> = ({
  routes,
  services,
  onCreateRoute,
  isLoading,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [targetPort, setTargetPort] = useState('');
  const [tlsEnabled, setTlsEnabled] = useState(true);
  const [customDomain, setCustomDomain] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  return (
    <div className="glass-card rounded-xl p-5 border border-slate-800">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Globe className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Dynamic Proxy Routes
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {routes.length} records in PostgreSQL
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Routing topology managed via Prisma ORM (ready for Phase 3 dynamic Caddy admin API integration)
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            if (services.length > 0 && !serviceId) {
              setServiceId(services[0].id);
            }
            setIsModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Proxy Route</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800/80 text-slate-400 font-mono uppercase text-[10px]">
              <th className="pb-3 px-3">Subdomain Host</th>
              <th className="pb-3 px-3">Target Service</th>
              <th className="pb-3 px-3">Upstream Port</th>
              <th className="pb-3 px-3">Automatic TLS</th>
              <th className="pb-3 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {routes.map((route) => (
              <tr key={route.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="py-3 px-3">
                  <div className="font-mono font-medium text-indigo-300 flex items-center gap-1.5">
                    <span>{route.subdomain}.localhost</span>
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
                <td className="py-3 px-3 font-mono text-blue-400">
                  <div className="flex items-center gap-1">
                    <ArrowRight className="w-3 h-3 text-slate-500" />
                    <span>{route.targetHost}:{route.targetPort}</span>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 font-mono">
                    <Lock className="w-2.5 h-2.5" />
                    <span>Let&apos;s Encrypt / Local CA</span>
                  </span>
                </td>
                <td className="py-3 px-3">
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-indicator-active" />
                    <span>Active Route</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {routes.length === 0 && !isLoading && (
          <div className="text-center py-8 text-slate-500 text-xs">
            No routes mapped yet. Click &quot;Add Proxy Route&quot; to link a service.
          </div>
        )}
      </div>

      {/* Modal for adding route */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100 mb-1">Add Dynamic Proxy Route</h3>
            <p className="text-xs text-slate-400 mb-4">
              Map incoming domain traffic to a local service port.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">Linked Native Service</label>
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
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
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
                    placeholder="e.g. app, vault, api"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-l-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="bg-slate-800 border border-l-0 border-slate-700 px-3 py-1.5 rounded-r-lg text-slate-400 font-mono text-[11px]">
                    .serverhub
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
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Custom Domain (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. cloud.mydomain.com"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="tlsEnabled"
                  checked={tlsEnabled}
                  onChange={(e) => setTlsEnabled(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="tlsEnabled" className="text-slate-300 cursor-pointer">
                  Enable automatic local/global TLS encryption
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
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving Route...' : 'Save Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
