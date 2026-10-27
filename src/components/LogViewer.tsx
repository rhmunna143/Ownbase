'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, Filter, ArrowDownCircle, Search, Maximize2, Minimize2 } from 'lucide-react';
import { LogEntry } from '@/shared/types';

interface LogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, onClear }) => {
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter((log) => {
    if (sourceFilter !== 'all' && log.source !== sourceFilter) return false;
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (searchQuery && !log.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  return (
    <div
      className={`glass-card rounded-xl p-5 border border-slate-800 flex flex-col transition-all duration-300 ${
        isFullscreen
          ? 'fixed inset-0 z-50 rounded-none border-0 p-6 bg-[#030712]/95 backdrop-blur-xl h-screen w-screen'
          : 'h-[calc(100vh-140px)] min-h-[600px] w-full'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800/80 mb-3 gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-slate-300" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
              Supervised Console &amp; IPC Stream
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {filteredLogs.length} events
              </span>
            </h2>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Search */}
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2.5 top-2 text-slate-500" />
            <input
              type="text"
              placeholder="Filter logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2.5 py-1 bg-slate-900 border border-slate-700/80 rounded-md text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 w-32 sm:w-36"
            />
          </div>

          {/* Source Filter */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-2 py-1 bg-slate-900 border border-slate-700/80 rounded-md text-[11px] text-slate-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Sources</option>
            <option value="postgres">Postgres</option>
            <option value="prisma">Prisma</option>
            <option value="electron">Electron</option>
            <option value="ipc">IPC</option>
          </select>

          {/* Auto scroll */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded-md border text-[11px] flex items-center gap-1 transition-colors ${
              autoScroll
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
            title="Toggle Auto Scroll"
          >
            <ArrowDownCircle className="w-3.5 h-3.5" />
          </button>

          {/* Clear */}
          <button
            onClick={onClear}
            className="p-1.5 rounded-md bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Clear Log View"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`p-1.5 rounded-md border text-[11px] flex items-center gap-1 transition-colors ${
              isFullscreen
                ? 'bg-purple-600/20 border-purple-500/40 text-purple-400'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Log Output Box */}
      <div
        ref={logContainerRef}
        className="flex-1 overflow-y-auto bg-[#070a10] rounded-lg p-3 font-mono text-[11px] leading-relaxed border border-slate-900/80 space-y-1 select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-slate-600 text-center py-12 italic">
            No log entries matching filter criteria.
          </div>
        ) : (
          filteredLogs.map((log) => {
            let badgeColor = 'bg-slate-800 text-slate-300';
            let textColor = 'text-slate-300';

            if (log.source === 'postgres') badgeColor = 'bg-blue-950/80 text-blue-300 border border-blue-800/40';
            if (log.source === 'prisma') badgeColor = 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/40';
            if (log.source === 'electron') badgeColor = 'bg-purple-950/80 text-purple-300 border border-purple-800/40';
            if (log.source === 'ipc') badgeColor = 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/40';

            if (log.level === 'error') textColor = 'text-rose-400';
            if (log.level === 'warn') textColor = 'text-amber-400';
            if (log.level === 'success') textColor = 'text-emerald-400 font-medium';

            const timeStr = new Date(log.timestamp).toLocaleTimeString();

            return (
              <div key={log.id} className="flex items-start gap-2 hover:bg-slate-900/40 px-1 py-0.5 rounded">
                <span className="text-slate-600 text-[10px] shrink-0">{timeStr}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono uppercase shrink-0 ${badgeColor}`}>
                  {log.source}
                </span>
                <span className={`break-all ${textColor}`}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
