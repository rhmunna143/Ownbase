import fs from 'fs';
import path from 'path';
import http from 'http';
import os from 'os';
import { app } from 'electron';
import { logger } from './logger';
import { safeResolvePath } from './core/pathGuard';
import { FileItem, FileListResponse, PhotoItem, PhotoTimelineSection, PhotosResponse } from '../shared/types';

export class FileManager {
  private storageDir: string;
  private favoritesFile: string;
  private favorites: Set<string> = new Set();

  constructor() {
    let appData: string;
    try {
      appData = (app && typeof app.getPath === 'function')
        ? app.getPath('userData')
        : path.join(process.env.APPDATA || os.homedir(), 'native-windows-server-hub');
    } catch {
      appData = path.join(process.env.APPDATA || os.homedir(), 'native-windows-server-hub');
    }

    this.storageDir = path.join(appData, 'storage');
    this.favoritesFile = path.join(appData, 'photos_favorites.json');

    if (!fs.existsSync(this.storageDir)) {
      try {
        fs.mkdirSync(this.storageDir, { recursive: true });
      } catch (err: any) {
        logger.error('file-manager', `Failed to create storage directory: ${err.message}`);
      }
    }

    this.loadFavorites();
  }

  public getStorageDirectory(): string {
    return this.storageDir;
  }

  private loadFavorites() {
    try {
      if (fs.existsSync(this.favoritesFile)) {
        const raw = fs.readFileSync(this.favoritesFile, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.favorites = new Set(list);
        }
      }
    } catch {
      this.favorites = new Set();
    }
  }

  private saveFavorites() {
    try {
      fs.writeFileSync(this.favoritesFile, JSON.stringify(Array.from(this.favorites), null, 2), 'utf-8');
    } catch (e: any) {
      logger.warn('file-manager', `Failed to save favorites: ${e.message}`);
    }
  }

  public safeResolve(subPath: string = ''): string {
    if (!subPath || subPath.trim() === '') {
      return this.storageDir;
    }
    try {
      return safeResolvePath(this.storageDir, subPath, { allowNonExistent: true });
    } catch {
      // Secure fallback: clamp to storage root on traversal or invalid path format
      return this.storageDir;
    }
  }

  public getRelativePath(absolutePath: string): string {
    const rel = path.relative(this.storageDir, absolutePath);
    return rel.replace(/\\/g, '/');
  }

  public getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      // Video
      case '.mp4': return 'video/mp4';
      case '.mkv': return 'video/x-matroska';
      case '.webm': return 'video/webm';
      case '.mov': return 'video/quicktime';
      case '.avi': return 'video/x-msvideo';
      case '.m4v': return 'video/x-m4v';
      case '.wmv': return 'video/x-ms-wmv';

      // Audio
      case '.mp3': return 'audio/mpeg';
      case '.wav': return 'audio/wav';
      case '.ogg': return 'audio/ogg';
      case '.flac': return 'audio/flac';
      case '.m4a': return 'audio/mp4';
      case '.aac': return 'audio/aac';

      // Images
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.png': return 'image/png';
      case '.webp': return 'image/webp';
      case '.gif': return 'image/gif';
      case '.svg': return 'image/svg+xml';
      case '.bmp': return 'image/bmp';
      case '.ico': return 'image/x-icon';

