import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { safeResolvePath, PathSecurityError } from '../core/pathGuard';
import { logger } from '../core/logger';
import { paths } from '../core/paths';

export const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024; // 250 MB
export const MAX_ARCHIVE_FILES = 50_000;

export class SourceIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceIntakeError';
  }
}

export interface GitCloneOptions {
  repoUrl: string;
  targetDir: string;
  branch?: string;
  commitHash?: string;
  gitExecutable?: string;
  onProgress?: (data: string) => void;
}

export interface GitCloneResult {
  success: boolean;
  targetDir: string;
  commitHash?: string;
  error?: string;
}

export interface ArchiveExtractResult {
  success: boolean;
  destinationDir: string;
  fileCount: number;
  extractedBytes: number;
}

export class SourceIntakeManager {
  private gitExecutable: string;

  constructor(customGit?: string) {
    this.gitExecutable = customGit || this.detectGitExecutable();
  }

  private detectGitExecutable(): string {
    const candidatePaths = [
      path.join(paths.runtimesDir, 'mingit-2.45.1', 'cmd', 'git.exe'),
      path.join(paths.extraResourcesDir, 'mingit', 'cmd', 'git.exe'),
    ];

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    // Default to system git
    return 'git';
  }

  /**
   * Clone a git repository with depth 1
   */
  public async cloneGitRepository(options: GitCloneOptions): Promise<GitCloneResult> {
    const { repoUrl, targetDir, branch } = options;

    if (!repoUrl) {
      throw new SourceIntakeError('Repository URL cannot be empty');
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const gitExe = options.gitExecutable || this.gitExecutable;
    const args = ['clone', '--depth', '1'];

    if (branch) {
      args.push('--branch', branch);
    }

    args.push(repoUrl, targetDir);

    logger.info('source-intake', `Cloning ${repoUrl} (branch: ${branch || 'default'}) into ${targetDir}`);

    return new Promise((resolve) => {
      const child = spawn(gitExe, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutText = '';
      let stderrText = '';

      child.stdout?.on('data', (d) => {
        const text = d.toString();
        stdoutText += text;
        if (options.onProgress) options.onProgress(text);
      });

      child.stderr?.on('data', (d) => {
        const text = d.toString();
        stderrText += text;
        if (options.onProgress) options.onProgress(text);
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          targetDir,
          error: `Failed to spawn git: ${err.message}`,
        });
      });

      child.on('exit', (code) => {
        if (code === 0) {
          // Get the latest commit hash
          this.getLatestCommitHash(targetDir, gitExe)
            .then((commitHash) => {
              logger.success('source-intake', `Git clone successful. Commit: ${commitHash || 'unknown'}`);
              resolve({
                success: true,
                targetDir,
                commitHash,
              });
            })
            .catch(() => {
              resolve({
                success: true,
                targetDir,
              });
            });
        } else {
          const errMsg = `git clone exited with code ${code}: ${stderrText || stdoutText}`;
          logger.error('source-intake', errMsg);
          resolve({
            success: false,
            targetDir,
            error: errMsg,
          });
        }
      });
    });
  }

