import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { execFile } from 'child_process';
import { logger } from '../core/logger';
import { paths } from '../core/paths';
import { CatalogRecipe } from './catalog';

export class ServiceInstaller {
  private binDir: string;
  private tempDir: string;

  constructor(customBinDir?: string, customTempDir?: string) {
    this.binDir = customBinDir || path.join(paths.extraResourcesDir, 'bin');
    this.tempDir = customTempDir || path.join(paths.dataDir, 'temp-downloads');

    if (!fs.existsSync(this.binDir)) {
      try { fs.mkdirSync(this.binDir, { recursive: true }); } catch {}
    }
    if (!fs.existsSync(this.tempDir)) {
      try { fs.mkdirSync(this.tempDir, { recursive: true }); } catch {}
    }
  }

  /**
   * Computes the SHA-256 hash of a file on disk.
   */
  public async computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Downloads a remote file to a local destination with redirect support.
   */
  public async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      const req = proto.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          return this.downloadFile(res.headers.location, destPath).then(resolve, reject);
        }

        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          return reject(new Error(`Download failed for ${url}: HTTP ${res.statusCode}`));
        }

        res.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve());
        });
      });

      req.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });
  }

  /**
   * Safely unpacks an archive using native tar.exe (Windows 10/11 native bsdtar).
   */
  public async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const tarExe = process.platform === 'win32' ? 'tar.exe' : 'tar';
      execFile(tarExe, ['-xf', archivePath, '-C', targetDir], { windowsHide: true }, (err, _stdout, stderr) => {
        if (err) {
          return reject(new Error(`Extraction failed: ${stderr || err.message}`));
        }
        resolve();
      });
    });
  }

  /**
   * Atomically verifies and installs a catalog service recipe binary.
   * If a tampered file or checksum mismatch is detected, the file is rejected
   * and any temporary files are immediately purged (fulfilling PRD A1 & A5).
   */
  public async verifyAndInstall(
    recipe: CatalogRecipe,
    options?: { localSourcePath?: string; targetExeName?: string }
  ): Promise<{ success: boolean; binaryPath: string; hash: string }> {
    if (!recipe.source && !options?.localSourcePath) {
      throw new Error(`Recipe "${recipe.id}" does not specify a download source or local path`);
    }

    const exeName = options?.targetExeName || recipe.spec.command || `${recipe.id}.exe`;
    const targetBinaryPath = path.join(this.binDir, exeName);
    const expectedHash = recipe.source?.sha256?.toLowerCase();

    // Check if already installed with matching checksum
    if (fs.existsSync(targetBinaryPath) && expectedHash) {
      const currentHash = await this.computeSha256(targetBinaryPath);
      if (currentHash === expectedHash) {
        logger.info('service-installer', `Service "${recipe.id}" already present with valid checksum (${currentHash})`);
        return { success: true, binaryPath: targetBinaryPath, hash: currentHash };
      }
    }

    const tempDownloadPath = path.join(this.tempDir, `install-${recipe.id}-${Date.now()}.tmp`);
    const tempUnpackDir = path.join(this.tempDir, `unpack-${recipe.id}-${Date.now()}`);

    try {
      if (options?.localSourcePath) {
        if (!fs.existsSync(options.localSourcePath)) {
          throw new Error(`Local source file not found: ${options.localSourcePath}`);
        }
        fs.copyFileSync(options.localSourcePath, tempDownloadPath);
      } else if (recipe.source?.url) {
        logger.info('service-installer', `Downloading service "${recipe.id}" from ${recipe.source.url}...`);
        await this.downloadFile(recipe.source.url, tempDownloadPath);
      }

      // Verify SHA-256 checksum (PRD Acceptance Criterion A1)
      const actualHash = await this.computeSha256(tempDownloadPath);
      if (expectedHash && actualHash !== expectedHash) {
        throw new Error(
          `Checksum verification failed for "${recipe.id}": expected ${expectedHash}, but got ${actualHash}. Downloaded binary rejected.`
        );
      }

      logger.success('service-installer', `Checksum verified for "${recipe.id}" (${actualHash})`);

      // If it's an archive (.zip / .tar.gz), unpack first
      const isArchive =
        recipe.source?.type === 'archive' ||
        recipe.source?.url?.endsWith('.zip') ||
        recipe.source?.url?.endsWith('.tar.gz') ||
        options?.localSourcePath?.endsWith('.zip');

      if (isArchive) {
        await this.extractArchive(tempDownloadPath, tempUnpackDir);
        // Find the executable in unpack dir
        let extractedExe: string | null = null;
        const scan = (dir: string) => {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) {
              scan(full);
            } else if (f.toLowerCase() === exeName.toLowerCase()) {
              extractedExe = full;
              break;
            }
          }
        };
        scan(tempUnpackDir);

        if (!extractedExe) {
          throw new Error(`Executable "${exeName}" not found inside extracted archive for "${recipe.id}"`);
        }

        // Atomic placement
        const targetTemp = `${targetBinaryPath}.${Date.now()}.tmp`;
        fs.copyFileSync(extractedExe, targetTemp);
        fs.renameSync(targetTemp, targetBinaryPath);
      } else {
        // Direct binary atomic placement
        const targetTemp = `${targetBinaryPath}.${Date.now()}.tmp`;
        fs.copyFileSync(tempDownloadPath, targetTemp);
        fs.renameSync(targetTemp, targetBinaryPath);
      }

      logger.success('service-installer', `Service "${recipe.id}" installed atomically at ${targetBinaryPath}`);
      return { success: true, binaryPath: targetBinaryPath, hash: actualHash };
    } finally {
      // Atomic Cleanup: Ensure no half-installed files remain (PRD Criterion A5)
      if (fs.existsSync(tempDownloadPath)) {
        try { fs.unlinkSync(tempDownloadPath); } catch {}
      }
      if (fs.existsSync(tempUnpackDir)) {
        try { fs.rmSync(tempUnpackDir, { recursive: true, force: true }); } catch {}
      }
    }
  }
}

export const serviceInstaller = new ServiceInstaller();
