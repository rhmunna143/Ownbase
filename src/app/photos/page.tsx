'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { PhotosGalleryCard } from '@/components/PhotosGalleryCard';
import { GlobalModalContainer } from '@/components/ModalDialog';
import { Camera, ArrowLeft, Sparkles, ShieldCheck, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { serverApi, authStore } from '@/shared/apiClient';
import { getAccessibleServiceUrl } from '@/shared/serviceUrl';

export default function PhotosStandalonePage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [loginUsername, setLoginUsername] = useState<string>('admin');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.title = 'Photos & Memories | Ownbase';
      const existingIcons = document.querySelectorAll("link[rel*='icon']");
      existingIcons.forEach(el => el.remove());
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      link.href = '/photos-favicon.svg';
      document.head.appendChild(link);
    }

    async function initAuth() {
      if (typeof window === 'undefined') return;

      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token') || params.get('access_token');
      if (urlToken) {
        authStore.setToken(urlToken);
        document.cookie = `ownbase_access_token=${urlToken}; Path=/; SameSite=Lax; Max-Age=86400`;
      }

      const token = authStore.getToken();
      if (token) {
        try {
          const res = await fetch('/api/v1/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            const user = data.user || { id: data.id, username: data.username, role: data.role };
            authStore.setUser(user);
            setCurrentUser(user);
            setAuthChecked(true);
            return;
          }
        } catch (e) {
          console.warn('[Photos] Token verification error:', e);
        }
      }

      const u = authStore.getUser();
      if (u && token) {
        setCurrentUser(u);
        setAuthChecked(true);
        return;
      }

      try {
        const restored = await serverApi.restoreSession();
        if (restored) {
          setCurrentUser(restored);
        }
      } catch {}
      setAuthChecked(true);
    }

    initAuth();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await serverApi.login(loginUsername, loginPassword);
      setCurrentUser(res.user);
    } catch (err: any) {
      setLoginError(err.message || 'Authentication failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const filesUrl = getAccessibleServiceUrl('files');

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex items-center justify-center p-6">
        <div className="flex flex-col items-center space-y-3">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          <p className="text-xs text-slate-400">Verifying security session...</p>
        </div>
      </div>
    );
  }

  if (authChecked && !currentUser) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#0d1322] border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="flex flex-col items-center text-center space-y-3 pb-2 border-b border-slate-800/80">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-500 p-0.5 shadow-lg shadow-amber-500/20">
              <div className="w-full h-full bg-[#0d1322] rounded-[14px] flex items-center justify-center">
                <Camera className="w-7 h-7 text-amber-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Photos & Memories</h1>
              <p className="text-xs text-slate-400 mt-1">Private Cloud Gallery & Media Engine</p>
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-sm font-semibold text-slate-200">Authentication Required</h2>
            <p className="text-xs text-slate-400 mt-0.5">Sign in to your Ownbase server to access photos</p>
          </div>

          {loginError && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-mono mb-1.5">
                Username
              </label>
              <input
                type="text"
                required
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Username"
                className="w-full bg-black/50 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-all font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-mono mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-black/50 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-all font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-600 via-rose-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-amber-600/25 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Sign In to Photos</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-slate-800 text-center">
            <Link href="/" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
              ← Return to Server Gateway Hub
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#080c14] text-slate-100 flex flex-col overflow-y-auto overflow-x-hidden selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Header */}
      <header className="sticky top-0 z-50 bg-[#0d1322]/90 backdrop-blur-md border-b border-slate-800 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-lg shadow-black/20">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-500 p-0.5 flex items-center justify-center shadow-md shadow-amber-500/20">
            <div className="w-full h-full bg-[#0d1322] rounded-[10px] flex items-center justify-center">
              <Camera className="w-5 h-5 text-amber-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-white tracking-tight">Photos & Memories</h1>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Gallery Hub
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Standalone private cloud photo & video timeline • RFC 7233 byte-range streaming
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
            title="Return to Server Gateway Hub"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Ownbase</span>
          </Link>
          <a
            href={filesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-950/40 hover:bg-blue-900/50 text-blue-300 border border-blue-800/60 transition-all"
            title="Open File Manager"
          >
            <span>📁 Files</span>
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <PhotosGalleryCard />
      </main>

      {/* Mobile Friendly Footer */}
      <footer className="border-t border-slate-800/80 bg-[#0a0f1d] px-4 py-3 text-center text-xs text-slate-500">
        <div className="flex items-center justify-center gap-2">
          <span>Ownbase</span>
          <span>•</span>
          <span className="text-amber-400 font-medium">Photos &amp; Memories Engine</span>
          <span>•</span>
          <span className="font-mono text-[11px] text-slate-400">Port 80 / 3001</span>
        </div>
      </footer>

      {/* Global Reusable Modal Dialog Container */}
      <GlobalModalContainer />
    </div>
  );
}
