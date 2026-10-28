'use client';

import React, { useState } from 'react';
import {
  X,
  Server,
  Code,
  Globe,
  ExternalLink,
  Copy,
  Check,
  Shield,
  Database,
  Cpu,
  Layers,
  Heart,
  Github,
  Mail,
  FileText
} from 'lucide-react';
import { SystemInfo } from '@/shared/types';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemInfo: SystemInfo | null;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose, systemInfo }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const appVersion = systemInfo?.appVersion || '0.1.0';
  const platform = systemInfo ? `${systemInfo.platform} (${systemInfo.arch})` : 'Windows x64';

  const handleCopyDiagnostics = () => {
    const diag = [
      `Ownbase Desktop Hub v${appVersion}`,
      `Platform: ${platform}`,
      `OS Release: ${systemInfo?.release || 'unknown'}`,
      `Node Runtime: ${systemInfo?.nodeVersion || 'v20.x'}`,
      `LAN IPv4: ${systemInfo?.localIp || '127.0.0.1'}`,
      `Tailscale Mesh IP: ${systemInfo?.tailscaleIp || 'Not Connected'}`,
      `Data Directory: ${systemInfo?.appDataDir || 'Default ProgramData/AppData'}`,
      `License: MIT`,
      `Developer: rhmunna143 (rhmunna19@gmail.com)`,
      `Repository: https://github.com/rhmunna143/ownbase`
    ].join('\n');

    navigator.clipboard.writeText(diag);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-[#0b0f19] border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-200 animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
      >
        {/* Header with App Banner */}
        <div className="relative p-6 bg-gradient-to-br from-blue-900/40 via-indigo-900/30 to-purple-900/20 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-[1px] shadow-xl shadow-blue-600/30">
              <div className="w-full h-full bg-[#0d121f] rounded-[15px] flex items-center justify-center">
                <Server className="w-7 h-7 text-blue-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="about-modal-title" className="text-xl font-bold text-white tracking-tight">
                  Ownbase
                </h2>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  v{appVersion}
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Production
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Native Windows Server Orchestration Platform (No Docker / No WSL2)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            aria-label="Close About Dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto text-xs leading-relaxed">
          {/* Product Summary */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              <span>About Software</span>
            </h3>
            <p className="text-slate-400 text-xs">
              Ownbase turns any Windows 10/11 machine into a resilient bare-metal cloud server.
              Featuring an embedded PostgreSQL database, Caddy edge reverse proxy, WireGuard Tailscale mesh networking,
              and native Windows service persistence, Ownbase delivers VPS functionality with zero Docker overhead.
            </p>
          </div>

          {/* Developer Information */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-indigo-400" />
              <span>Developer & Maintainer</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Author:</span>
                <span className="font-semibold text-white">rhmunna143</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <a href="mailto:rhmunna19@gmail.com" className="text-blue-400 hover:underline">
                  rhmunna19@gmail.com
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Github className="w-3.5 h-3.5 text-slate-500" />
                <a
                  href="https://github.com/rhmunna143/ownbase"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:underline flex items-center gap-1"
                >
                  github.com/rhmunna143/ownbase
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-slate-500" />
                <a
                  href="https://rhmunna143.github.io/ownbase/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:underline flex items-center gap-1"
                >
                  GitHub Pages Docs
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>

          {/* System & Runtime Environment */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>System & Runtime Environment</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="text-[10px] text-slate-500">Platform</div>
                <div className="font-mono text-slate-200 mt-0.5">{platform}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="text-[10px] text-slate-500">Node Engine</div>
                <div className="font-mono text-slate-200 mt-0.5">{systemInfo?.nodeVersion || 'v20.x'}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="text-[10px] text-slate-500">PostgreSQL</div>
                <div className="font-mono text-emerald-400 mt-0.5">16.4 (Port 5432)</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="text-[10px] text-slate-500">Reverse Proxy</div>
                <div className="font-mono text-indigo-400 mt-0.5">Caddy v2.8 (Port 80)</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="text-[10px] text-slate-500">Mesh VPN</div>
                <div className="font-mono text-blue-400 mt-0.5">Tailscale WireGuard</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="text-[10px] text-slate-500">License</div>
                <div className="font-mono text-purple-300 mt-0.5">MIT Open Source</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950/60 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={handleCopyDiagnostics}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            <span>{copied ? 'Copied Diagnostics!' : 'Copy System Info'}</span>
          </button>

          <div className="flex items-center space-x-2">
            <a
              href="https://rhmunna143.github.io/ownbase/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-blue-400" />
              <span>Docs</span>
            </a>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

