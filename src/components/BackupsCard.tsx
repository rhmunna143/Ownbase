'use client';

import React, { useState, useEffect } from 'react';
import {
  Archive,
  Download,
  RotateCcw,
  Trash2,
  Plus,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Clock,
  HardDrive,
  FileCheck,
} from 'lucide-react';
import { fetchWithAuth } from '@/shared/apiClient';

interface BackupJob {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  archivePath?: string;
  fileSizeBytes?: number | string;
  checksumSha256?: string;
  isEncrypted: boolean;
  components?: string[];
  trigger: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export function BackupsCard() {
  const [backups, setBackups] = useState<BackupJob[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [backupName, setBackupName] = useState<string>('');
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupJob | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreMessage, setRestoreMessage] = useState<{ success: boolean; text: string } | null>(null);

  const fetchBackups = async () => {
    setIsLoading(true);
    try {
      const res = await fetchWithAuth('/api/v1/backups');
      if (res.ok) {
        const data = await res.json();
        setBackups(data);
      }
    } catch {}
    setIsLoading(false);
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setRestoreMessage(null);
    try {
      const res = await fetchWithAuth('/api/v1/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: backupName.trim() || undefined }),
      });
      if (res.ok) {
        setBackupName('');
        await fetchBackups();
        setRestoreMessage({ success: true, text: 'Backup archive created and encrypted successfully!' });
      } else {
        const err = await res.json();
        setRestoreMessage({ success: false, text: err.error || 'Failed to create backup.' });
      }
    } catch (err: any) {
      setRestoreMessage({ success: false, text: err.message });
    }
    setIsCreating(false);
  };

  const handleRestore = async (backupId: string) => {
    setIsRestoring(true);
    setRestoreMessage(null);
    try {
      const res = await fetchWithAuth(`/api/v1/backups/${backupId}/restore`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setRestoreMessage({
          success: true,
          text: `Restore complete! Restored components: ${data.componentsRestored?.join(', ') || 'all'}.`,
        });
      } else {
        setRestoreMessage({ success: false, text: data.error || 'Restore operation failed.' });
      }
    } catch (err: any) {
      setRestoreMessage({ success: false, text: err.message });
    }
    setIsRestoring(false);
    setSelectedBackupForRestore(null);
  };

  const handleDelete = async (backupId: string) => {
    if (!confirm('Are you sure you want to permanently delete this backup archive?')) return;
    try {
      const res = await fetchWithAuth(`/api/v1/backups/${backupId}`, { method: 'DELETE' });
      if (res.ok) {
        setBackups((prev) => prev.filter((b) => b.id !== backupId));
      }
    } catch {}
  };

  const formatBytes = (bytes?: number | string) => {
    if (!bytes) return '0 B';
    const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (isNaN(num)) return '0 B';
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
    return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
            <Archive className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Automated Backups & Disaster Recovery</h2>
            <p className="text-sm text-slate-400">
              AES-256-GCM encrypted database dumps, system configs, secrets keys, and one-click restore (PRD §7.4 & A2)
            </p>
          </div>
        </div>
        <button
          onClick={fetchBackups}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700/60 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Security Warning Notice */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
        <div>
          <div className="font-semibold text-amber-200">Disaster Recovery Key Policy</div>
          <div>
            All backup archives are protected with 256-bit AES-GCM encryption using your server&apos;s master key.
            <strong> Retain a secure offline copy of your master secrets key.</strong> If this key is lost, encrypted
            database credentials and storage archives cannot be decrypted.
          </div>
        </div>
      </div>

      {/* Notice Banner */}
      {restoreMessage && (
        <div
          className={`p-4 rounded-xl text-sm font-medium border ${
            restoreMessage.success
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}
        >
          {restoreMessage.text}
        </div>
      )}

      {/* Create Backup Form */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-200">Create Encrypted Backup Archive</h3>
        <form onSubmit={handleCreateBackup} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Backup label (optional, e.g. Pre-upgrade Snapshot)"
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            disabled={isCreating}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {isCreating ? 'Creating Backup...' : 'Create Backup'}
          </button>
        </form>
      </div>

      {/* Backups List Table */}
      <div className="rounded-2xl bg-slate-900/40 border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Available Backup Snapshots ({backups.length})</h3>
        </div>

        {backups.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            No backup snapshots created yet. Click &quot;Create Backup&quot; above to capture a full encrypted state.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {backups.map((b) => (
              <div
                key={b.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-200 text-sm">{b.name}</span>
                    {b.isEncrypted && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <ShieldCheck className="w-3 h-3" /> AES-256
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        b.status === 'completed'
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : b.status === 'failed'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(b.createdAt).toLocaleString()}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5" />
                      {formatBytes(b.fileSizeBytes)}
                    </span>
                    {b.checksumSha256 && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-400">
                        <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                        SHA-256: {b.checksumSha256.slice(0, 12)}...
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedBackupForRestore(b)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Delete backup"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Restore Confirmation Modal */}
      {selectedBackupForRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400 font-bold text-lg">
              <RotateCcw className="w-6 h-6" />
              <span>Confirm Database Restore</span>
            </div>

            <p className="text-xs text-slate-300">
              You are about to restore snapshot <strong>&quot;{selectedBackupForRestore.name}&quot;</strong>. This will
              overwrite current database records, services, and route configurations with the archived state.
            </p>

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-1">
              <div className="font-semibold">Master Key Verification</div>
              <div>Ensure the master encryption key has not been rotated since this snapshot was created.</div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setSelectedBackupForRestore(null)}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(selectedBackupForRestore.id)}
                disabled={isRestoring}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
              >
                {isRestoring ? 'Restoring System...' : 'Yes, Restore Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
