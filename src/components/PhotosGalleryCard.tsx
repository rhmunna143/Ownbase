'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Image,
  Film,
  Star,
  Upload,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Info,
  Calendar,
  Sparkles,
  Camera,
  Play,
  Heart,
  ZoomIn,
  Check,
  Loader2,
} from 'lucide-react';
import { serverApi } from '@/shared/apiClient';
import { PhotoItem, PhotoTimelineSection, PhotosResponse } from '@/shared/types';

export const PhotosGalleryCard: React.FC = () => {
  const [data, setData] = useState<PhotosResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video'>('all');
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);

  // Full-screen Lightbox
  const [activeItem, setActiveItem] = useState<PhotoItem | null>(null);
  const [showInfoDrawer, setShowInfoDrawer] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStatus, setUploadStatus] = useState<{
    fileName: string;
    currentIndex: number;
    totalFiles: number;
    loadedBytes: number;
    totalBytes: number;
    filePercent: number;
    overallPercent: number;
  } | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = async () => {
    setIsLoading(true);
    try {
      const res = await serverApi.getPhotosTimeline(favoritesOnly, filterType);
      setData(res);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPhotos();
  }, [filterType, favoritesOnly]);

  const handleToggleFavorite = async (item: PhotoItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const res = await serverApi.togglePhotoFavorite(item.path);
    if (res.success) {
      item.isFavorite = res.isFavorite;
      setData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          timeline: prev.timeline.map((sec) => ({
            ...sec,
            items: sec.items.map((i) => (i.id === item.id ? { ...i, isFavorite: res.isFavorite } : i)),
          })),
        };
      });
      if (activeItem && activeItem.id === item.id) {
        setActiveItem({ ...activeItem, isFavorite: res.isFavorite });
      }
    }
  };

  const handleUploadPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const totalFilesCount = files.length;

    for (let i = 0; i < totalFilesCount; i++) {
      const file = files[i];
      setUploadStatus({
        fileName: file.name,
        currentIndex: i + 1,
        totalFiles: totalFilesCount,
        loadedBytes: 0,
        totalBytes: file.size,
        filePercent: 0,
        overallPercent: Math.round((i / totalFilesCount) * 100),
      });

      await serverApi.uploadFile('Photos', file, (progress) => {
        const overall = Math.round(((i + (progress.percent / 100)) / totalFilesCount) * 100);
        setUploadStatus({
          fileName: file.name,
          currentIndex: i + 1,
          totalFiles: totalFilesCount,
          loadedBytes: progress.loaded,
          totalBytes: progress.total,
          filePercent: progress.percent,
          overallPercent: Math.min(100, overall),
        });
        setUploadProgress(progress.percent);
      });
    }

    setUploadStatus(null);
    setIsUploading(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
    loadPhotos();
  };

  const allItemsFlat: PhotoItem[] = (data?.timeline || []).flatMap((sec) => sec.items);

  const handlePrev = () => {
    if (!activeItem) return;
    const idx = allItemsFlat.findIndex((i) => i.id === activeItem.id);
    if (idx > 0) {
      setActiveItem(allItemsFlat[idx - 1]);
    } else {
      setActiveItem(allItemsFlat[allItemsFlat.length - 1]);
    }
  };

  const handleNext = () => {
    if (!activeItem) return;
    const idx = allItemsFlat.findIndex((i) => i.id === activeItem.id);
    if (idx < allItemsFlat.length - 1) {
      setActiveItem(allItemsFlat[idx + 1]);
    } else {
      setActiveItem(allItemsFlat[0]);
    }
  };

  // Keyboard navigation for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeItem) return;
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'Escape') setActiveItem(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeItem]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-4">
      {/* Top Banner Card */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Camera className="w-5 h-5 text-indigo-400" />
              <span>Google Photos &amp; Memories Service</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                Timeline Hub
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Chronological photos &amp; videos gallery, instant phone uploads, high-resolution media viewer, and albums.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="file"
              ref={photoInputRef}
              onChange={handleUploadPhotos}
              multiple
              accept="image/*,video/*"
              className="hidden"
            />

            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all min-h-[40px] touch-manipulation disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>{isUploading ? `Uploading ${uploadProgress}%` : 'Upload from Phone'}</span>
            </button>

            <button
              onClick={loadPhotos}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Navigation Pills */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2 overflow-x-auto py-1 scrollbar-thin">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                setFilterType('all');
                setFavoritesOnly(false);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filterType === 'all' && !favoritesOnly
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-800/60 text-slate-400 hover:text-white'
              }`}
            >
              All Media ({data?.totalCount || 0})
            </button>

            <button
              onClick={() => {
                setFilterType('photo');
                setFavoritesOnly(false);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                filterType === 'photo' && !favoritesOnly
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-800/60 text-slate-400 hover:text-white'
              }`}
            >
              <Image className="w-3.5 h-3.5" />
              <span>Photos ({data?.photosCount || 0})</span>
            </button>

            <button
              onClick={() => {
                setFilterType('video');
                setFavoritesOnly(false);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                filterType === 'video' && !favoritesOnly
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-800/60 text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Videos ({data?.videosCount || 0})</span>
            </button>

            <button
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                favoritesOnly
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                  : 'bg-slate-800/60 text-slate-400 hover:text-white'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-current text-white' : 'text-amber-400'}`} />
              <span>Favorites</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-500 shrink-0 hidden md:block">
            {data?.totalCount || 0} Memories Cataloged
          </div>
        </div>
      </div>

      {/* Live Media Upload Progress Banner */}
      {uploadStatus && (
        <div className="glass-card rounded-2xl p-4 sm:p-5 border border-indigo-500/40 bg-gradient-to-r from-indigo-950/40 via-slate-900/60 to-purple-950/30 backdrop-blur-md shadow-xl shadow-indigo-950/30 animate-in fade-in slide-in-from-top-2 duration-200 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white truncate max-w-[200px] sm:max-w-md">
                    {uploadStatus.fileName}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                    Media {uploadStatus.currentIndex} of {uploadStatus.totalFiles}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Uploading high-res media to timeline storage...
                </p>
              </div>
            </div>

            <div className="text-right font-mono text-xs text-indigo-300 shrink-0 pl-10 sm:pl-0 flex sm:flex-col items-center sm:items-end justify-between sm:justify-center">
              <div>
                <span>{formatFileSize(uploadStatus.loadedBytes)}</span>
                <span className="text-slate-500"> / </span>
                <span>{formatFileSize(uploadStatus.totalBytes)}</span>
              </div>
              <div className="text-sm font-bold text-emerald-400 mt-0.5">
                {uploadStatus.filePercent}%
              </div>
            </div>
          </div>

          {/* Glowing Animated Progress Bar */}
          <div className="w-full bg-slate-950/80 h-2.5 rounded-full overflow-hidden border border-slate-800 p-0.5">
            <div
              className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-400 rounded-full transition-all duration-150 shadow-sm shadow-indigo-500/50"
              style={{ width: `${uploadStatus.filePercent}%` }}
            />
          </div>

          {uploadStatus.totalFiles > 1 && (
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-0.5">
              <span>Overall Upload Progress ({uploadStatus.currentIndex} of {uploadStatus.totalFiles} items)</span>
              <span className="text-slate-300 font-semibold">{uploadStatus.overallPercent}%</span>
            </div>
          )}
        </div>
      )}

      {/* Timeline Sections */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-16 glass-card rounded-2xl border border-slate-800">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
          <span className="text-sm text-slate-400">Loading your memories...</span>
        </div>
      ) : !data || data.timeline.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 glass-card rounded-2xl border border-slate-800 text-center">
          <Sparkles className="w-12 h-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-white">No photos or videos found</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Tap "Upload from Phone" to upload photos and videos directly from your camera roll!
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {data.timeline.map((section) => (
            <div key={section.dateHeader} className="space-y-3">
              {/* Date Header Sticky Strip */}
              <div className="flex items-center justify-between sticky top-16 z-10 py-1.5 bg-[#070b12]/90 backdrop-blur-md">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-indigo-400" />
                  <span>{section.dateHeader}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    {section.items.length} items
                  </span>
                </h3>
              </div>

              {/* Photo Masonry / Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
                {section.items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setActiveItem(item)}
                    className="relative aspect-square rounded-2xl overflow-hidden bg-slate-900 border border-slate-800/80 cursor-pointer group hover:border-indigo-500/60 transition-all touch-manipulation shadow-md"
                  >
                    {/* Thumbnail Image */}
                    {item.type === 'photo' ? (
                      <img
                        src={item.mediaUrl}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full relative bg-slate-950 flex items-center justify-center">
                        <video
                          src={item.streamUrl}
                          preload="metadata"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="w-10 h-10 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Overlay Gradient on Hover */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2.5">
                      <div className="flex items-center justify-between">
                        {item.type === 'video' ? (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/80 text-white text-[9px] font-bold font-mono">
                            VIDEO
                          </span>
                        ) : <span />}

                        {/* Favorite Heart Button */}
                        <button
                          onClick={(e) => handleToggleFavorite(item, e)}
                          className="p-1 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors"
                        >
                          <Heart
                            className={`w-3.5 h-3.5 ${
                              item.isFavorite ? 'text-rose-500 fill-rose-500' : 'text-white'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="text-[10px] text-white font-medium truncate">
                        {item.name}
                      </div>
                    </div>

                    {/* Persistent Star Badge if Favorite */}
                    {item.isFavorite && (
                      <div className="absolute top-2 right-2 p-1 rounded-full bg-black/60 shadow-md">
                        <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ======================================================== */}
      {/* FULL-SCREEN LIGHTBOX MODAL */}
      {/* ======================================================== */}
      {activeItem && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between animate-in fade-in duration-200">
          {/* Top Bar */}
          <div className="px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent z-20">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveItem(null)}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h4 className="text-xs sm:text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-md">
                  {activeItem.name}
                </h4>
                <p className="text-[10px] font-mono text-slate-400">
                  {activeItem.dateFormatted} • {formatFileSize(activeItem.size)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleToggleFavorite(activeItem)}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Favorite"
              >
                <Heart
                  className={`w-4 h-4 ${
                    activeItem.isFavorite ? 'text-rose-500 fill-rose-500' : 'text-white'
                  }`}
                />
              </button>

              <button
                onClick={() => setShowInfoDrawer(!showInfoDrawer)}
                className={`p-2 rounded-full transition-colors ${
                  showInfoDrawer ? 'bg-indigo-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
                title="Details"
              >
                <Info className="w-4 h-4" />
              </button>

              <a
                href={`/api/files/download?path=${encodeURIComponent(activeItem.path)}`}
                download={activeItem.name}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Download"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Central Media Canvas */}
          <div className="relative flex-1 flex items-center justify-center p-2 sm:p-6 overflow-hidden">
            {/* Previous Button */}
            <button
              onClick={handlePrev}
              className="absolute left-2 sm:left-4 z-20 p-2.5 sm:p-3 rounded-full bg-black/50 hover:bg-black/80 text-white border border-white/10 transition-all touch-manipulation"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* Media Content */}
            {activeItem.type === 'video' ? (
              <video
                key={activeItem.path}
                src={activeItem.streamUrl}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className="max-w-full max-h-[82vh] rounded-2xl shadow-2xl"
              />
            ) : (
              <img
                src={activeItem.mediaUrl}
                alt={activeItem.name}
                className="max-w-full max-h-[82vh] object-contain rounded-2xl shadow-2xl"
              />
            )}

            {/* Next Button */}
            <button
              onClick={handleNext}
              className="absolute right-2 sm:right-4 z-20 p-2.5 sm:p-3 rounded-full bg-black/50 hover:bg-black/80 text-white border border-white/10 transition-all touch-manipulation"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* Info Drawer (Slide-In) */}
            {showInfoDrawer && (
              <div className="absolute right-0 top-0 bottom-0 w-80 bg-slate-950/95 border-l border-slate-800 p-5 z-30 shadow-2xl overflow-y-auto space-y-4 animate-in slide-in-from-right duration-200">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Info className="w-4 h-4 text-indigo-400" />
                    <span>Media Info</span>
                  </h4>
                  <button
                    onClick={() => setShowInfoDrawer(false)}
                    className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Filename</label>
                    <p className="text-slate-200 font-mono mt-0.5 break-all">{activeItem.name}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Date</label>
                    <p className="text-slate-200 mt-0.5">{activeItem.dateFormatted}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">File Size</label>
                    <p className="text-slate-200 font-mono mt-0.5">{formatFileSize(activeItem.size)}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Type</label>
                    <p className="text-slate-200 font-mono mt-0.5 uppercase">{activeItem.type} ({activeItem.mimeType})</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Path</label>
                    <p className="text-slate-400 font-mono text-[11px] mt-0.5 break-all">{activeItem.path}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Bar Controls */}
          <div className="px-4 py-3 flex items-center justify-center bg-gradient-to-t from-black/80 to-transparent z-20">
            <span className="text-xs text-slate-400 font-mono">
              Use arrow keys or swipe to navigate memories
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
