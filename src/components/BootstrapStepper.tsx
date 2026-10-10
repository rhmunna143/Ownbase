'use client';

import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Circle, Check, ChevronDown, ChevronUp, Cpu } from 'lucide-react';
import { BootstrapStep } from '@/shared/types';

interface BootstrapStepperProps {
  steps: BootstrapStep[];
}

export const BootstrapStepper: React.FC<BootstrapStepperProps> = ({ steps }) => {
  const allSuccessful = steps.every((s) => s.status === 'success');
  const runningStep = steps.find((s) => s.status === 'running');
  const hasError = steps.some((s) => s.status === 'error');
  const [isExpanded, setIsExpanded] = useState<boolean>(!allSuccessful);

  return (
    <div className="glass-card rounded-xl p-3.5 border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">Engine Architecture</span>
              {allSuccessful && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <Check className="w-3 h-3" /> All 12 Systems Healthy
                </span>
              )}
              {hasError && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Action Required
                </span>
              )}
              {runningStep && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> {runningStep.name}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Electron IPC, Portable PostgreSQL 16, Prisma Migrations &amp; ProcessSupervisor.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
        >
          <span>{isExpanded ? 'Collapse' : 'View Architecture Pipeline'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded Grid */}
      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 mt-3.5 pt-3 border-t border-slate-800/80">
          {steps.map((step, idx) => {
            let statusColor = 'border-slate-800/80 bg-slate-900/40 text-slate-400';
            let icon = <Circle className="w-3.5 h-3.5 text-slate-600" />;

            if (step.status === 'success') {
              statusColor = 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300';
              icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
            } else if (step.status === 'running') {
              statusColor = 'border-blue-500/50 bg-blue-950/20 text-blue-300';
              icon = <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
            } else if (step.status === 'error') {
              statusColor = 'border-rose-500/40 bg-rose-950/20 text-rose-300';
              icon = <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
            }

            return (
              <div
                key={step.id}
                className={`rounded-lg border p-2.5 transition-all text-xs flex flex-col justify-between ${statusColor}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-mono uppercase text-slate-500">
                      Step {idx < 9 ? `0${idx + 1}` : idx + 1}
                    </span>
                    <div>{icon}</div>
                  </div>
                  <div className="font-semibold text-slate-200 text-[11px]">{step.name}</div>
                  <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{step.description}</p>
                </div>

                {step.detail && (
                  <div className="mt-1.5 pt-1 border-t border-slate-800/60 text-[9px] font-mono text-slate-300 truncate">
                    {step.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
