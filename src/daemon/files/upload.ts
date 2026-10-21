import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import stream from 'stream';
import { logger } from '../core/logger';
import { safeResolvePath } from '../core/pathGuard';
import { storageUsageManager } from '../storage/usage';

export interface UploadOptions {
  targetDirectory: string;
  filename: string;
  maxSizeBytes?: number; // default: 10 GB
  overwrite?: boolean;
}

export interface UploadResult {
  success: boolean;
  finalPath: string;
  bytesWritten: number;
  sha256: string;
  filename: string;
}

export class StreamingUploadEngine {
  /**
   * Streams an incoming readable stream (e.g. HTTP request) directly to disk in the target directory,
   * then atomically renames the file upon completion.
   * Keeps daemon RSS growth under 100 MB for arbitrarily large files (P12 & A6).
   */
  public async handleUpload(
    inputStream: stream.Readable,
    options: UploadOptions
  ): Promise<UploadResult> {
    const { targetDirectory, filename, maxSizeBytes = 10 * 1024 * 1024 * 1024, overwrite = true } = options;

    // Validate path containment and directory existence
    const cleanFilename = path.basename(filename).replace(/[\/\\]/g, '');
    if (!cleanFilename || cleanFilename === '.' || cleanFilename === '..') {
      throw new Error(`Invalid target filename: "${filename}"`);
    }

    const resolvedDir = path.resolve(targetDirectory);
    if (!fs.existsSync(resolvedDir)) {
      await fs.promises.mkdir(resolvedDir, { recursive: true });
    }

    const finalPath = path.join(resolvedDir, cleanFilename);
    if (!overwrite && fs.existsSync(finalPath)) {
      throw new Error(`File "${cleanFilename}" already exists at target destination.`);
    }

    // Temporary upload path on the same directory / volume to enable atomic rename
    const randomHex = crypto.randomBytes(6).toString('hex');
    const tempPath = path.join(resolvedDir, `.tmp_upload_${Date.now()}_${randomHex}`);

    const writeStream = fs.createWriteStream(tempPath, { flags: 'w' });
    const hash = crypto.createHash('sha256');

    let bytesWritten = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        inputStream.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length;

          if (bytesWritten > maxSizeBytes) {
            inputStream.destroy();
            writeStream.destroy();
            reject(
              new Error(
                `Upload exceeded maximum allowed size of ${(maxSizeBytes / (1024 * 1024)).toFixed(0)} MB.`
              )
            );
            return;
          }

          hash.update(chunk);
          const ok = writeStream.write(chunk);
          if (!ok) {
            inputStream.pause();
            writeStream.once('drain', () => inputStream.resume());
          }
        });

        inputStream.on('end', () => {
          writeStream.end(() => resolve());
        });

        inputStream.on('error', (err) => {
          writeStream.destroy();
          reject(err);
        });

        writeStream.on('error', (err) => {
          inputStream.destroy();
          reject(err);
        });
      });

      // Atomic rename from temp file to final destination
      await fs.promises.rename(tempPath, finalPath);

      const digest = hash.digest('hex');
      logger.info(
        'upload',
        `Successfully uploaded "${cleanFilename}" (${(bytesWritten / (1024 * 1024)).toFixed(2)} MB, SHA-256: ${digest.slice(0, 10)}...)`
      );

      return {
        success: true,
        finalPath,
        bytesWritten,
        sha256: digest,
        filename: cleanFilename,
      };
    } catch (err: any) {
      // Clean up orphaned temp file on any error
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch (cleanErr: any) {
        logger.warn('upload', `Failed to unlink temp upload file "${tempPath}": ${cleanErr.message}`);
      }
      throw err;
    }
  }
}

export const uploadEngine = new StreamingUploadEngine();
