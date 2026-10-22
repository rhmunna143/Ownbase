'use client';

import React from 'react';
import { Server, Cpu, HardDrive, RefreshCw, Wifi, Menu, User, LogOut, LogIn, ChevronRight } from 'lucide-react';
import { SystemInfo } from '@/shared/types';

interface HeaderProps {
  systemInfo: SystemInfo | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onToggleMobileMenu?: () => void;
  currentUser?: { username: string; role: string } | null;
  onLoginClick?: () => void;
  onLogoutClick?: () => void;
  activeTab?: string;
}

const TAB_LABELS: Record<string, string> = {
  overview: 'Dashboard',
  files: 'File Explorer',
  photos: 'Photos & Memories',
  apidocs: 'API Docs & Explorer',
  services: 'Installed Services',
  store: '1-Click App Store',
  routes: 'Websites & Ingress',
  observability: 'Metrics & Health',
  terminal: 'PowerShell Terminal',
  logs: 'System Logs',
  security: 'Security & Audit',
  backups: 'Backups & Recovery',
  settings: 'Daemon Settings',
};

export const Header: React.FC<HeaderProps> = ({
  systemInfo,
  onRefresh,
  isRefreshing,
  onToggleMobileMenu,
  currentUser,
  onLoginClick,
  onLogoutClick,
  activeTab = 'overview',
}) => {
  return (
    <header className="border-b border-slate-800/80 bg-[#0b0f19]/90 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* Left: Mobile Toggle / Mobile Brand / Desktop Breadcrumb */}
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

          {/* Mobile Only: Show compact brand since desktop sidebar is hidden */}
          <div className="flex md:hidden items-center space-x-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-[1px] shadow-sm shrink-0">
              <div className="w-full h-full bg-[#0d121f] rounded-[7px] flex items-center justify-center">
                <Server className="w-3.5 h-3.5 text-blue-400" />
              </div>
            </div>
            <span className="text-xs font-bold text-white tracking-tight truncate">Ownbase</span>
          </div>

          {/* Desktop Breadcrumb Navigation: Replaces redundant logo on desktop */}
          <div className="hidden md:flex items-center space-x-2 text-xs">
            <span className="text-slate-400 font-medium">Server</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span className="text-white font-semibold tracking-wide">
              {TAB_LABELS[activeTab] || 'Dashboard'}
            </span>
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

          {currentUser ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs">
                <User className="w-3.5 h-3.5 text-purple-400" />
                <span className="font-semibold text-white">{currentUser.username}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30">
                  {currentUser.role}
                </span>
              </div>
              {onLogoutClick && (
                <button
                  onClick={onLogoutClick}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/80 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            onLoginClick && (
              <button
                onClick={onLoginClick}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-sm shadow-purple-600/30 transition-all min-h-[38px]"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
};
