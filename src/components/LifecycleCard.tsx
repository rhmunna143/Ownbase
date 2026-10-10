'use client';

import React, { useState } from 'react';
import {
  Shield,
  Zap,
  Power,
  Minimize2,
  Clock,
  Laptop,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  LogOut,
  Loader2,
} from 'lucide-react';
import { LifecycleStatus } from '@/shared/types';

interface LifecycleCardProps {
  lifecycleStatus: LifecycleStatus | null;
  onToggleAutoStart: (enabled: boolean) => Promise<void>;
  onTogglePowerBlocker: (enabled: boolean) => Promise<void>;
  onMinimizeToTray: () => Promise<void>;
  onQuitApp: () => Promise<void>;
  isLoading?: boolean;
}

export const LifecycleCard: React.FC<LifecycleCardProps> = ({
  lifecycleStatus,
  onToggleAutoStart,
  onTogglePowerBlocker,
  onMinimizeToTray,
  onQuitApp,
  isLoading = false,
}) => {
  const [isUpdatingAutoStart, setIsUpdatingAutoStart] = useState(false);
  const [isUpdatingPower, setIsUpdatingPower] = useState(false);

  const isPowerActive = lifecycleStatus?.powerBlocker.active ?? true;
  const isAutoStartEnabled = lifecycleStatus?.autoStart.enabled ?? false;

  const handleToggleAutoStart = async () => {
    setIsUpdatingAutoStart(true);
    try {
      await onToggleAutoStart(!isAutoStartEnabled);
    } finally {
      setIsUpdatingAutoStart(false);
    }
  };

  const handleTogglePower = async () => {
    setIsUpdatingPower(true);
    try {
      await onTogglePowerBlocker(!isPowerActive);
    } finally {
      setIsUpdatingPower(false);
    }
  };

  return (
    <div className="glass-card rounded-xl p-5 border border-slate-800 space-y-5">
      <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Clock className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              24/7 Server Persistence &amp; Windows Lifecycle
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                Always-On Engine
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Continuous background daemon execution with system tray minimization and Windows sleep overrides.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onMinimizeToTray}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800 transition-colors"
            title="Minimize to Windows System Tray (processes remain running)"
          >
            <Minimize2 className="w-3.5 h-3.5 text-blue-400" />
            <span>Minimize to Tray</span>
          </button>

          <button
            onClick={onQuitApp}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-900/60 bg-rose-950/30 text-rose-300 hover:bg-rose-900/50 transition-colors"
            title="Cleanly terminate all background services and exit"
          >
            <LogOut className="w-3.5 h-3.5 text-rose-400" />
            <span>Quit Server</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CARD 1: Power Save Blocker */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Power State Override</span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  isPowerActive
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                }`}
              >
                {isPowerActive ? 'Suspension Blocked' : 'Normal Power'}
              </span>
            </div>

            <div className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>prevent-app-suspension</span>
            </div>

            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              Blocks Windows 11 CPU throttling, network adapter sleep, and process suspension when idle or laptop lid closed.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-300 font-medium">Keep Server Awake</span>
            <button
              onClick={handleTogglePower}
              disabled={isUpdatingPower}
              className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-md transition-colors ${
                isPowerActive
                  ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
              }`}
            >
              {isUpdatingPower ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isPowerActive ? (
                <ToggleRight className="w-4 h-4 text-emerald-400" />
              ) : (
                <ToggleLeft className="w-4 h-4 text-slate-400" />
              )}
              <span>{isPowerActive ? 'Active' : 'Disabled'}</span>
            </button>
          </div>
        </div>

        {/* CARD 2: Windows Startup Registry */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Windows Boot Registry</span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  isAutoStartEnabled
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {isAutoStartEnabled ? 'Auto-Start On' : 'Manual Launch'}
              </span>
            </div>

            <div className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
              <Laptop className="w-4 h-4 text-blue-400" />
              <span>app.setLoginItemSettings</span>
            </div>

            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              Registers application in Windows registry to launch automatically and hidden in system tray on OS boot.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-300 font-medium">Launch at Boot</span>
            <button
              onClick={handleToggleAutoStart}
              disabled={isUpdatingAutoStart}
              className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-md transition-colors ${
                isAutoStartEnabled
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
              }`}
            >
              {isUpdatingAutoStart ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isAutoStartEnabled ? (
                <ToggleRight className="w-4 h-4 text-blue-400" />
              ) : (
                <ToggleLeft className="w-4 h-4 text-slate-400" />
              )}
              <span>{isAutoStartEnabled ? 'Enabled' : 'Disabled'}</span>
            </button>
          </div>
        </div>

        {/* CARD 3: System Tray Interception */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Tray Interception</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                Tray Active
              </span>
            </div>

            <div className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-indigo-400" />
              <span>Window Close Intercept</span>
            </div>

            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              Closing window hides the UI rather than killing processes. Restore anytime by clicking the taskbar tray icon.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-400 font-mono text-[11px]">Click tray to toggle</span>
            <button
              onClick={onMinimizeToTray}
              className="px-2.5 py-1 text-xs rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium transition-colors"
            >
              Hide Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
