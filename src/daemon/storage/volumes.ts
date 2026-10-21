import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from '../core/logger';
import { PrismaManager } from '../db/prisma';

const execAsync = util.promisify(exec);

export interface VolumeInfo {
  driveLetter: string; // e.g. "C:"
  label?: string;
  fileSystem?: string;
  totalBytes: bigint;
  freeBytes: bigint;
  isSystemDrive: boolean;
  driveType?: string;
}

export class VolumeManager {
  private prismaManager: PrismaManager;
  private cachedVolumes: VolumeInfo[] = [];
  private lastScannedAt = 0;
  private cacheTtlMs = 60000;
  private activeScanPromise?: Promise<VolumeInfo[]>;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
  }

  /**
   * Discovers volumes using PowerShell Get-Volume and persists to database (Item 5.8).
   */
  public async discoverVolumes(force = false): Promise<VolumeInfo[]> {
    const now = Date.now();
    if (!force && this.cachedVolumes.length > 0 && now - this.lastScannedAt < this.cacheTtlMs) {
      return this.cachedVolumes;
    }

    if (this.activeScanPromise) {
      return this.activeScanPromise;
    }

    this.activeScanPromise = this.executeScan().finally(() => {
      this.activeScanPromise = undefined;
    });

    return this.activeScanPromise;
  }

  private async executeScan(): Promise<VolumeInfo[]> {
    const systemDriveLetter = (process.env.SystemDrive || 'C:').toUpperCase().replace(':', '');
    const volumes: VolumeInfo[] = [];

    try {
      const psCmd = `powershell.exe -NoProfile -NonInteractive -Command "Get-Volume | Where-Object { $_.DriveLetter -ne $null } | Select-Object DriveLetter, FileSystemLabel, FileSystem, Size, SizeRemaining, DriveType | ConvertTo-Json -Compress"`;
      const { stdout } = await execAsync(psCmd, { timeout: 10000 });

      if (stdout && stdout.trim()) {
        let rawData = JSON.parse(stdout.trim());
        if (!Array.isArray(rawData)) {
          rawData = [rawData];
        }

        for (const item of rawData) {
          if (!item.DriveLetter) continue;
          const letter = `${String(item.DriveLetter).toUpperCase()}:`;
          const isSys = String(item.DriveLetter).toUpperCase() === systemDriveLetter;

          volumes.push({
            driveLetter: letter,
            label: item.FileSystemLabel || undefined,
            fileSystem: item.FileSystem || undefined,
            totalBytes: BigInt(item.Size || 0),
            freeBytes: BigInt(item.SizeRemaining || 0),
            isSystemDrive: isSys,
            driveType: item.DriveType ? String(item.DriveType) : undefined,
          });
        }
      }
    } catch (err: any) {
      logger.warn('storage', `PowerShell Get-Volume failed: ${err.message}. Falling back to system drive probe.`);
    }

    // Fallback if PowerShell failed or returned empty
    if (volumes.length === 0) {
      const rootPath = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\';
      try {
        const stats = fs.statfsSync ? fs.statfsSync(rootPath) : null;
        const total = stats ? BigInt(stats.bsize) * BigInt(stats.blocks) : BigInt(100 * 1024 * 1024 * 1024);
        const free = stats ? BigInt(stats.bsize) * BigInt(stats.bfree) : BigInt(50 * 1024 * 1024 * 1024);

        volumes.push({
          driveLetter: `${systemDriveLetter}:`,
          label: 'Windows OS',
          fileSystem: 'NTFS',
          totalBytes: total,
          freeBytes: free,
          isSystemDrive: true,
        });
      } catch {
        volumes.push({
          driveLetter: 'C:',
          label: 'System Drive',
          fileSystem: 'NTFS',
          totalBytes: BigInt(100 * 1024 * 1024 * 1024),
          freeBytes: BigInt(50 * 1024 * 1024 * 1024),
          isSystemDrive: true,
        });
      }
    }

    this.cachedVolumes = volumes;
    this.lastScannedAt = Date.now();

    // Sync to database
    try {
      const client = this.prismaManager.getClient();
      for (const v of volumes) {
        await client.storageVolume.upsert({
          where: { driveLetter: v.driveLetter },
          create: {
            driveLetter: v.driveLetter,
            label: v.label,
            fileSystem: v.fileSystem,
            totalBytes: v.totalBytes,
            freeBytes: v.freeBytes,
            isSystemDrive: v.isSystemDrive,
            status: v.freeBytes < v.totalBytes / BigInt(10) ? 'low_space' : 'online',
            lastScannedAt: new Date(),
          },
          update: {
            label: v.label,
            fileSystem: v.fileSystem,
            totalBytes: v.totalBytes,
            freeBytes: v.freeBytes,
            isSystemDrive: v.isSystemDrive,
            status: v.freeBytes < v.totalBytes / BigInt(10) ? 'low_space' : 'online',
            lastScannedAt: new Date(),
          },
        });
      }
    } catch (dbErr: any) {
      logger.warn('storage', `Failed to sync volumes to DB: ${dbErr.message}`);
    }

    return volumes;
  }

  public getCachedVolumes(): VolumeInfo[] {
    return this.cachedVolumes;
  }
}

export const volumeManager = new VolumeManager(new PrismaManager());
