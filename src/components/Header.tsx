'use client';

import React from 'react';
import { Server, Cpu, HardDrive, RefreshCw, Wifi, Menu } from 'lucide-react';
import { SystemInfo } from '@/shared/types';

interface HeaderProps {
  systemInfo: SystemInfo | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onToggleMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  systemInfo,
  onRefresh,
  isRefreshing,
  onToggleMobileMenu,
}) => {
  return (
    <header className="border-b border-slate-800/80 bg-[#0b0f19]/90 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* Left: Mobile Menu Toggle + Branding */}
        <div className="flex items-center space-x-2.5 sm:space-x-3.5 min-w-0">
          {onToggleMobileMenu && (
            <button
              onClick={onToggleMobileMenu}
              className="md:hidden p-2 rounded-xl bg-slate-800/80 hover:bg-slate-750 text-slate-300 border border-slate-700/80 touch-manipulation min-h-[40px] min-w-[40px] flex items-center justify-center"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 p-[1px] shadow-lg shadow-blue-500/20 shrink-0">
            <div className="w-full h-full bg-[#0d121f] rounded-[11px] flex items-center justify-center">
              <Server className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white truncate">
                Windows Hub
              </h1>
              <span className="text-[9px] sm:text-[10px] font-mono px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 shrink-0">
                24/7 Engine
              </span>
            </div>
            <p className="text-[10px] sm:text-xs text-slate-400 flex items-center gap-1 mt-0.5 truncate">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 live-indicator-active shrink-0" />
              <span className="text-emerald-400 font-medium">Native Mode</span>
              <span className="text-slate-600">•</span>
              <span className="truncate">No Docker / No WSL2</span>
            </p>
          </div>
        </div>

        {/* Right: System Specs & Refresh */}
        <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-slate-200 transition-colors shadow-sm disabled:opacity-50 min-h-[38px] touch-manipulation"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
        </div>
      </div>
    </header>
  );
};
