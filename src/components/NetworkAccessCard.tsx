'use client';

import React, { useState } from 'react';
import {
  Wifi,
  Globe,
  Smartphone,
  Laptop,
  ShieldAlert,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Key,
  Loader2,
  Lock,
  HardDrive,
  Bot,
  Database,
} from 'lucide-react';
import { TailscaleStatus, SystemInfo } from '@/shared/types';

interface NetworkAccessProps {
  systemInfo: SystemInfo | null;
  tailscaleStatus: TailscaleStatus | null;
  onConnectTailscale: (authKey: string, hostname?: string) => Promise<void>;
  onDisconnectTailscale: () => Promise<void>;
}

export const NetworkAccessCard: React.FC<NetworkAccessProps> = ({
  systemInfo,
  tailscaleStatus,
  onConnectTailscale,
  onDisconnectTailscale,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [authKey, setAuthKey] = useState('');
  const [hostname, setHostname] = useState('native-windows-server');
  const [isConnecting, setIsConnecting] = useState(false);

  const localIp = systemInfo?.localIp || '192.168.0.108';
  const tailscaleIp = systemInfo?.tailscaleIp || tailscaleStatus?.ip || systemInfo?.allIps?.find((ip) => ip.startsWith('100.')) || '100.84.32.40';
  const hasTailscale = !!tailscaleIp || !!tailscaleStatus?.connected;

  const firewallCmd = `New-NetFirewallRule -DisplayName "Windows Server Hub" -Direction Inbound -LocalPort 80,443,2019,3000,3001,8080,9000,11434,5432 -Protocol TCP -Action Allow`;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authKey) return;
    setIsConnecting(true);
    try {
      await onConnectTailscale(authKey, hostname);
      setAuthKey('');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Local Network / Wi-Fi Access */}
      <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Wifi className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  Local Network Access (Wi-Fi / LAN)
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    Active
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Connect from your phone, tablet, or laptop on the same Wi-Fi.
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-mono uppercase text-slate-500">Wi-Fi LAN IP</span>
              <div className="text-sm font-bold font-mono text-emerald-400">{localIp}</div>
            </div>
          </div>

          {/* Quick Wi-Fi Mobile Links */}
          <div className="space-y-2 text-xs">
            {/* Server Gateway Hub */}
            <div className="p-2.5 rounded-xl bg-blue-950/20 border border-blue-500/30 flex items-center justify-between">
              <div>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Laptop className="w-3.5 h-3.5 text-blue-400" />
                  <span>Server Gateway Hub Dashboard</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300">Port 80</span>
                </div>
                <div className="text-[11px] font-mono text-blue-300/90 mt-0.5">
                  http://{localIp}/
                </div>
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => copyToClipboard(`http://${localIp}/`, 'hub-local')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="Copy URL"
                >
                  {copiedKey === 'hub-local' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a
                  href={`http://${localIp}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 border border-blue-500/40"
                  title="Open Dashboard"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* FileBrowser Cloud Drive */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                  <span>FileBrowser Cloud Drive</span>
                </div>
                <div className="text-[11px] font-mono text-emerald-400/90 mt-0.5">
                  http://files.{localIp}.nip.io <span className="text-slate-500">or :{localIp}:8080</span>
                </div>
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => copyToClipboard(`http://files.${localIp}.nip.io`, 'files-local')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="Copy URL"
                >
                  {copiedKey === 'files-local' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a
                  href={`http://files.${localIp}.nip.io`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30"
                  title="Open Storage"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* AI Hub */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-purple-400" />
                  <span>Hermes 3 AI Chat Hub</span>
                </div>
                <div className="text-[11px] font-mono text-purple-300/90 mt-0.5">
                  http://ai.{localIp}.nip.io <span className="text-slate-500">or :{localIp}:11434</span>
                </div>
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => copyToClipboard(`http://ai.${localIp}.nip.io`, 'ai-local')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="Copy URL"
                >
                  {copiedKey === 'ai-local' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a
                  href={`http://ai.${localIp}.nip.io`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-500/30"
                  title="Open AI Hub"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* MinIO S3 */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-rose-400" />
                  <span>MinIO S3 Object Storage</span>
                </div>
                <div className="text-[11px] font-mono text-rose-300/90 mt-0.5">
                  http://s3.{localIp}.nip.io <span className="text-slate-500">or :{localIp}:9000</span>
                </div>
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => copyToClipboard(`http://s3.${localIp}.nip.io`, 's3-local')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="Copy URL"
                >
                  {copiedKey === 's3-local' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a
                  href={`http://s3.${localIp}.nip.io`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 border border-rose-500/30"
                  title="Open S3 Console"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Windows Firewall Helper */}
        <div className="mt-3 pt-3 border-t border-slate-800/80">
          <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-600/30 text-xs">
            <div className="flex items-center justify-between text-amber-300 font-semibold mb-1">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                Windows Firewall Status
              </span>
              <button
                onClick={() => copyToClipboard(firewallCmd, 'fw-cmd')}
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-900/40 hover:bg-amber-800/60 text-amber-200 border border-amber-700/50"
              >
                {copiedKey === 'fw-cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>Copy Inbound Rule</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Inbound ports 80, 8080, 9000, 11434, 3000 are unblocked. Devices on your Wi-Fi can directly reach port 80.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Tailscale Mesh VPN (Internet / Remote Access from Anywhere) */}
      <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  Remote Access Anywhere (Tailscale VPN)
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      hasTailscale
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {hasTailscale ? 'Mesh Active' : 'Offline'}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Secure WireGuard overlay mesh network allowing access from any internet connection.
                </p>
              </div>
            </div>

            {tailscaleIp && (
              <div className="text-right">
                <span className="text-[10px] font-mono uppercase text-slate-500">Mesh IP</span>
                <div className="text-sm font-bold font-mono text-purple-400">{tailscaleIp}</div>
              </div>
            )}
          </div>

          {hasTailscale ? (
            <div className="space-y-2 text-xs">
              {/* Server Gateway Hub over Tailscale */}
              <div className="p-2.5 rounded-xl bg-purple-950/20 border border-purple-500/30 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Laptop className="w-3.5 h-3.5 text-purple-400" />
                    <span>Remote Server Gateway Hub</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300">Anywhere</span>
                  </div>
                  <div className="text-[11px] font-mono text-purple-300/90 mt-0.5">
                    http://{tailscaleIp}/
                  </div>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => copyToClipboard(`http://${tailscaleIp}/`, 'hub-ts')}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Copy URL"
                  >
                    {copiedKey === 'hub-ts' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`http://${tailscaleIp}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 border border-purple-500/40"
                    title="Open Dashboard"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* FileBrowser over Tailscale */}
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                    <span>FileBrowser Storage (Remote)</span>
                  </div>
                  <div className="text-[11px] font-mono text-emerald-400/90 mt-0.5">
                    http://files.{tailscaleIp}.nip.io
                  </div>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => copyToClipboard(`http://files.${tailscaleIp}.nip.io`, 'files-ts')}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Copy URL"
                  >
                    {copiedKey === 'files-ts' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`http://files.${tailscaleIp}.nip.io`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30"
                    title="Open URL"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* AI Hub over Tailscale */}
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5 text-purple-400" />
                    <span>Hermes 3 AI Chat (Remote)</span>
                  </div>
                  <div className="text-[11px] font-mono text-purple-300/90 mt-0.5">
                    http://ai.{tailscaleIp}.nip.io
                  </div>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => copyToClipboard(`http://ai.${tailscaleIp}.nip.io`, 'ai-ts')}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Copy URL"
                  >
                    {copiedKey === 'ai-ts' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`http://ai.${tailscaleIp}.nip.io`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-500/30"
                    title="Open URL"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* MinIO over Tailscale */}
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-rose-400" />
                    <span>MinIO S3 Console (Remote)</span>
                  </div>
                  <div className="text-[11px] font-mono text-rose-300/90 mt-0.5">
                    http://s3.{tailscaleIp}.nip.io
                  </div>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => copyToClipboard(`http://s3.${tailscaleIp}.nip.io`, 's3-ts')}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Copy URL"
                  >
                    {copiedKey === 's3-ts' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`http://s3.${tailscaleIp}.nip.io`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 border border-rose-500/30"
                    title="Open URL"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleConnect} className="space-y-3.5 text-xs">
              <p className="text-slate-400 text-[11px] leading-relaxed">
                Connect your server to Tailscale to access the dashboard and services from anywhere without router port forwarding.
              </p>

              <div>
                <label className="block text-slate-300 mb-1 font-medium flex items-center justify-between">
                  <span>Tailscale Auth Key</span>
                  <a
                    href="https://login.tailscale.com/admin/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline text-[10px] flex items-center gap-1"
                  >
                    <span>Generate at tailscale.com</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    placeholder="tskey-auth-kXXXXXX..."
                    value={authKey}
                    onChange={(e) => setAuthKey(e.target.value)}
                    className="w-full bg-black/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Device Hostname</label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  className="w-full bg-black/60 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">
                  CLI: <code>winget install Tailscale.Tailscale</code>
                </span>

                <button
                  type="submit"
                  disabled={isConnecting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-md shadow-purple-600/20 transition-all disabled:opacity-50"
                >
                  {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  <span>Connect to Tailscale</span>
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <span>WireGuard Mesh IP: <code className="text-purple-300 font-mono">{tailscaleIp}</code></span>
          {hasTailscale && (
            <button
              onClick={onDisconnectTailscale}
              className="px-2 py-0.5 rounded text-[10px] bg-rose-950/40 text-rose-300 border border-rose-800/40 hover:bg-rose-900/60"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
