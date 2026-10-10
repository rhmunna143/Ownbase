'use client';

import React from 'react';
import { CheckCircle2, AlertCircle, Loader2, Circle, Terminal, Database, Server, Check, ArrowRight } from 'lucide-react';
import { BootstrapStep } from '@/shared/types';

interface BootstrapStepperProps {
  steps: BootstrapStep[];
}

export const BootstrapStepper: React.FC<BootstrapStepperProps> = ({ steps }) => {
  const allSuccessful = steps.every((s) => s.status === 'success');
  const runningStep = steps.find((s) => s.status === 'running');
  const hasError = steps.some((s) => s.status === 'error');

  return (
    <div className="glass-card rounded-xl p-5 border border-slate-800">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <span>Phase 1 Architecture Bootstrapper</span>
            {allSuccessful && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Check className="w-3 h-3" /> Fully Bootstrapped
              </span>
            )}
            {hasError && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Bootstrap Attention
              </span>
            )}
            {runningStep && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Bootstrapping {runningStep.name}...
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time verification sequence for Electron IPC, Portable PostgreSQL, and Prisma multi-file migrations.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((step, idx) => {
          let statusColor = 'border-slate-800/80 bg-slate-900/40 text-slate-400';
          let icon = <Circle className="w-4 h-4 text-slate-600" />;

          if (step.status === 'success') {
            statusColor = 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300';
            icon = <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
          } else if (step.status === 'running') {
            statusColor = 'border-blue-500/50 bg-blue-950/20 text-blue-300 shadow-sm shadow-blue-500/10';
            icon = <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
          } else if (step.status === 'error') {
            statusColor = 'border-rose-500/40 bg-rose-950/20 text-rose-300';
            icon = <AlertCircle className="w-4 h-4 text-rose-400" />;
          }

          return (
            <div
              key={step.id}
              className={`rounded-lg border p-3.5 transition-all duration-200 flex flex-col justify-between ${statusColor}`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                    Step 0{idx + 1}
                  </span>
                  <div>{icon}</div>
                </div>
                <h3 className="text-xs font-semibold text-slate-200 tracking-tight">{step.name}</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-2">{step.description}</p>
              </div>

              {step.detail && (
                <div className="mt-2.5 pt-2 border-t border-slate-800/60">
                  <span className="text-[10px] font-mono text-slate-300 break-words line-clamp-2">
                    {step.detail}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
