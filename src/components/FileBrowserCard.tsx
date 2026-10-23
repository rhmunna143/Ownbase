'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  File,
  FileVideo,
  FileAudio,
  FileImage,
  FileText,
  FileCode,
  Upload,
  FolderPlus,
  ArrowLeft,
  ChevronRight,
  Download,
  Trash2,
  Edit2,
  Play,
  X,
  Search,
  LayoutGrid,
  List,
  RefreshCw,
  HardDrive,
  Eye,
  Check,
  Film,
  Music,
  ExternalLink,
  Volume2,
  Loader2,
} from 'lucide-react';
import { serverApi } from '@/shared/apiClient';
import { FileItem, FileListResponse } from '@/shared/types';

export const FileBrowserCard: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [data, setData] = useState<FileListResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Media preview modals
  const [activeMedia, setActiveMedia] = useState<FileItem | null>(null);
  const [activeTextContent, setActiveTextContent] = useState<string | null>(null);
  const [textPreviewTitle, setTextPreviewTitle] = useState<string>('');

  // Operations modals
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingItem, setRenamingItem] = useState<FileItem | null>(null);
  const [newName, setNewName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<{
    fileName: string;
    currentIndex: number;
    totalFiles: number;
    loadedBytes: number;
    totalBytes: number;
    filePercent: number;
    overallPercent: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const loadDirectory = async (targetPath: string) => {
    setIsLoading(true);
    try {
      const res = await serverApi.listFiles(targetPath);
      setData(res);
      setCurrentPath(targetPath);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory('');
  }, []);

  const handleFolderClick = (item: FileItem) => {
    loadDirectory(item.path);
  };

  const handleBreadcrumbClick = (idx: number) => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    const newPath = parts.slice(0, idx + 1).join('/');
    loadDirectory(newPath);
  };

  const handleFileClick = async (item: FileItem) => {
    if (item.isDirectory) {
      handleFolderClick(item);
      return;
    }

    if (item.isVideo || item.isImage || item.isAudio) {
      setActiveMedia(item);
      return;
    }

    if (item.isText) {
      try {
        const res = await serverApi.getFileContent(item.path);
        setTextPreviewTitle(item.name);
        setActiveTextContent(res.content || '');
      } catch (err: any) {
        alert(`Cannot preview file: ${err.message}`);
      }
      return;
    }

    // Direct download for other files
    handleDownload(item);
  };

  const handleDownload = (item: FileItem) => {
    const downloadUrl = `/api/files/download?path=${encodeURIComponent(item.path)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDelete = async (item: FileItem) => {
    if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
      const res = await serverApi.deleteItem(item.path);
      if (res.success) {
        loadDirectory(currentPath);
      } else {
        alert('Failed to delete item.');
      }
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const res = await serverApi.createFolder(currentPath, newFolderName.trim());
    if (res.success) {
      setNewFolderName('');
      setIsNewFolderOpen(false);
      loadDirectory(currentPath);
    } else {
      alert('Failed to create folder.');
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingItem || !newName.trim()) return;
    const res = await serverApi.renameItem(renamingItem.path, newName.trim());
    if (res.success) {
      setRenamingItem(null);
      setNewName('');
      loadDirectory(currentPath);
    } else {
      alert('Failed to rename item.');
    }
  };

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  const processUpload = async (files: FileList | File[]) => {
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

      await serverApi.uploadFile(currentPath, file, (progress) => {
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

    // Keep completed state visible for 2.5s so user sees the 100% completion
    setUploadStatus((prev) => prev ? {
      ...prev,
      fileName: `Uploaded ${totalFilesCount} file${totalFilesCount > 1 ? 's' : ''} successfully!`,
      filePercent: 100,
      overallPercent: 100,
    } : null);

    setTimeout(() => {
      setUploadStatus(null);
      setIsUploading(false);
      setUploadProgress(0);
    }, 2500);

    if (fileInputRef.current) fileInputRef.current.value = '';
    loadDirectory(currentPath);
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processUpload(e.target.files);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setIsDraggingOver(false);
      dragCounter.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounter.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processUpload(e.dataTransfer.files);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatModifiedDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const getFileIcon = (item: FileItem) => {
    if (item.isDirectory) {
      return <Folder className="w-8 h-8 sm:w-10 sm:h-10 text-amber-400 fill-amber-400/20 shrink-0" />;
    }
    if (item.isVideo) {
      return <FileVideo className="w-8 h-8 sm:w-10 sm:h-10 text-rose-400 fill-rose-400/20 shrink-0" />;
    }
    if (item.isImage) {
      return <FileImage className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-400 fill-emerald-400/20 shrink-0" />;
    }
    if (item.isAudio) {
      return <FileAudio className="w-8 h-8 sm:w-10 sm:h-10 text-purple-400 fill-purple-400/20 shrink-0" />;
    }
    if (item.isText) {
      return <FileText className="w-8 h-8 sm:w-10 sm:h-10 text-blue-400 fill-blue-400/20 shrink-0" />;
    }
    return <File className="w-8 h-8 sm:w-10 sm:h-10 text-slate-400 shrink-0" />;
  };

  const getDisplayName = (name: string): string => {
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  };

  const filteredItems = (data?.items || []).filter((item) =>
    getDisplayName(item.name).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="space-y-4 relative min-h-[500px]"
    >
      {/* Full-Screen Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 rounded-2xl bg-blue-950/85 backdrop-blur-md border-2 border-dashed border-blue-400 flex flex-col items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-150 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/20 border border-blue-400/50 flex items-center justify-center text-blue-300 mb-3 shadow-lg shadow-blue-500/30">
            <Upload className="w-8 h-8 animate-bounce" />
          </div>
          <h3 className="text-lg font-bold text-white tracking-wide">Drop files anywhere to upload</h3>
          <p className="text-xs text-blue-300 mt-1 font-mono">
            Destination: {currentPath ? `/${currentPath}` : 'Root Storage'}
          </p>
        </div>
      )}

      {/* Top Header Card */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-blue-400" />
              <span>Native File Explorer &amp; Media Hub</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
                HTTP 206 Streaming
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Browse files, stream full 1080p/4K MKV/MP4 videos directly to your phone, and manage server storage.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUploadFiles}
              multiple
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all min-h-[40px] touch-manipulation disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>{isUploading ? `Uploading ${uploadProgress}%` : 'Upload File'}</span>
            </button>

            <button
              onClick={() => setIsNewFolderOpen(true)}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors min-h-[40px] touch-manipulation"
            >
              <FolderPlus className="w-4 h-4 text-amber-400" />
              <span>New Folder</span>
            </button>

            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  const event = new CustomEvent('ownbase:navigate', { detail: 'storage' });
                  window.dispatchEvent(event);
                }
              }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition-colors min-h-[40px] touch-manipulation"
              title="Select Windows storage drive letter and configure storage directories"
            >
              <HardDrive className="w-4 h-4 text-cyan-400" />
              <span>Storage Drives</span>
            </button>

            <button
              onClick={() => loadDirectory(currentPath)}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Breadcrumb Navigation & Controls */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          {/* Breadcrumb list */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin text-xs">
            <button
              onClick={() => loadDirectory('')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors shrink-0 ${
                currentPath === ''
                  ? 'bg-blue-600/20 text-blue-400 font-bold border border-blue-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Root Storage</span>
            </button>

            {pathParts.map((part, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <button
                  onClick={() => handleBreadcrumbClick(idx)}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors truncate max-w-[150px] shrink-0 ${
                    idx === pathParts.length - 1
                      ? 'bg-blue-600/20 text-blue-400 font-bold border border-blue-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {part}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Search & View Mode */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/60"
              />
            </div>

            <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="List view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Live Upload Progress Banner */}
      {uploadStatus && (
        <div className="glass-card rounded-2xl p-4 sm:p-5 border border-blue-500/40 bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-slate-900/40 backdrop-blur-md shadow-xl shadow-blue-950/30 animate-in fade-in slide-in-from-top-2 duration-200 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white truncate max-w-[200px] sm:max-w-md">
                    {uploadStatus.fileName}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                    File {uploadStatus.currentIndex} of {uploadStatus.totalFiles}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Streaming bytes to server storage...
                </p>
              </div>
            </div>

            <div className="text-right font-mono text-xs text-blue-300 shrink-0 pl-10 sm:pl-0 flex sm:flex-col items-center sm:items-end justify-between sm:justify-center">
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
              className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-150 shadow-sm shadow-blue-500/50"
              style={{ width: `${uploadStatus.filePercent}%` }}
            />
          </div>

          {uploadStatus.totalFiles > 1 && (
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-0.5">
              <span>Overall Batch Progress ({uploadStatus.currentIndex} of {uploadStatus.totalFiles} files)</span>
              <span className="text-slate-300 font-semibold">{uploadStatus.overallPercent}%</span>
            </div>
          )}
        </div>
      )}

      {/* Directory Contents */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-12 glass-card rounded-2xl border border-slate-800">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-3" />
          <span className="text-sm text-slate-400">Loading files and media...</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 glass-card rounded-2xl border border-slate-800 text-center">
          <Folder className="w-12 h-12 text-slate-600 mb-3" />
          <h3 className="text-sm font-semibold text-white">This folder is empty</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Tap "Upload File" above to add videos, photos, or documents directly from your phone.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {/* Back Button if in subfolder */}
          {currentPath !== '' && (
            <div
              onClick={() => {
                const parent = data?.parentPath !== null && data?.parentPath !== undefined ? data.parentPath : '';
                loadDirectory(parent);
              }}
              className="glass-card rounded-2xl p-4 border border-slate-800/80 bg-slate-900/40 hover:bg-slate-850 hover:border-blue-500/40 transition-all cursor-pointer flex flex-col items-center justify-center text-center touch-manipulation group min-h-[140px]"
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                <ArrowLeft className="w-6 h-6 text-blue-400" />
              </div>
              <span className="text-xs font-semibold text-slate-300">.. (Back)</span>
              <span className="text-[10px] text-slate-500 mt-0.5">Parent Folder</span>
            </div>
          )}

          {filteredItems.map((item) => (
            <div
              key={item.path}
              className="glass-card rounded-2xl p-3 sm:p-4 border border-slate-800/80 bg-slate-900/40 hover:bg-slate-850 hover:border-blue-500/40 transition-all flex flex-col justify-between group relative min-h-[150px]"
            >
              {/* Media badge for videos/photos */}
              {item.isVideo && (
                <div className="absolute top-2.5 left-2.5 px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[9px] font-mono flex items-center gap-1 z-10">
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>VIDEO</span>
                </div>
              )}

              {/* Quick Actions Dropdown / Hover Menu */}
              <div className="absolute top-2.5 right-2.5 flex items-center gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(item);
                  }}
                  className="p-1 rounded-md bg-slate-800/90 hover:bg-slate-700 text-slate-300"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingItem(item);
                    setNewName(item.name);
                  }}
                  className="p-1 rounded-md bg-slate-800/90 hover:bg-slate-700 text-slate-300"
                  title="Rename"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item);
                  }}
                  className="p-1 rounded-md bg-rose-950/80 hover:bg-rose-900 text-rose-400 border border-rose-800/40"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Main Tap / Click Area */}
              <div
                onClick={() => handleFileClick(item)}
                className="cursor-pointer flex-1 flex flex-col items-center justify-center text-center touch-manipulation pt-2"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                  {getFileIcon(item)}
                </div>

                <div className="w-full">
                  <h4
                    className="text-xs font-semibold text-white truncate max-w-full group-hover:text-blue-400 transition-colors"
                    title={getDisplayName(item.name)}
                  >
                    {getDisplayName(item.name)}
                  </h4>
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 mt-1 font-mono">
                    <span>{item.isDirectory ? 'Folder' : formatFileSize(item.size)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="glass-card rounded-2xl border border-slate-800/80 bg-slate-900/40 overflow-hidden">
          <div className="divide-y divide-slate-800/60">
            {currentPath !== '' && (
              <div
                onClick={() => {
                  const parent = data?.parentPath !== null && data?.parentPath !== undefined ? data.parentPath : '';
                  loadDirectory(parent);
                }}
                className="p-3.5 hover:bg-slate-800/50 flex items-center gap-3 cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-blue-400" />
                <span className="text-xs font-semibold text-slate-200">.. (Parent Folder)</span>
              </div>
            )}

            {filteredItems.map((item) => (
              <div
                key={item.path}
                onClick={() => handleFileClick(item)}
                className="p-3 sm:p-3.5 hover:bg-slate-800/50 flex items-center justify-between gap-3 cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 flex items-center justify-center shrink-0">
                    {getFileIcon(item)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs sm:text-sm font-semibold text-white truncate group-hover:text-blue-400 transition-colors" title={getDisplayName(item.name)}>
                      {getDisplayName(item.name)}
                    </h4>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {formatModifiedDate(item.modifiedAt)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-mono text-slate-400">
                    {item.isDirectory ? 'Folder' : formatFileSize(item.size)}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(item);
                      }}
                      className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      className="p-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-400 border border-rose-800/40"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 1: VIDEO / MEDIA PLAYER MODAL (HTTP 206 Streaming) */}
      {/* ======================================================== */}
      {activeMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="relative w-full max-w-4xl bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-3 bg-slate-900/70">
              <div className="flex items-center gap-2.5 min-w-0">
                {activeMedia.isVideo ? (
                  <Film className="w-5 h-5 text-rose-400 shrink-0" />
                ) : activeMedia.isAudio ? (
                  <Music className="w-5 h-5 text-purple-400 shrink-0" />
                ) : (
                  <FileImage className="w-5 h-5 text-emerald-400 shrink-0" />
                )}
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">{activeMedia.name}</h3>
                  <span className="text-[10px] font-mono text-slate-400">
                    {formatFileSize(activeMedia.size)} • {activeMedia.mimeType}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(activeMedia)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </button>
                <button
                  onClick={() => setActiveMedia(null)}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Player Content */}
            <div className="flex-1 overflow-y-auto flex items-center justify-center p-2 sm:p-4 bg-black">
              {activeMedia.isVideo ? (
                <div className="w-full flex flex-col items-center">
                  <video
                    ref={videoRef}
                    key={activeMedia.path}
                    src={`/api/files/stream?path=${encodeURIComponent(activeMedia.path)}`}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[70vh] rounded-2xl bg-black shadow-lg"
                  >
                    Your browser does not support the video tag.
                  </video>
                  <div className="w-full mt-3 px-2 flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Live HTTP 206 Partial Content Stream
                    </span>
                    <span className="text-[11px] font-mono">Native Video Acceleration</span>
                  </div>
                </div>
              ) : activeMedia.isImage ? (
                <img
                  src={`/api/files/stream?path=${encodeURIComponent(activeMedia.path)}`}
                  alt={activeMedia.name}
                  className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-xl"
                />
              ) : activeMedia.isAudio ? (
                <div className="w-full max-w-md p-6 flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mb-6 text-purple-400">
                    <Volume2 className="w-10 h-10" />
                  </div>
                  <h4 className="text-base font-bold text-white text-center mb-4">{activeMedia.name}</h4>
                  <audio
                    src={`/api/files/stream?path=${encodeURIComponent(activeMedia.path)}`}
                    controls
                    autoPlay
                    className="w-full"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: TEXT / CODE PREVIEW MODAL */}
      {/* ======================================================== */}
      {activeTextContent !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-3xl bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">{textPreviewTitle}</h3>
              </div>
              <button
                onClick={() => setActiveTextContent(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="flex-1 p-5 overflow-auto font-mono text-xs text-slate-200 bg-slate-950 selection:bg-blue-600">
              {activeTextContent}
            </pre>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: NEW FOLDER DIALOG */}
      {/* ======================================================== */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateFolder}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-amber-400" />
                <span>Create New Folder</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Folder Name</label>
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Movies, Backups, Photos"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 4: RENAME DIALOG */}
      {/* ======================================================== */}
      {renamingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <form
            onSubmit={handleRename}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-blue-400" />
                <span>Rename Item</span>
              </h3>
              <button
                type="button"
                onClick={() => setRenamingItem(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">New Name</label>
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRenamingItem(null)}
                className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Floating Bottom-Right Upload Monitor */}
      {uploadStatus && (
        <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 glass-card rounded-2xl p-4 border border-blue-500/50 bg-[#0c1222]/95 backdrop-blur-xl shadow-2xl shadow-black/80 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              {uploadStatus.filePercent === 100 ? (
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-3.5 h-3.5" />
                </div>
              ) : (
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
              )}
              <span className="text-xs font-semibold text-white truncate">{uploadStatus.fileName}</span>
            </div>
            <span className="text-xs font-bold font-mono text-cyan-400 shrink-0">{uploadStatus.filePercent}%</span>
          </div>
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-700/60 p-[1px]">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-150"
              style={{ width: `${uploadStatus.filePercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mt-2">
            <span>{formatFileSize(uploadStatus.loadedBytes)} / {formatFileSize(uploadStatus.totalBytes)}</span>
            <span>File {uploadStatus.currentIndex} of {uploadStatus.totalFiles}</span>
          </div>
        </div>
      )}
    </div>
  );
};
