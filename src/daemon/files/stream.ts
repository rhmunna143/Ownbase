import http from 'http';
import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';

export interface ParsedRange {
  start: number;
  end: number;
  isSatisfiable: boolean;
}

export function parseRfc7233Range(rangeHeader: string, fileSize: number): ParsedRange | null {
  if (!rangeHeader.startsWith('bytes=')) {
    return null;
  }

  const rangeStr = rangeHeader.slice(6).trim();

  // If comma-separated multiple ranges, take the first range as per single-range requirements
  const firstRange = rangeStr.split(',')[0].trim();
  const dashIdx = firstRange.indexOf('-');

  if (dashIdx === -1) {
    return null;
  }

  const startStr = firstRange.slice(0, dashIdx).trim();
  const endStr = firstRange.slice(dashIdx + 1).trim();

  let start: number;
  let end: number;

  // Case 1: Suffix range (e.g. bytes=-500) -> last 500 bytes of file
  if (startStr === '') {
    if (endStr === '') return null;
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) return null;

    if (suffixLength >= fileSize) {
      start = 0;
    } else {
      start = fileSize - suffixLength;
    }
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    if (isNaN(start) || start < 0) return null;

    if (endStr === '') {
      // Case 2: Open-ended range (e.g. bytes=1024-)
      end = fileSize - 1;
    } else {
      // Case 3: Explicit range (e.g. bytes=0-1023)
      end = parseInt(endStr, 10);
      if (isNaN(end) || end < start) {
        return { start: 0, end: 0, isSatisfiable: false };
      }
    }
  }

  // RFC 7233 §4.4: If start is greater than or equal to current file length, range is unsatisfiable
  if (start >= fileSize || fileSize === 0) {
    return { start: 0, end: 0, isSatisfiable: false };
  }

  // RFC 7233 §2.1: If end is past EOF, clamp end to fileSize - 1
  if (end >= fileSize) {
    end = fileSize - 1;
  }

  return { start, end, isSatisfiable: true };
}

/**
 * Formats Content-Disposition header conforming to RFC 5987 / RFC 6266.
 */
export function formatContentDisposition(filename: string, dispositionType = 'inline'): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
  const encodedName = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');

  return `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`;
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

export class Rfc7233StreamEngine {
  /**
   * Serves file with full RFC 7233 range parsing, ETag, Last-Modified, and If-Range support (P13 & A5).
   */
  public async streamFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    customFilename?: string
  ): Promise<void> {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }

    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Target path is not a regular file' }));
      return;
    }

    const fileSize = stat.size;
    const filename = customFilename || path.basename(filePath);
    const mimeType = getMimeType(filePath);

    // ETag & Last-Modified
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();

    const ifRange = req.headers['if-range'];
    let fulfillRange = true;

    // RFC 7233 §3.2 If-Range evaluation: If If-Range validator fails, return 200 with entire entity
    if (ifRange) {
      if (ifRange !== etag && ifRange !== lastModified) {
        fulfillRange = false;
      }
    }

    const rangeHeader = req.headers.range;

    if (rangeHeader && fulfillRange) {
      const parsedRange = parseRfc7233Range(rangeHeader, fileSize);

      if (!parsedRange || !parsedRange.isSatisfiable) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ error: 'Requested range not satisfiable' }));
        return;
      }

      const { start, end } = parsedRange;
      const chunkLength = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkLength,
        'Content-Type': mimeType,
        'Content-Disposition': formatContentDisposition(filename),
        ETag: etag,
        'Last-Modified': lastModified,
        'Cache-Control': 'public, max-age=3600',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const fileStream = fs.createReadStream(filePath, { start, end });
      fileStream.pipe(res);
      fileStream.on('error', (err) => {
        logger.debug('stream', `Stream read error: ${err.message}`);
        res.destroy();
      });
    } else {
      // Full 200 OK response
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': formatContentDisposition(filename),
        ETag: etag,
        'Last-Modified': lastModified,
        'Cache-Control': 'public, max-age=3600',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      fileStream.on('error', (err) => {
        logger.debug('stream', `Stream read error: ${err.message}`);
        res.destroy();
      });
    }
  }
}

export const streamEngine = new Rfc7233StreamEngine();
