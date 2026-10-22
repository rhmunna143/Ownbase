'use client';

import React, { useState, useEffect } from 'react';
import {
  HardDrive,
  FolderTree,
  ShieldCheck,
  Terminal,
  Check,
  Copy,
  Save,
  Loader2,
  RefreshCw,
  Folder,
  CheckCircle2,
  AlertTriangle,
  Server,
  Wifi,
  ShieldAlert,
} from 'lucide-react';
import { serverApi } from '@/shared/apiClient';

interface SystemDrive {
  driveLetter: string;
  label: string;
  fileSystem: string;
  totalBytes: string;
  freeBytes: string;
  isSystemDrive: boolean;
  freePercentage: number;
}

interface StorageAllocation {
  selectedDrive: string;
  storageRoot: string;
  mediaRoot: string;
  backupsRoot: string;
}

export const StorageAllocationCard: React.FC = () => {
  const [drives, setDrives] = useState<SystemDrive[]>([]);
  const [allocation, setAllocation] = useState<StorageAllocation>({
    selectedDrive: 'C:',
    storageRoot: 'C:\\ProgramData\\Ownbase\\storage',
    mediaRoot: 'C:\\ProgramData\\Ownbase\\storage\\Photos',
    backupsRoot: 'C:\\ProgramData\\Ownbase\\backups',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // SSH State
  const [sshStatus, setSshStatus] = useState<{ installed: boolean; running: boolean; port: number; host: string } | null>(null);
  const [isTogglingSsh, setIsTogglingSsh] = useState(false);
  const [copiedSsh, setCopiedSsh] = useState(false);
  const [sshError, setSshError] = useState<string | null>(null);
  const [sshAdminCommand, setSshAdminCommand] = useState<string | null>(null);
  const [copiedAdminCmd, setCopiedAdminCmd] = useState(false);

  // Firewall State
  const [isApplyingFirewall, setIsApplyingFirewall] = useState(false);
  const [firewallMessage, setFirewallMessage] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [drivesRes, allocRes, sshRes] = await Promise.all([
        serverApi.getSystemDrives(),
        serverApi.getStorageAllocation(),
        serverApi.getSshStatus(),
      ]);
      if (Array.isArray(drivesRes) && drivesRes.length > 0) {
        setDrives(drivesRes);
      }
      if (allocRes) {
        setAllocation(allocRes);
      }
      if (sshRes) {
        setSshStatus(sshRes);
      }
    } catch {}
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDriveSelect = (driveLetter: string) => {
    const cleanLetter = driveLetter.replace(':', '');
    setAllocation({
      selectedDrive: `${cleanLetter}:`,
      storageRoot: `${cleanLetter}:\\Ownbase\\storage`,
      mediaRoot: `${cleanLetter}:\\Ownbase\\Photos`,
      backupsRoot: `${cleanLetter}:\\Ownbase\\backups`,
    });
  };

  const handleSaveAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await serverApi.updateStorageAllocation(allocation);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to save storage allocation: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleSsh = async () => {
    if (!sshStatus) return;
    setIsTogglingSsh(true);
    setSshError(null);
    setSshAdminCommand(null);
    try {
      const res = await serverApi.toggleSsh(!sshStatus.running);
      if (res.success) {
        setSshStatus((prev) => (prev ? { ...prev, running: res.running, installed: true } : null));
        setSshError(null);
      } else {
        setSshError(res.error || 'Failed to start OpenSSH service.');
        if (res.command) {
          setSshAdminCommand(res.command);
        }
      }
    } catch (err: any) {
      setSshError(err.message || 'Error communicating with SSH daemon API');
    } finally {
      setIsTogglingSsh(false);
    }
  };

  const handleApplyFirewall = async () => {
    setIsApplyingFirewall(true);
    setFirewallMessage(null);
    try {
      const res = await serverApi.applyFirewallRules();
      if (res.success) {
        setFirewallMessage('Inbound firewall rules for all Ownbase server ports successfully applied!');
      } else {
        setFirewallMessage('Notice: Elevated administrator rights required to update Windows Firewall automatically. Run PowerShell as Administrator.');
      }
    } catch {
      setFirewallMessage('Notice: Elevated administrator rights required. You can also run the copyable PowerShell script.');
    } finally {
      setIsApplyingFirewall(false);
    }
  };

  const formatBytes = (bytesStr: string) => {
    const b = Number(bytesStr);
    if (!b || isNaN(b)) return '0 GB';
    const gb = b / (1024 * 1024 * 1024);
    if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`;
    return `${gb.toFixed(1)} GB`;
  };

  return (
    <div className="space-y-6">
      {/* 1. Storage Drive Allocation */}
      <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40">
        <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800 mb-5 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                Storage Drive Allocation &amp; Custom Folders
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  Drive Selector
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Select which physical disk drives and folders Ownbase uses for cloud storage, media libraries, and backups.
              </p>
            </div>
          </div>

          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-300 font-medium transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Rescan Drives</span>
          </button>
        </div>

        {/* Physical Drives List */}
        <div className="mb-6">
          <div className="text-xs font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <span>Detected Windows Disk Drives</span>
            <span className="text-[10px] text-slate-500 font-normal">Click a drive to auto-allocate</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {drives.map((drive) => {
              const isSelected = allocation.selectedDrive.toUpperCase().startsWith(drive.driveLetter.toUpperCase().slice(0, 2));
              const usedPct = 100 - drive.freePercentage;
              return (
                <div
                  key={drive.driveLetter}
                  onClick={() => handleDriveSelect(drive.driveLetter)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                    isSelected
                      ? 'bg-blue-950/40 border-blue-500/60 shadow-lg shadow-blue-950/50'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <HardDrive className={`w-4 h-4 ${isSelected ? 'text-blue-400' : 'text-slate-400'}`} />
                      <span className="text-sm font-bold font-mono text-white">{drive.driveLetter}</span>
                      <span className="text-xs text-slate-400">({drive.label})</span>
                    </div>
                    {isSelected && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold">
                        Active Drive
                      </span>
                    )}
                  </div>

                  {/* Disk gauge */}
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden mt-3 mb-1.5">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usedPct > 90 ? 'bg-rose-500' : usedPct > 75 ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(5, usedPct))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mt-1">
                    <span>{formatBytes(drive.freeBytes)} free</span>
                    <span className="text-slate-500">Total: {formatBytes(drive.totalBytes)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Custom Folder Configuration Form */}
        <form onSubmit={handleSaveAllocation} className="space-y-4 pt-4 border-t border-slate-800 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-300 mb-1 font-medium flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-blue-400" />
                <span>Primary Cloud Storage Directory</span>
              </label>
              <input
                type="text"
                required
                value={allocation.storageRoot}
                onChange={(e) => setAllocation({ ...allocation, storageRoot: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">Used by FileBrowser, Syncthing, and S3 objects.</p>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-medium flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-indigo-400" />
                <span>Photos &amp; Memories Folder</span>
              </label>
              <input
                type="text"
                required
                value={allocation.mediaRoot}
                onChange={(e) => setAllocation({ ...allocation, mediaRoot: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">Used for phone photo sync and camera uploads.</p>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-medium flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Automated Backups Directory</span>
              </label>
              <input
                type="text"
                required
                value={allocation.backupsRoot}
                onChange={(e) => setAllocation({ ...allocation, backupsRoot: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">Encrypted database snapshots &amp; disaster recovery.</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3">
            {saveSuccess ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                <CheckCircle2 className="w-4 h-4" /> Storage allocation updated and verified!
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                Directories will be automatically initialized with proper Windows permissions.
              </span>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 disabled:opacity-50 transition-all"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Save Storage Allocation</span>
            </button>
          </div>
        </form>
      </div>

      {/* 2. SSH Access & Windows Firewall */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SSH Server Access */}
        <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    Windows OpenSSH Server Access
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                      sshStatus?.running
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                      {sshStatus?.running ? 'Running (Port 22)' : 'Stopped'}
                    </span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Connect securely from any terminal via SSH or SFTP.
                  </p>
                </div>
              </div>

              <button
                onClick={handleToggleSsh}
                disabled={isTogglingSsh}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  sshStatus?.running
                    ? 'bg-rose-950/40 text-rose-300 border border-rose-800/40 hover:bg-rose-900/40'
                    : 'bg-purple-600 text-white hover:bg-purple-500 shadow-md shadow-purple-600/20'
                }`}
              >
                {isTogglingSsh ? 'Configuring SSH...' : sshStatus?.running ? 'Stop SSH' : 'Enable SSH'}
              </button>
            </div>

            {sshError && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs space-y-2 mb-3">
                <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>SSH Service Notice</span>
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">{sshError}</p>
                {sshAdminCommand && (
                  <div className="pt-1">
                    <div className="text-[10px] text-slate-400 font-mono mb-1">Run in PowerShell as Administrator:</div>
                    <div className="flex items-center justify-between bg-black/60 px-2.5 py-1.5 rounded border border-amber-500/40 font-mono text-[11px] text-amber-300">
                      <span className="truncate max-w-[280px] sm:max-w-md">{sshAdminCommand}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(sshAdminCommand);
                          setCopiedAdminCmd(true);
                          setTimeout(() => setCopiedAdminCmd(false), 2000);
                        }}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0 ml-2"
                        title="Copy command"
                      >
                        {copiedAdminCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                <div className="text-slate-400 text-[11px]">SSH Terminal Command:</div>
                <div className="flex items-center justify-between bg-slate-900 px-3 py-2 rounded-lg border border-slate-700 font-mono text-emerald-300 text-xs">
                  <span>ssh {process.env.USERNAME || 'user'}@{sshStatus?.host || '192.168.1.X'}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`ssh ${process.env.USERNAME || 'user'}@${sshStatus?.host || 'localhost'}`);
                      setCopiedSsh(true);
                      setTimeout(() => setCopiedSsh(false), 2000);
                    }}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Copy SSH command"
                  >
                    {copiedSsh ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Uses native Windows OpenSSH service. Authorized keys can be placed in <code>~/.ssh/authorized_keys</code> for passwordless developer logins.
              </p>
            </div>
          </div>
        </div>

        {/* Windows Firewall & Multi-User Wi-Fi Inbound Rules */}
        <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Wifi className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    Multi-User LAN / Wi-Fi Firewall
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Fix <code>ERR_CONNECTION_REFUSED</code> when phones/laptops connect.
                  </p>
                </div>
              </div>

              <button
                onClick={handleApplyFirewall}
                disabled={isApplyingFirewall}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md shadow-amber-600/20 transition-all disabled:opacity-50"
              >
                {isApplyingFirewall ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>Configure Firewall</span>
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
              <p>
                When multiple users or other Wi-Fi devices connect to ports (e.g. <code>:8080</code>, <code>:11434</code>, <code>:5432</code>), Windows Firewall blocks inbound TCP packets by default unless a firewall rule exists.
              </p>
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 font-mono text-[11px] text-amber-300">
                Ports: 80, 443, 2019, 3000, 3001, 5432, 6379, 7681, 8080, 8090, 8384, 9000, 11434
              </div>
              {firewallMessage && (
                <div className="p-2.5 rounded-lg bg-blue-950/40 border border-blue-500/30 text-blue-300 text-xs mt-2">
                  {firewallMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
