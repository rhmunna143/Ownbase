'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HardDrive,
  Cpu,
  Database,
  Globe,
  Radio,
  Send,
  RefreshCw,
  Bell,
  ShieldAlert,
} from 'lucide-react';
import { fetchWithAuth } from '@/shared/apiClient';

interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  latencyMs?: number;
  details?: Record<string, any>;
}

interface SystemHealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  components: {
    postgres: ComponentHealth;
    caddy: ComponentHealth;
    supervisor: ComponentHealth;
    storage: ComponentHealth;
    tailscale: ComponentHealth;
  };
}

interface MetricSample {
  timestamp: string;
  cpu: {
    systemUsagePct: number;
    daemonUsagePct: number;
    cores: number;
  };
  memory: {
    daemonRssMb: number;
    daemonHeapUsedMb: number;
    systemTotalMb: number;
    systemFreeMb: number;
    systemUsagePct: number;
  };
  storage: {
    volumes: Array<{
      driveLetter: string;
      totalGb: number;
      freeGb: number;
      usedPct: number;
    }>;
  };
}

interface AlertItem {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  resolved: boolean;
  createdAt: string;
}

export function ObservabilityCard() {
  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [metrics, setMetrics] = useState<{ latest?: MetricSample; history: MetricSample[] }>({ history: [] });
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [webhookTesting, setWebhookTesting] = useState<boolean>(false);
  const [webhookResult, setWebhookResult] = useState<{ success: boolean; msg: string } | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [healthRes, metricsRes, alertsRes] = await Promise.all([
        fetchWithAuth('/api/v1/system/health').then((r) => (r.ok ? r.json() : null)),
        fetchWithAuth('/api/v1/system/metrics').then((r) => (r.ok ? r.json() : null)),
        fetchWithAuth('/api/v1/alerts').then((r) => (r.ok ? r.json() : null)),
      ]);

      if (healthRes) setHealth(healthRes);
      if (metricsRes) setMetrics(metricsRes);
      if (alertsRes?.activeAlerts) setAlerts(alertsRes.activeAlerts);
    } catch {}
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleResolveAlert = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/alerts/${id}/resolve`, { method: 'POST' });
      if (res.ok) {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }
    } catch {}
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl) return;
    setWebhookTesting(true);
    setWebhookResult(null);
    try {
      const res = await fetchWithAuth('/api/v1/alerts/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setWebhookResult({ success: true, msg: 'Test webhook delivered successfully!' });
      } else {
        setWebhookResult({ success: false, msg: 'Failed to deliver webhook payload.' });
      }
    } catch (err: any) {
      setWebhookResult({ success: false, msg: err.message });
    }
    setWebhookTesting(false);
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'healthy':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
          </span>
        );
      case 'degraded':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> Degraded
          </span>
        );
      case 'unhealthy':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" /> Unhealthy
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
            <Activity className="w-3.5 h-3.5" /> Unknown
          </span>
        );
    }
  };

  const latest = metrics.latest;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">System Observability & Metrics</h2>
              {getStatusBadge(health?.overall)}
            </div>
            <p className="text-sm text-slate-400">
              Live per-component telemetry, Win32 Job Object resource consumption, and alert dispatching
            </p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700/60 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Active Alerts Banner */}
      {alerts.length > 0 && (
        <div className="p-5 rounded-2xl bg-rose-950/20 border border-rose-900/40 space-y-3">
          <div className="flex items-center gap-2 text-rose-400 font-semibold">
            <ShieldAlert className="w-5 h-5" />
            <span>Active System Alerts ({alerts.length})</span>
          </div>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-rose-900/30 text-sm"
              >
                <div>
                  <div className="font-semibold text-rose-300">{alert.title}</div>
                  <div className="text-xs text-slate-400">{alert.message}</div>
                </div>
                <button
                  onClick={() => handleResolveAlert(alert.id)}
                  className="px-3 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Components Health Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* PostgreSQL */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <Database className="w-4 h-4 text-sky-400" />
              <span>PostgreSQL Database</span>
            </div>
            {getStatusBadge(health?.components.postgres.status)}
          </div>
          <p className="text-xs text-slate-400">{health?.components.postgres.message || 'Connecting...'}</p>
          {health?.components.postgres.latencyMs !== undefined && (
            <div className="text-xs text-slate-500 font-mono">
              Latency: {health.components.postgres.latencyMs}ms
            </div>
          )}
        </div>

        {/* Caddy Proxy */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <Globe className="w-4 h-4 text-emerald-400" />
              <span>Caddy Ingress</span>
            </div>
            {getStatusBadge(health?.components.caddy.status)}
          </div>
          <p className="text-xs text-slate-400">{health?.components.caddy.message || 'Probing port 80...'}</p>
        </div>

        {/* Supervisor */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <Radio className="w-4 h-4 text-indigo-400" />
              <span>Supervisor Workloads</span>
            </div>
            {getStatusBadge(health?.components.supervisor.status)}
          </div>
          <p className="text-xs text-slate-400">{health?.components.supervisor.message || 'Supervising...'}</p>
        </div>

        {/* Storage */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <HardDrive className="w-4 h-4 text-amber-400" />
              <span>Storage Volumes</span>
            </div>
            {getStatusBadge(health?.components.storage.status)}
          </div>
          <p className="text-xs text-slate-400">{health?.components.storage.message || 'Scanning volumes...'}</p>
        </div>

        {/* Tailscale */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <Globe className="w-4 h-4 text-purple-400" />
              <span>Tailscale Mesh</span>
            </div>
            {getStatusBadge(health?.components.tailscale.status)}
          </div>
          <p className="text-xs text-slate-400">{health?.components.tailscale.message || 'Checking status...'}</p>
        </div>
      </div>

      {/* Live Resource Telemetry Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* CPU */}
        <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <Cpu className="w-5 h-5 text-indigo-400" />
              <span>CPU Utilization</span>
            </div>
            <span className="text-lg font-bold text-white font-mono">{latest?.cpu.systemUsagePct || 0}%</span>
          </div>
          <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, latest?.cpu.systemUsagePct || 0)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Daemon: {latest?.cpu.daemonUsagePct || 0}%</span>
            <span>Cores: {latest?.cpu.cores || 1}</span>
          </div>
        </div>

        {/* RAM */}
        <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <Activity className="w-5 h-5 text-sky-400" />
              <span>System Memory</span>
            </div>
            <span className="text-lg font-bold text-white font-mono">{latest?.memory.systemUsagePct || 0}%</span>
          </div>
          <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-sky-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, latest?.memory.systemUsagePct || 0)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Daemon RSS: {latest?.memory.daemonRssMb || 0} MB</span>
            <span>Free: {latest?.memory.systemFreeMb || 0} MB</span>
          </div>
        </div>

        {/* Storage */}
        <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <HardDrive className="w-5 h-5 text-amber-400" />
              <span>Volume Utilization</span>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              {latest?.storage.volumes.length || 0} Volume(s)
            </span>
          </div>
          {latest?.storage.volumes.map((vol) => (
            <div key={vol.driveLetter} className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Volume {vol.driveLetter}</span>
                <span>{vol.freeGb} GB free ({vol.usedPct}% used)</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    vol.usedPct >= 90 ? 'bg-rose-500' : vol.usedPct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, vol.usedPct)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Webhook Configuration & Dispatcher */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-4">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <Bell className="w-5 h-5 text-indigo-400" />
          <span>Alert Webhook Dispatcher</span>
        </div>
        <p className="text-xs text-slate-400">
          Configure an outbound HTTPS webhook endpoint to receive real-time notifications for critical system alerts (e.g. Discord, Slack, PagerDuty).
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            placeholder="https://webhook.site/your-unique-id or Slack/Discord webhook URL"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleTestWebhook}
            disabled={!webhookUrl || webhookTesting}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {webhookTesting ? 'Sending...' : 'Test Webhook'}
          </button>
        </div>
        {webhookResult && (
          <div
            className={`p-3 rounded-xl text-xs font-medium border ${
              webhookResult.success
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}
          >
            {webhookResult.msg}
          </div>
        )}
      </div>
    </div>
  );
}
