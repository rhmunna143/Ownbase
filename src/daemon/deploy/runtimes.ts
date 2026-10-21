import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { execFile } from 'child_process';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import defaultManifest from './runtimes.manifest.json';

export interface RuntimeManifestEntry {
  id: string;
  name: string;
  version: string;
  useHost?: boolean;
  binPath: string;
  url: string;
  sha256: string;
  envVars?: Record<string, string>;
}

export interface ResolvedRuntime {
  id: string;
  name: string;
  version: string;
  executable: string;
  binDir: string;
  isHost: boolean;
  envVars: Record<string, string>;
}

export class RuntimeManager {
  private manifest: Record<string, RuntimeManifestEntry>;
  private runtimesDir: string;

  constructor(customManifest?: Record<string, RuntimeManifestEntry>, customRuntimesDir?: string) {
    this.manifest = customManifest || defaultManifest;
    this.runtimesDir = customRuntimesDir || paths.runtimesDir;
    if (!fs.existsSync(this.runtimesDir)) {
      try {
        fs.mkdirSync(this.runtimesDir, { recursive: true });
      } catch {}
    }
  }

  public getManifest(): Record<string, RuntimeManifestEntry> {
    return { ...this.manifest };
  }

  /**
   * Calculate SHA-256 hash of a file
   */
  public async computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Check if runtime is already unpacked and present
   */
  public isRuntimeInstalled(id: string): boolean {
    const entry = this.manifest[id];
    if (!entry) return false;

    if (entry.useHost && id === 'node') {
      return true;
    }

    const installDir = path.join(this.runtimesDir, `${entry.id}-${entry.version}`);
    const exePath = path.join(installDir, entry.binPath);
    return fs.existsSync(exePath);
  }

  /**
   * Download a file from URL to local destination
   */
  public async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      const request = proto.get(url, (response) => {
        // Handle HTTP redirects (301, 302, 307, 308)
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fs.unlink(destPath, () => {});
          return this.downloadFile(response.headers.location, destPath).then(resolve, reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`Failed to download runtime from ${url}: HTTP ${response.statusCode}`));
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => resolve());
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  }

  /**
   * Extract archive safely into target directory using Windows tar.exe
   */
  public async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      // Windows 10/11 includes bsdtar natively at System32\tar.exe
      const tarExe = process.platform === 'win32' ? 'tar.exe' : 'tar';
      execFile(tarExe, ['-xf', archivePath, '-C', targetDir], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Extraction failed: ${stderr || err.message}`));
        }
        resolve();
      });
    });
  }

  /**
   * Resolves a runtime by id. If not installed, downloads, validates SHA-256, and extracts.
   */
  public async resolveRuntime(id: string): Promise<ResolvedRuntime> {
    const entry = this.manifest[id];
    if (!entry) {
      throw new Error(`Unknown runtime requested: "${id}". Available runtimes: ${Object.keys(this.manifest).join(', ')}`);
    }

    // Reuse host Node if configured or requested
    if (id === 'node' && (entry.useHost || !process.env.OWNBASE_FORCE_STANDALONE_NODE)) {
      const nodeExe = process.execPath;
      const binDir = path.dirname(nodeExe);
      return {
        id: 'node',
        name: 'Node.js (Host LTS)',
        version: process.version,
        executable: nodeExe,
        binDir,
        isHost: true,
        envVars: {},
      };
    }

    const installDir = path.join(this.runtimesDir, `${entry.id}-${entry.version}`);
    const exePath = path.join(installDir, entry.binPath);

    if (fs.existsSync(exePath)) {
      return {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        executable: exePath,
        binDir: path.dirname(exePath),
        isHost: false,
        envVars: entry.envVars || {},
      };
    }

    // Needs installation: download, verify hash, extract
    logger.info('runtime-manager', `Downloading runtime "${entry.name}" (${entry.version}) from ${entry.url}...`);
    const tempArchive = path.join(this.runtimesDir, `temp-${entry.id}-${Date.now()}.archive`);

    try {
      await this.downloadFile(entry.url, tempArchive);

      // Verify SHA-256 hash (Item 4.1 & A7)
      const actualHash = await this.computeFileSha256(tempArchive);
      const expectedHash = entry.sha256.toLowerCase();

      if (actualHash !== expectedHash) {
        throw new Error(
          `Runtime checksum mismatch for "${entry.id}": expected ${expectedHash}, but got ${actualHash}. Installation aborted.`
        );
      }

      logger.info('runtime-manager', `Runtime "${entry.name}" SHA-256 verified successfully (${actualHash}). Extracting...`);
      await this.extractArchive(tempArchive, installDir);

      if (!fs.existsSync(exePath)) {
        throw new Error(
          `Runtime binary missing after extraction: expected executable at "${exePath}"`
        );
      }

      logger.success('runtime-manager', `Runtime "${entry.name}" installed successfully at ${installDir}`);

      return {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        executable: exePath,
        binDir: path.dirname(exePath),
        isHost: false,
        envVars: entry.envVars || {},
      };
    } finally {
      if (fs.existsSync(tempArchive)) {
        try {
          fs.unlinkSync(tempArchive);
        } catch {}
      }
    }
  }

  /**
   * Install or verify an archive locally without downloading (for testing or offline installation)
   */
  public async installLocalArchive(id: string, archivePath: string): Promise<ResolvedRuntime> {
    const entry = this.manifest[id];
    if (!entry) {
      throw new Error(`Unknown runtime: ${id}`);
    }

    const actualHash = await this.computeFileSha256(archivePath);
    const expectedHash = entry.sha256.toLowerCase();

    if (actualHash !== expectedHash) {
      throw new Error(
        `Runtime checksum mismatch for "${entry.id}": expected ${expectedHash}, but got ${actualHash}. Installation aborted.`
      );
    }

    const installDir = path.join(this.runtimesDir, `${entry.id}-${entry.version}`);
    await this.extractArchive(archivePath, installDir);

    const exePath = path.join(installDir, entry.binPath);
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      executable: exePath,
      binDir: path.dirname(exePath),
      isHost: false,
      envVars: entry.envVars || {},
    };
  }
}

export const runtimeManager = new RuntimeManager();