  /**
   * Read the latest commit hash from a local git repository
   */
  public async getLatestCommitHash(repoDir: string, gitExe = this.gitExecutable): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(gitExe, ['rev-parse', 'HEAD'], { cwd: repoDir, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return reject(err || new Error('No output from git rev-parse'));
        resolve(stdout.trim());
      });
    });
  }

  /**
   * Pre-inspect archive contents without extracting to prevent zip bombs and zip-slip attacks (A5)
   */
  public async inspectArchive(archivePath: string): Promise<{ fileCount: number; estimatedSize: number; entries: string[] }> {
    if (!fs.existsSync(archivePath)) {
      throw new SourceIntakeError(`Archive file not found: ${archivePath}`);
    }

    const stat = fs.statSync(archivePath);
    if (stat.size > MAX_ARCHIVE_BYTES) {
      throw new SourceIntakeError(
        `Archive file size (${Math.round(stat.size / (1024 * 1024))} MB) exceeds maximum allowed limit of ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MB`
      );
    }

    return new Promise((resolve, reject) => {
      const tarExe = process.platform === 'win32' ? 'tar.exe' : 'tar';

      // 1. Get clean entry filenames using tar -tf
      execFile(tarExe, ['-tf', archivePath], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (errTf, stdoutTf, stderrTf) => {
        if (errTf) {
          return reject(new SourceIntakeError(`Failed to read archive entries: ${stderrTf || errTf.message}`));
        }

        const entries = stdoutTf
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        const fileCount = entries.length;

        if (fileCount > MAX_ARCHIVE_FILES) {
          return reject(
            new SourceIntakeError(
              `Archive contains ${fileCount} files, exceeding safe limit of ${MAX_ARCHIVE_FILES} files.`
            )
          );
        }

        // 2. Query total uncompressed size with tar -tvf
        execFile(tarExe, ['-tvf', archivePath], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (errTvf, stdoutTvf) => {
          let estimatedSize = 0;
          if (!errTvf && stdoutTvf) {
            const lines = stdoutTvf.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              // bsdtar format: permissions links user group size date time path
              // size is usually part 4 (e.g. -rw-rw-rw- 0 0 0 3523 Oct 21 18:40 path)
              for (const part of parts.slice(1, 6)) {
                const parsed = parseInt(part, 10);
                if (!isNaN(parsed) && parsed > 0 && /^\d+$/.test(part)) {
                  estimatedSize += parsed;
                  break;
                }
              }
            }
          }

          if (estimatedSize > MAX_ARCHIVE_BYTES) {
            return reject(
              new SourceIntakeError(
                `Archive uncompressed size (${Math.round(estimatedSize / (1024 * 1024))} MB) exceeds safe decompression cap of ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MB.`
              )
            );
          }

          resolve({ fileCount, estimatedSize, entries });
        });
      });
    });
  }

  /**
   * Extract archive with strict Zip-Slip protection, PathGuard verification, and size caps (A5)
   */
  public async extractArchiveSafely(archivePath: string, destinationDir: string): Promise<ArchiveExtractResult> {
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
    }

    const canonicalDest = path.resolve(destinationDir);

    // 1. Pre-inspection for decompression bombs and total file count
    const inspection = await this.inspectArchive(archivePath);

    // 2. Validate all entry paths with PathGuard before extracting
    for (const entry of inspection.entries) {
      try {
        safeResolvePath(canonicalDest, entry, { allowNonExistent: true });
      } catch (err: any) {
        if (err instanceof PathSecurityError) {
          throw new SourceIntakeError(
            `Malicious archive entry detected: "${entry}" (${err.message}). Extraction aborted.`
          );
        }
        throw err;
      }
    }

    // 3. Extract using native Windows tar.exe
    await new Promise<void>((resolve, reject) => {
      const tarExe = process.platform === 'win32' ? 'tar.exe' : 'tar';
      execFile(tarExe, ['-xf', archivePath, '-C', canonicalDest], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          return reject(new SourceIntakeError(`Archive extraction failed: ${stderr || err.message}`));
        }
        resolve();
      });
    });

    // 4. Post-extraction recursive PathGuard integrity scan
    let extractedBytes = 0;
    const verifyDirRecursive = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        // Verify path resolution and junction containment
        safeResolvePath(canonicalDest, path.relative(canonicalDest, fullPath));

        if (entry.isDirectory()) {
          verifyDirRecursive(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          extractedBytes += stat.size;
        }
      }
    };

    verifyDirRecursive(canonicalDest);

    if (extractedBytes > MAX_ARCHIVE_BYTES) {
      // Clean up destination directory if size cap exceeded post-extraction
      this.cleanupDirectory(canonicalDest);
      throw new SourceIntakeError(
        `Extracted content (${Math.round(extractedBytes / (1024 * 1024))} MB) exceeded safe decompression limit.`
      );
    }

    logger.success(
      'source-intake',
      `Archive safely extracted: ${inspection.fileCount} files, ${Math.round(extractedBytes / 1024)} KB into ${canonicalDest}`
    );

    return {
      success: true,
      destinationDir: canonicalDest,
      fileCount: inspection.fileCount,
      extractedBytes,
    };
  }

  /**
   * Safely delete a directory and all its contents
   */
  public cleanupDirectory(targetDir: string) {
    if (fs.existsSync(targetDir)) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch (e: any) {
        logger.warn('source-intake', `Cleanup notice for ${targetDir}: ${e.message}`);
      }
    }
  }
}

export const sourceIntakeManager = new SourceIntakeManager();
