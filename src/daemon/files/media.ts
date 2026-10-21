import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../core/logger';
import { paths } from '../core/paths';
import { PrismaManager } from '../db/prisma';
import { getMimeType } from './stream';

export interface MediaScanResult {
  library: string;
  scanned: number;
  added: number;
  updated: number;
  errors: number;
}

export interface TimelineQuery {
  page?: number;
  pageSize?: number;
  library?: string;
}

export class MediaIndexer {
  private prismaManager: PrismaManager;
  private thumbnailDir: string;
  private isScanning = false;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
    this.thumbnailDir = path.join(paths.dataDir, 'thumbnails');
    if (!fs.existsSync(this.thumbnailDir)) {
      fs.mkdirSync(this.thumbnailDir, { recursive: true });
    }
  }

  /**
   * Scans a library root directory in the background (Item 5.13 & P14).
   * Respects user consent: Only scans directories explicitly passed or inside paths.dataDir/photos.
   */
  public async scanLibrary(
    libraryName = 'photos',
    customRootPath?: string
  ): Promise<MediaScanResult> {
    if (this.isScanning) {
      throw new Error('A media indexing scan is already in progress.');
    }

    const rootDir = customRootPath
      ? path.resolve(customRootPath)
      : path.join(paths.dataDir, 'photos');

    if (!fs.existsSync(rootDir)) {
      await fs.promises.mkdir(rootDir, { recursive: true });
    }

    this.isScanning = true;
    logger.info('media-indexer', `Starting media indexing scan for library "${libraryName}" in: ${rootDir}`);

    const result: MediaScanResult = {
      library: libraryName,
      scanned: 0,
      added: 0,
      updated: 0,
      errors: 0,
    };

    const mediaExtensions = new Set([
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
      '.mp4',
      '.webm',
      '.mov',
      '.mkv',
    ]);

    const client = this.prismaManager.getClient();

    const walk = async (currentDir: string) => {
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!mediaExtensions.has(ext)) continue;

            result.scanned++;
            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

            try {
              const stat = await fs.promises.stat(fullPath);
              const mime = getMimeType(fullPath);

              // Upsert into database
              const existing = await client.mediaItem.findUnique({
                where: {
                  library_relativePath: {
                    library: libraryName,
                    relativePath,
                  },
                },
              });

              if (!existing) {
                await client.mediaItem.create({
                  data: {
                    library: libraryName,
                    relativePath,
                    absolutePath: fullPath,
                    filename: entry.name,
                    mimeType: mime,
                    sizeBytes: BigInt(stat.size),
                    mtime: stat.mtime,
                    thumbnailPath: undefined,
                  },
                });
                result.added++;
              } else if (existing.mtime.getTime() !== stat.mtime.getTime()) {
                await client.mediaItem.update({
                  where: { id: existing.id },
                  data: {
                    sizeBytes: BigInt(stat.size),
                    mtime: stat.mtime,
                    absolutePath: fullPath,
                  },
                });
                result.updated++;
              }
            } catch (fileErr: any) {
              result.errors++;
              logger.debug('media-indexer', `Error indexing ${fullPath}: ${fileErr.message}`);
            }
          }
        }
      } catch (dirErr: any) {
        result.errors++;
        logger.warn('media-indexer', `Error reading directory ${currentDir}: ${dirErr.message}`);
      }
    };

    try {
      await walk(rootDir);
      logger.success(
        'media-indexer',
        `Completed scan for "${libraryName}": ${result.scanned} files scanned, ${result.added} added, ${result.updated} updated.`
      );
    } finally {
      this.isScanning = false;
    }

    return result;
  }

  /**
   * Generates or fetches a cached WebP thumbnail for a media item.
   */
  public async getThumbnailPath(mediaId: string, size = 400): Promise<string | null> {
    const client = this.prismaManager.getClient();
    const item = await client.mediaItem.findUnique({
      where: { id: mediaId },
    });

    if (!item || !fs.existsSync(item.absolutePath)) {
      return null;
    }

    const thumbFilename = `thumb_${item.id}_${size}.webp`;
    const cachedPath = path.join(this.thumbnailDir, thumbFilename);

    if (fs.existsSync(cachedPath)) {
      return cachedPath;
    }

    // Attempt thumbnail generation with sharp if available
    try {
      // Dynamic require so sharp is optional
      const sharp = require('sharp');
      await sharp(item.absolutePath)
        .resize({ width: size, height: size, fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(cachedPath);

      await client.mediaItem.update({
        where: { id: mediaId },
        data: { thumbnailPath: thumbFilename },
      });

      return cachedPath;
    } catch {
      // Fallback: return original image if it's already an image
      if (item.mimeType.startsWith('image/')) {
        return item.absolutePath;
      }
      return null;
    }
  }

  /**
   * Fast DB-driven timeline query with pagination (Item 5.13 & A7).
   */
  public async getTimeline(query: TimelineQuery = {}): Promise<{
    items: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 50));
    const skip = (page - 1) * pageSize;

    const client = this.prismaManager.getClient();
    const where = query.library ? { library: query.library } : {};

    const [items, total] = await Promise.all([
      client.mediaItem.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { mtime: 'desc' },
      }),
      client.mediaItem.count({ where }),
    ]);

    const formatted = items.map((i: any) => ({
      id: i.id,
      library: i.library,
      relativePath: i.relativePath,
      filename: i.filename,
      mimeType: i.mimeType,
      sizeBytes: i.sizeBytes.toString(),
      mtime: i.mtime.toISOString(),
      exifDate: i.exifDate?.toISOString() || null,
      width: i.width,
      height: i.height,
      durationSec: i.durationSec,
      thumbnailUrl: `/api/v1/media/thumbnail/${i.id}`,
      streamUrl: `/api/v1/files/stream?path=${encodeURIComponent(i.absolutePath)}`,
    }));

    return {
      items: formatted,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}

export const mediaIndexer = new MediaIndexer(new PrismaManager());
