'use client';

import React, { useState } from 'react';
import { Layers, Plus, Terminal, Play, Square, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { ServiceRecord } from '@/shared/types';

interface ServicesTableProps {
  services: ServiceRecord[];
  onCreateService: (data: {
    name: string;
    type: string;
    executable: string;
    port?: number;
    description?: string;
    autoStart?: boolean;
  }) => Promise<void>;
  isLoading: boolean;
}

export const ServicesTable: React.FC<ServicesTableProps> = ({
  services,
  onCreateService,
  isLoading,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('custom');
  const [executable, setExecutable] = useState('');
  const [port, setPort] = useState<string>('');
  const [description, setDescription] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Registered Native Services
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {services.length} records in PostgreSQL
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Service process manifests managed through Prisma ORM (prepared for Phase 2 ProcessSupervisor)
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Register Service</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800/80 text-slate-400 font-mono uppercase text-[10px]">
              <th className="pb-3 px-3">Service Name</th>
              <th className="pb-3 px-3">Type</th>
              <th className="pb-3 px-3">Windows Executable</th>
              <th className="pb-3 px-3">Assigned Port</th>
              <th className="pb-3 px-3">Supervisor Status</th>
              <th className="pb-3 px-3">Auto Start</th>
              <th className="pb-3 px-3">Routes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {services.map((service) => (
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
                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                      service.status === 'running'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        service.status === 'running' ? 'bg-emerald-400' : 'bg-slate-500'
                      }`}
                    />
                    <span className="capitalize">{service.status}</span>
                  </span>
                </td>
                <td className="py-3 px-3">
                  <span className="text-[11px] font-mono text-slate-400">
                    {service.autoStart ? 'Yes (Boot)' : 'Manual'}
                  </span>
                </td>
                <td className="py-3 px-3">
                  <span className="text-[11px] font-mono text-slate-300">
                    {service.routes?.length || 0} configured
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {services.length === 0 && !isLoading && (
          <div className="text-center py-8 text-slate-500 text-xs">
            No services registered yet. Click &quot;Register Service&quot; above to add your first process.
          </div>
        )}
      </div>

      {/* Modal for adding service */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100 mb-1">Register New Native Service</h3>
            <p className="text-xs text-slate-400 mb-4">
              Persist service execution parameters into PostgreSQL via Prisma ORM.
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
                  placeholder="e.g. caddy.exe or node.exe"
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
                  {isSubmitting ? 'Saving to Postgres...' : 'Save Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
