'use client';

import React from 'react';
import Link from 'next/link';
import { PhotosGalleryCard } from '@/components/PhotosGalleryCard';
import { Camera, ArrowLeft, Sparkles, Smartphone, ShieldCheck, Heart } from 'lucide-react';

export default function PhotosStandalonePage() {
  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col selection:bg-amber-500/30 selection:text-amber-200">
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
            <span>Server Hub</span>
          </Link>
          <a
            href="http://files.localhost"
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
          <span className="text-amber-400 font-medium">Google Photos & Memories Engine</span>
          <span>•</span>
          <span className="font-mono text-[11px] text-slate-400">Port 80 / 3001</span>
        </div>
      </footer>
    </div>
  );
}
