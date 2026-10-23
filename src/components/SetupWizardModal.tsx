'use client';

import React, { useState } from 'react';
import { ShieldAlert, KeyRound, CheckCircle2, AlertCircle, Loader2, Lock, User } from 'lucide-react';
import { serverApi, authStore } from '@/shared/apiClient';

interface SetupWizardModalProps {
  isOpen: boolean;
  onSetupComplete: () => void;
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({ isOpen, onSetupComplete }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await serverApi.executeSetup({
        username,
        password,
        setupToken: setupToken ? setupToken.trim() : undefined,
      });

      if (res.success) {
        setSuccess(true);
        // Attempt automatic login
        const loginRes = await serverApi.login(username, password).catch(() => null);
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const redirectTarget = params.get('redirect');
          const token = (loginRes && loginRes.accessToken) || authStore.getToken();
          if (redirectTarget && token) {
            try {
              const targetUrl = new URL(redirectTarget, window.location.origin);
              targetUrl.searchParams.set('token', token);
              window.location.replace(targetUrl.toString());
              return;
            } catch {}
          }
        }
        setTimeout(() => {
          onSetupComplete();
        }, 1500);
      } else {
        setError(res.error || 'Failed to initialize server root administrator.');
      }
    } catch (err: any) {
      setError(err.message || 'Network error executing setup.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-md glass-card bg-slate-900/95 border border-purple-500/30 rounded-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center space-x-3 pb-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">First-Run Setup Wizard</h2>
            <p className="text-xs text-slate-400">Initialize the Root Administrator Account</p>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Welcome to <span className="font-semibold text-purple-300">Ownbase</span>. No root user currently exists.
          Please create your primary administrator credentials to secure the server and all managed services.
        </p>

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="font-semibold">Root administrator provisioned successfully!</p>
            <p className="text-[11px] text-emerald-400/80">Launching authenticated dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-mono mb-1">
                Root Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full bg-black/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-mono mb-1">
                Master Password (min 8 chars)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-black/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-mono mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-black/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-mono mb-1">
                Administrative Setup Token (Optional if on loopback)
              </label>
              <input
                type="text"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="Required only if initializing remotely"
                className="w-full bg-black/40 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-purple-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-all shadow-md shadow-purple-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Provisioning Root & Argon2id Hash...</span>
                </>
              ) : (
                <span>Complete Initial Setup</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
