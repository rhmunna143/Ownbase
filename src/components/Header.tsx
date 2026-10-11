'use client';

import React from 'react';
import { Server, Cpu, Layers, HardDrive, RefreshCw, Wifi } from 'lucide-react';
import { SystemInfo } from '@/shared/types';

interface HeaderProps {
  systemInfo: SystemInfo | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({ systemInfo, onRefresh, isRefreshing }) => {
  return (
    <header className="border-b border-slate-800/80 bg-[#0b0f19]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5">
      <div className="flex items-center justify-between">
        {/* Left: Branding & Core Mode */}
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 p-[1px] shadow-lg shadow-blue-500/20">
            <div className="w-full h-full bg-[#0d121f] rounded-[11px] flex items-center justify-center">
              <Server className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
                Native Windows Server Hub
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  v0.1.0 • Phase 1
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 live-indicator-active" />
              <span>Native Windows Runtime</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">Zero Virtualization (No Docker / No WSL2)</span>
            </p>
          </div>
        </div>

        {/* Right: System Specs & Refresh */}
        <div className="flex items-center space-x-3">
          {systemInfo && (
            <div className="hidden lg:flex items-center space-x-2 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-mono text-slate-200">
                  {systemInfo.platform} ({systemInfo.arch})
                </span>
              </div>
              <span className="text-slate-700">|</span>
              <div className="flex items-center gap-1.5 text-slate-400">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  RAM: <span className="font-mono text-slate-200">{Math.round((systemInfo.totalMemoryMb - systemInfo.freeMemoryMb) / 1024)}G / {Math.round(systemInfo.totalMemoryMb / 1024)}G</span>
                </span>
              </div>
              <span className="text-slate-700">|</span>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Wifi className="w-3.5 h-3.5 text-blue-400" />
                <span>LAN: <span className="font-mono text-emerald-300 font-semibold">{systemInfo.localIp || '127.0.0.1'}</span></span>
              </div>
            </div>
          )}

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-slate-200 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>
    </header>
  );
};
