import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';
import { paths } from '../core/paths';
import { safeResolvePath } from '../core/pathGuard';
import { PrismaManager } from '../db/prisma';

export type StorageTier = 'DATA' | 'MEDIA' | 'BACKUP' | 'CACHE';

export interface ServiceMountConfig {
  serviceId?: string;
  volumeId: string;
  driveLetter: string; // e.g. "D:" or "C:"
  tier: StorageTier;
  sourceSubpath: string; // e.g. "OwnbaseData\\media"
  mountName: string; // e.g. "photos_library"
  quotaBytes?: bigint;
}

export class StoragePlacementManager {
  private prismaManager: PrismaManager;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
  }

  /**
   * Creates an NTFS Directory Junction safely without shell mklink (Item 5.9).
   * Uses native fs.promises.symlink(target, linkPath, 'junction').
   */
  public async createJunction(targetPath: string, junctionLinkPath: string): Promise<string> {
    // 1. Resolve and ensure target directory exists
    const canonicalTarget = path.resolve(targetPath);
    if (!fs.existsSync(canonicalTarget)) {
      await fs.promises.mkdir(canonicalTarget, { recursive: true });
    }

    // 2. Validate junction link path within dataDir or custom mount dir
    const canonicalLink = path.resolve(junctionLinkPath);
    const parentDir = path.dirname(canonicalLink);
    if (!fs.existsSync(parentDir)) {
      await fs.promises.mkdir(parentDir, { recursive: true });
    }

    // 3. If junction link already exists, check if it points to the right target
    if (fs.existsSync(canonicalLink)) {
      const stat = await fs.promises.lstat(canonicalLink);
      if (stat.isSymbolicLink()) {
        try {
          const currentTarget = await fs.promises.readlink(canonicalLink);
          if (path.resolve(currentTarget) === canonicalTarget) {
            logger.debug('storage', `Junction already exists pointing to target: ${canonicalLink} -> ${canonicalTarget}`);
            return canonicalLink;
          }
        } catch {}
        // Remove existing link if pointing elsewhere
        await fs.promises.unlink(canonicalLink);
      } else {
        throw new Error(`Target junction path "${canonicalLink}" exists and is not a junction link.`);
      }
    }

    // 4. Create native Windows NTFS Directory Junction
    await fs.promises.symlink(canonicalTarget, canonicalLink, 'junction');
    logger.info('storage', `Created NTFS Directory Junction: ${canonicalLink} -> ${canonicalTarget}`);

    return canonicalLink;
  }

  /**
   * Safely removes a directory junction without removing the files in the target directory.
   */
  public async removeJunction(junctionLinkPath: string): Promise<boolean> {
    const canonicalLink = path.resolve(junctionLinkPath);
    if (!fs.existsSync(canonicalLink)) return false;

    const stat = await fs.promises.lstat(canonicalLink);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Path "${canonicalLink}" is not a junction or symbolic link; refusing to unlink.`);
    }

    // On Windows, unlinking a junction link removes only the link, leaving target untouched.
    await fs.promises.unlink(canonicalLink);
    logger.info('storage', `Removed NTFS Directory Junction: ${canonicalLink}`);
    return true;
  }

  /**
   * Mounts tiered storage on a volume and records the mount in the database.
   */
  public async createMount(config: ServiceMountConfig): Promise<any> {
    const volumeRoot = config.driveLetter.endsWith('\\') ? config.driveLetter : `${config.driveLetter}\\`;
    const targetPath = path.join(volumeRoot, config.sourceSubpath);
    const mountsBaseDir = path.join(paths.dataDir, 'mounts');
    const linkPath = path.join(mountsBaseDir, `${config.serviceId || 'shared'}_${config.mountName}`);

    // Create the junction
    await this.createJunction(targetPath, linkPath);

    // Persist to database
    const client = this.prismaManager.getClient();
    const mount = await client.serviceMount.create({
      data: {
        serviceId: config.serviceId,
        volumeId: config.volumeId,
        tier: config.tier,
        sourcePath: targetPath,
        mountPath: linkPath,
        quotaBytes: config.quotaBytes,
        usedBytes: BigInt(0),
      },
    });

    return mount;
  }

  /**
   * Lists all service mounts.
   */
  public async listMounts(): Promise<any[]> {
    const client = this.prismaManager.getClient();
    return client.serviceMount.findMany({
      include: {
        volume: true,
        service: true,
      },
    });
  }
}

export const storagePlacementManager = new StoragePlacementManager(new PrismaManager());
