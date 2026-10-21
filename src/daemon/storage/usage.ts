import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';
import { PrismaManager } from '../db/prisma';
import { volumeManager } from './volumes';

export interface StorageUsageSummary {
  volumes: Array<{
    driveLetter: string;
    totalBytes: string;
    freeBytes: string;
    usedPercentage: number;
    isLowSpace: boolean;
  }>;
  mounts: Array<{
    id: string;
    tier: string;
    mountPath: string;
    quotaBytes?: string;
    usedBytes: string;
    quotaUsedPercentage?: number;
  }>;
  alerts: string[];
}

export class StorageUsageManager {
  private prismaManager: PrismaManager;
  private usageCache = new Map<string, { sizeBytes: bigint; lastUpdated: number }>();
  private cacheTtlMs = 60000;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
  }

  /**
   * Recursively computes directory size in bytes.
   */
  public async calculateDirectorySize(dirPath: string): Promise<bigint> {
    if (!fs.existsSync(dirPath)) return BigInt(0);

    const cached = this.usageCache.get(dirPath);
    if (cached && Date.now() - cached.lastUpdated < this.cacheTtlMs) {
      return cached.sizeBytes;
    }

    let total = BigInt(0);

    const scan = async (current: string) => {
      try {
        const entries = await fs.promises.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await scan(fullPath);
          } else if (entry.isFile()) {
            const stat = await fs.promises.stat(fullPath);
            total += BigInt(stat.size);
          }
        }
      } catch (err: any) {
        logger.debug('storage', `Error scanning directory ${current}: ${err.message}`);
      }
    };

    await scan(dirPath);
    this.usageCache.set(dirPath, { sizeBytes: total, lastUpdated: Date.now() });

    return total;
  }

  /**
   * Enforces soft quota for an upload or write operation.
   * Returns false if writing incomingBytes will exceed the mount's soft quota.
   */
  public async checkQuota(mountPath: string, incomingBytes: number): Promise<{ allowed: boolean; reason?: string }> {
    const client = this.prismaManager.getClient();
    const mount = await client.serviceMount.findFirst({
      where: { mountPath },
    });

    if (!mount || !mount.quotaBytes) {
      return { allowed: true };
    }

    const currentUsed = await this.calculateDirectorySize(mount.sourcePath);
    const projected = currentUsed + BigInt(incomingBytes);

    if (projected > mount.quotaBytes) {
      const quotaMb = Number(mount.quotaBytes) / (1024 * 1024);
      const usedMb = Number(currentUsed) / (1024 * 1024);
      return {
        allowed: false,
        reason: `Exceeds mount soft quota: ${usedMb.toFixed(1)} MB used of ${quotaMb.toFixed(1)} MB quota.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Returns a complete storage breakdown across volumes and service mounts.
   */
  public async getUsageBreakdown(): Promise<StorageUsageSummary> {
    const volumes = await volumeManager.discoverVolumes();
    const client = this.prismaManager.getClient();
    const mounts = await client.serviceMount.findMany();

    const volumeSummaries = [];
    const alerts: string[] = [];

    for (const v of volumes) {
      const total = Number(v.totalBytes);
      const free = Number(v.freeBytes);
      const used = total - free;
      const pct = total > 0 ? (used / total) * 100 : 0;
      const isLowSpace = pct >= 90;

      if (isLowSpace) {
        alerts.push(`Volume ${v.driveLetter} is at ${pct.toFixed(1)}% capacity (less than 10% remaining).`);
      }

      volumeSummaries.push({
        driveLetter: v.driveLetter,
        totalBytes: v.totalBytes.toString(),
        freeBytes: v.freeBytes.toString(),
        usedPercentage: Math.round(pct * 10) / 10,
        isLowSpace,
      });
    }

    const mountSummaries = [];
    for (const m of mounts) {
      const sizeBytes = await this.calculateDirectorySize(m.sourcePath);

      // Update usedBytes in database
      await client.serviceMount.update({
        where: { id: m.id },
        data: { usedBytes: sizeBytes },
      });

      let quotaPct: number | undefined;
      if (m.quotaBytes && m.quotaBytes > BigInt(0)) {
        quotaPct = Math.round((Number(sizeBytes) / Number(m.quotaBytes)) * 1000) / 10;
        if (quotaPct >= 90) {
          alerts.push(`Service mount "${m.mountPath}" has reached ${quotaPct}% of its soft quota.`);
        }
      }

      mountSummaries.push({
        id: m.id,
        tier: m.tier,
        mountPath: m.mountPath,
        quotaBytes: m.quotaBytes?.toString(),
        usedBytes: sizeBytes.toString(),
        quotaUsedPercentage: quotaPct,
      });
    }

    return {
      volumes: volumeSummaries,
      mounts: mountSummaries,
      alerts,
    };
  }
}

export const storageUsageManager = new StorageUsageManager(new PrismaManager());