      // Documents & Text
      case '.json': return 'application/json';
      case '.pdf': return 'application/pdf';
      case '.txt': return 'text/plain; charset=utf-8';
      case '.md': return 'text/markdown; charset=utf-8';
      case '.log': return 'text/plain; charset=utf-8';
      case '.sql': return 'text/plain; charset=utf-8';
      case '.html': return 'text/html; charset=utf-8';
      case '.css': return 'text/css; charset=utf-8';
      case '.js': return 'application/javascript; charset=utf-8';
      case '.ts': return 'text/plain; charset=utf-8';
      default: return 'application/octet-stream';
    }
  }

  public listFiles(subPath: string = ''): FileListResponse {
    const targetDir = this.safeResolve(subPath);

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Directory does not exist: ${subPath}`);
    }

    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      throw new Error(`Target is not a directory: ${subPath}`);
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    let totalSize = 0;

    const items: FileItem[] = [];

    for (const entry of entries) {
      // Skip hidden internal metadata files
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;

      const fullPath = path.join(targetDir, entry.name);
      const relPath = this.getRelativePath(fullPath);
      const isDir = entry.isDirectory();
      let size = 0;
      let mtime = new Date().toISOString();

      try {
        const itemStat = fs.statSync(fullPath);
        size = isDir ? 0 : itemStat.size;
        mtime = itemStat.mtime.toISOString();
        if (!isDir) totalSize += size;
      } catch {
        // Skip unreadable files
      }

      const ext = path.extname(entry.name).toLowerCase();
      const mime = this.getMimeType(entry.name);

      const isVideo = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.wmv'].includes(ext);
      const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp'].includes(ext);
      const isAudio = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(ext);
      const isText = ['.txt', '.json', '.md', '.log', '.sql', '.js', '.ts', '.html', '.css'].includes(ext);

      items.push({
        name: entry.name,
        path: relPath,
        isDirectory: isDir,
        size,
        modifiedAt: mtime,
        extension: ext,
        mimeType: mime,
        isVideo,
        isImage,
        isAudio,
        isText,
      });
    }

    // Sort: directories first (alphabetical), then files (alphabetical)
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const cleanCurrent = this.getRelativePath(targetDir);
    const parentPath = cleanCurrent ? path.dirname(cleanCurrent).replace(/\\/g, '/') : null;

    return {
      currentPath: cleanCurrent,
      parentPath: parentPath === '.' ? '' : parentPath,
      items,
      totalCount: items.length,
      totalSize,
      storageRoot: this.storageDir,
    };
  }

  public streamMedia(subPath: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    const filePath = this.safeResolve(subPath);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `File not found: ${subPath}` }));
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot stream a directory' }));
      return;
    }

    const fileSize = stat.size;
    const mimeType = this.getMimeType(filePath);
    const range = req.headers.range;

    // HTTP 206 Partial Content (Byte-Range requests for mobile video seeking)
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
          'Accept-Ranges': 'bytes',
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });

      fileStream.pipe(res);
    } else {
      // Full stream
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  }

  public downloadFile(subPath: string, res: http.ServerResponse): void {
    const filePath = this.safeResolve(subPath);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `File not found: ${subPath}` }));
      return;
    }

    const filename = path.basename(filePath);
    const stat = fs.statSync(filePath);
    const mimeType = this.getMimeType(filePath);

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Access-Control-Allow-Origin': '*',
    });

    fs.createReadStream(filePath).pipe(res);
  }

  public createDirectory(targetSubPath: string, folderName: string): boolean {
    const parentDir = this.safeResolve(targetSubPath);
    const newDir = path.join(parentDir, folderName.replace(/[\/\\:*?"<>|]/g, '_'));
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
      return true;
    }
    return false;
  }

  public renameItem(oldSubPath: string, newName: string): boolean {
    const oldPath = this.safeResolve(oldSubPath);
    if (!fs.existsSync(oldPath)) {
      throw new Error('Item to rename does not exist');
    }
    const targetDir = path.dirname(oldPath);
    const cleanName = newName.replace(/[\/\\:*?"<>|]/g, '_');
    const newPath = path.join(targetDir, cleanName);
    fs.renameSync(oldPath, newPath);
    return true;
  }

  public deleteItem(subPath: string): boolean {
    const itemPath = this.safeResolve(subPath);
    if (!fs.existsSync(itemPath)) {
      throw new Error('Item does not exist');
    }

    // Never delete the storage root itself
    if (path.resolve(itemPath) === path.resolve(this.storageDir)) {
      throw new Error('Cannot delete storage root directory');
    }

    fs.rmSync(itemPath, { recursive: true, force: true });
    this.favorites.delete(subPath);
    this.saveFavorites();
    return true;
  }

  public readFileContent(subPath: string): string {
    const filePath = this.safeResolve(subPath);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      throw new Error('File is too large to preview directly (exceeds 2 MB)');
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  public saveFileBuffer(targetSubPath: string, filename: string, buffer: Buffer): string {
    const parentDir = this.safeResolve(targetSubPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const cleanName = filename.replace(/[\/\\:*?"<>|]/g, '_');
    const destPath = path.join(parentDir, cleanName);
    fs.writeFileSync(destPath, buffer);
    return this.getRelativePath(destPath);
  }

  public toggleFavorite(subPath: string): boolean {
    if (this.favorites.has(subPath)) {
      this.favorites.delete(subPath);
    } else {
      this.favorites.add(subPath);
    }
    this.saveFavorites();
    return this.favorites.has(subPath);
  }

  public isFavorite(subPath: string): boolean {
    return this.favorites.has(subPath);
  }

  // --- Google Photos & Memories Engine ---
  public getPhotosTimeline(filter: { favoritesOnly?: boolean; type?: 'all' | 'photo' | 'video' } = {}): PhotosResponse {
    const allMediaItems: PhotoItem[] = [];

    const scanDirectory = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            scanDirectory(fullPath);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext);
            const isVideo = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'].includes(ext);

            if (!isImage && !isVideo) continue;

            const relPath = this.getRelativePath(fullPath);
            const isFav = this.favorites.has(relPath);

            if (filter.favoritesOnly && !isFav) continue;
            if (filter.type === 'photo' && !isImage) continue;
            if (filter.type === 'video' && !isVideo) continue;

            let stat: fs.Stats;
            try {
              stat = fs.statSync(fullPath);
            } catch {
              continue;
            }

            const mtime = stat.mtime;
            const itemDate = mtime.toISOString();
            const groupKey = this.formatDateGroup(mtime);

            allMediaItems.push({
              id: relPath,
              name: entry.name,
              path: relPath,
              type: isVideo ? 'video' : 'photo',
              mimeType: this.getMimeType(entry.name),
              size: stat.size,
              date: itemDate,
              dateFormatted: mtime.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              }),
              groupKey,
              mediaUrl: `/api/photos/media?path=${encodeURIComponent(relPath)}`,
              streamUrl: `/api/files/stream?path=${encodeURIComponent(relPath)}`,
              isFavorite: isFav,
            });
          }
        }
      } catch (err: any) {
        logger.warn('file-manager', `Error scanning directory ${dir}: ${err.message}`);
      }
    };

    scanDirectory(this.storageDir);

    // Also scan Windows user Pictures folder if it exists
    const userPictures = path.join(os.homedir(), 'Pictures');
    if (fs.existsSync(userPictures) && fs.statSync(userPictures).isDirectory()) {
      // scan top 2 levels of user Pictures
      this.scanFolderWithMaxDepth(userPictures, 2, allMediaItems, filter);
    }

    // Sort descending by date (most recent photos first)
    allMediaItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Group into Timeline Sections
    const groupsMap = new Map<string, PhotoItem[]>();
    let photosCount = 0;
    let videosCount = 0;

    for (const item of allMediaItems) {
      if (item.type === 'photo') photosCount++;
      if (item.type === 'video') videosCount++;

      if (!groupsMap.has(item.groupKey)) {
        groupsMap.set(item.groupKey, []);
      }
      groupsMap.get(item.groupKey)!.push(item);
    }

    const timeline: PhotoTimelineSection[] = [];
    for (const [dateHeader, items] of groupsMap.entries()) {
      timeline.push({ dateHeader, items });
    }

    return {
      timeline,
      totalCount: allMediaItems.length,
      photosCount,
      videosCount,
    };
  }

  private scanFolderWithMaxDepth(
    dir: string,
    depth: number,
    results: PhotoItem[],
    filter: { favoritesOnly?: boolean; type?: 'all' | 'photo' | 'video' }
  ) {
    if (depth <= 0) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.scanFolderWithMaxDepth(full, depth - 1, results, filter);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
          const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
          if (!isImage && !isVideo) continue;

          const relPath = full; // absolute path for external media
          const isFav = this.favorites.has(relPath);
          if (filter.favoritesOnly && !isFav) continue;
          if (filter.type === 'photo' && !isImage) continue;
          if (filter.type === 'video' && !isVideo) continue;

          const stat = fs.statSync(full);
          const mtime = stat.mtime;

          results.push({
            id: relPath,
            name: entry.name,
            path: relPath,
            type: isVideo ? 'video' : 'photo',
            mimeType: this.getMimeType(entry.name),
            size: stat.size,
            date: mtime.toISOString(),
            dateFormatted: mtime.toLocaleDateString('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            }),
            groupKey: this.formatDateGroup(mtime),
            mediaUrl: `/api/photos/media?path=${encodeURIComponent(relPath)}`,
            streamUrl: `/api/files/stream?path=${encodeURIComponent(relPath)}`,
            isFavorite: isFav,
          });
        }
      }
    } catch {
      // ignore access denied in windows user folders
    }
  }

  private formatDateGroup(date: Date): string {
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return 'Yesterday';

    // Same year: e.g. "October 2026"
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
}
