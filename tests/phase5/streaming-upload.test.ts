import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import stream from 'stream';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { uploadEngine } from '../../src/daemon/files/upload';

describe('Phase 5 - Item 5.11 & P12 & A6: Streaming Upload Engine', () => {
  const tempDir = path.join(os.tmpdir(), `phase5-upload-test-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('streams chunked input stream directly to disk temp file and renames atomically', async () => {
    const chunkCount = 100;
    const chunkSize = 10 * 1024; // 10 KB * 100 = 1 MB stream
    let totalBytes = 0;

    const sourceHash = crypto.createHash('sha256');

    // Create a generator stream producing chunks
    const inputStream = new stream.Readable({
      read() {
        if (totalBytes < chunkCount * chunkSize) {
          const chunk = crypto.randomBytes(chunkSize);
          sourceHash.update(chunk);
          totalBytes += chunk.length;
          this.push(chunk);
        } else {
          this.push(null);
        }
      },
    });

    const expectedHash = sourceHash; // will be finalized after all chunks pushed

    const initialRss = process.memoryUsage().rss;

    const result = await uploadEngine.handleUpload(inputStream, {
      targetDirectory: tempDir,
      filename: 'uploaded_document.dat',
      maxSizeBytes: 50 * 1024 * 1024,
    });

    const finalRss = process.memoryUsage().rss;
    const rssGrowthMb = (finalRss - initialRss) / (1024 * 1024);

    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe(chunkCount * chunkSize);
    expect(fs.existsSync(result.finalPath)).toBe(true);
    expect(path.basename(result.finalPath)).toBe('uploaded_document.dat');

    // Verify bounded memory growth (< 100 MB as per A6)
    expect(rssGrowthMb).toBeLessThan(100);

    // Verify no temporary files remain in upload directory
    const remainingFiles = fs.readdirSync(tempDir);
    const hasTempFile = remainingFiles.some((f) => f.startsWith('.tmp_upload_'));
    expect(hasTempFile).toBe(false);

    // Verify SHA-256 integrity
    const fileContent = fs.readFileSync(result.finalPath);
    const actualHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    expect(result.sha256).toBe(actualHash);
  });

  it('rejects uploads exceeding maximum size limit and purges temp file', async () => {
    const inputStream = new stream.Readable({
      read() {
        this.push(Buffer.alloc(1024 * 1024, 'A')); // 1 MB chunks
      },
    });

    await expect(
      uploadEngine.handleUpload(inputStream, {
        targetDirectory: tempDir,
        filename: 'oversized_file.dat',
        maxSizeBytes: 2 * 1024 * 1024, // 2 MB max
      })
    ).rejects.toThrow(/Upload exceeded maximum allowed size/);

    // Verify temp file was cleaned up immediately
    const files = fs.readdirSync(tempDir);
    const tempFiles = files.filter((f) => f.startsWith('.tmp_upload_'));
    expect(tempFiles.length).toBe(0);
  });
});
