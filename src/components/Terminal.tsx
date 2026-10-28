'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  Terminal as TerminalIcon,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Trash2,
  Maximize2,
  Minimize2,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { authStore } from '../shared/apiClient';

interface TerminalProps {
  currentUser?: {
    id: string;
    username: string;
    role: string;
  } | null;
}

interface SessionInfo {
  id: string;
  actorName: string;
  actorRole: string;
  startedAt: string;
  clientIp: string;
}

export function Terminal({ currentUser }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const wsInstance = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'forbidden'>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<SessionInfo[]>([]);
  const [showSessionsList, setShowSessionsList] = useState(false);

  const isRoot = currentUser?.role === 'ROOT';

  const fetchActiveSessions = async () => {
    try {
      const token = authStore.getAccessToken();
      const res = await fetch('/api/v1/terminal/sessions', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setActiveSessions(data);
      }
    } catch {}
  };

  const connectTerminal = () => {
    if (!isRoot) {
      setStatus('forbidden');
      return;
    }

    if (!terminalRef.current) return;

    // Clean up any existing instances
    if (wsInstance.current) {
      wsInstance.current.close();
      wsInstance.current = null;
    }
    if (xtermInstance.current) {
      xtermInstance.current.dispose();
      xtermInstance.current = null;
    }

    setStatus('connecting');
    setErrorMessage(null);

    // Initialize XTerm
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Code", "Fira Code", monospace',
      lineHeight: 1.2,
      theme: {
        background: '#080c14',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#080c14',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#f8fafc',
        brightBlack: '#475569',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonInstance.current = fitAddon;

    // Connect WebSocket
    const token = authStore.getAccessToken();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/v1/terminal/ws?token=${encodeURIComponent(
      token || ''
    )}&cols=${term.cols}&rows=${term.rows}`;

    const ws = new WebSocket(wsUrl);
    wsInstance.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      fetchActiveSessions();
      term.focus();
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      setStatus('disconnected');
      setErrorMessage('WebSocket connection error');
    };

    ws.onclose = (event) => {
      setStatus('disconnected');
      if (event.code === 4403 || event.reason.includes('403') || event.code === 1008) {
        setStatus('forbidden');
        setErrorMessage('Terminal access forbidden: ROOT role required (403)');
      } else {
        term.write('\r\n\x1b[90m[Disconnected from Ownbase Terminal]\x1b[0m\r\n');
      }
      fetchActiveSessions();
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onResize((size) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });
  };

  useEffect(() => {
    if (isRoot) {
      connectTerminal();
      fetchActiveSessions();
    } else {
      setStatus('forbidden');
    }

    const handleWindowResize = () => {
      if (fitAddonInstance.current && xtermInstance.current) {
        try {
          fitAddonInstance.current.fit();
        } catch {}
      }
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (wsInstance.current) {
        wsInstance.current.close();
      }
      if (xtermInstance.current) {
        xtermInstance.current.dispose();
      }
    };
  }, [currentUser?.role, currentUser?.id]);

  const handleClear = () => {
    if (xtermInstance.current) {
      xtermInstance.current.clear();
    }
  };

  return (
    <div
      className={`flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl transition-all ${
        isFullscreen ? 'fixed inset-4 z-50' : 'h-[600px] w-full'
      }`}
    >
      {/* Terminal Title Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-slate-950 border-b border-slate-800 select-none gap-2">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex space-x-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full bg-red-500/80 border border-red-600/50" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80 border border-yellow-600/50" />
            <div className="w-3 h-3 rounded-full bg-green-500/80 border border-green-600/50" />
          </div>

          <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 min-w-0">
            <TerminalIcon className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="truncate">Ownbase Native ConPTY Terminal</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-950/80 border border-purple-700/50 text-purple-300 shrink-0">
              ROOT ONLY
            </span>
          </div>
        </div>

        {/* Controls and Status Indicator */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Sessions Counter */}
          <button
            onClick={() => {
              setShowSessionsList(!showSessionsList);
              fetchActiveSessions();
            }}
            className="flex items-center space-x-1.5 px-2 py-1 rounded text-xs bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/50 transition-colors"
            title="Active Terminal Sessions"
          >
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>{activeSessions.length} session{activeSessions.length === 1 ? '' : 's'}</span>
          </button>

          {/* Audit Badge */}
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-950/60 border border-cyan-800/50 text-cyan-300">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Audit Active</span>
          </div>

          {/* Connection Status Badge */}
          <div className="flex items-center space-x-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                status === 'connected'
                  ? 'bg-green-400 animate-pulse'
                  : status === 'connecting'
                  ? 'bg-yellow-400 animate-ping'
                  : 'bg-red-400'
              }`}
            />
            <span className="text-slate-400 capitalize">{status}</span>
          </div>

          {/* Actions */}
          <button
            onClick={connectTerminal}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Reconnect"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleClear}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Clear Terminal"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setIsFullscreen(!isFullscreen);
              setTimeout(() => {
                if (fitAddonInstance.current) fitAddonInstance.current.fit();
              }, 150);
            }}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Concurrent Sessions Dropdown / Drawer */}
      {showSessionsList && (
        <div className="bg-slate-950/95 border-b border-slate-800 px-4 py-3 text-xs">
          <div className="font-semibold text-slate-300 mb-2 flex items-center justify-between">
            <span>Concurrent Audited Sessions (Max 5)</span>
            <span className="text-[11px] text-slate-500">Notice: Sessions shown to all administrators (PRD §6.5)</span>
          </div>
          {activeSessions.length === 0 ? (
            <p className="text-slate-500">No other active terminal sessions.</p>
          ) : (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {activeSessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-cyan-400">{s.id.slice(0, 12)}...</span>
                    <span className="text-slate-300 font-medium">{s.actorName}</span>
                    <span className="px-1 py-0.2 bg-purple-950 text-purple-300 rounded text-[10px]">
                      {s.actorRole}
                    </span>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    From {s.clientIp} • Started {new Date(s.startedAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Terminal Viewport */}
      <div className="relative flex-1 bg-[#080c14] overflow-hidden p-2">
        {status === 'forbidden' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-950 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-950/60 border border-red-800/60 flex items-center justify-center mb-4 text-red-400">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">ROOT Role Required</h3>
            <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
              Terminal execution operates with full service account privileges under Windows ConPTY. Access is
              strictly restricted to the <span className="font-semibold text-purple-400">ROOT</span> role (PRD §6.5 &
              Acceptance Criterion A4). Non-root accounts receive HTTP 403 Forbidden.
            </p>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-400 max-w-md text-left flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <span>
                Current User: <strong className="text-slate-200">{currentUser?.username || 'Anonymous'}</strong> [
                {currentUser?.role || 'UNAUTHENTICATED'}]. Sign in with root credentials to open a terminal session.
              </span>
            </div>
          </div>
        ) : (
          <div ref={terminalRef} className="w-full h-full" />
        )}
      </div>

      {/* Terminal Footer Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-950 border-t border-slate-800 text-[11px] text-slate-400 select-none">
        <div className="flex items-center space-x-3">
          <span>Shell: PowerShell / ConPTY</span>
          <span>•</span>
          <span>Idle Timeout: 15 min</span>
          <span>•</span>
          <span>Host: Windows x64</span>
        </div>
        <div className="text-slate-500">
          Decision D11: Unrestricted Host Service Account Shell
        </div>
      </div>
    </div>
  );
}
