import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parseRfc7233Range,
  formatContentDisposition,
  streamEngine,
  getMimeType,
} from '../../src/daemon/files/stream';

describe('Phase 5 - Item 5.12 & P13 & A5: RFC 7233 Byte-Range Streaming', () => {
  const tempDir = path.join(os.tmpdir(), `phase5-stream-test-${Date.now()}`);
  const fixturePath = path.join(tempDir, 'sample_video.mp4');
  const fixtureSize = 5000; // 5000 bytes fixture

  let server: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });

    // Create 5000-byte test binary file with known sequential bytes
    const buffer = Buffer.alloc(fixtureSize);
    for (let i = 0; i < fixtureSize; i++) {
      buffer[i] = i % 256;
    }
    fs.writeFileSync(fixturePath, buffer);

    server = http.createServer(async (req, res) => {
      await streamEngine.streamFile(req, res, fixturePath, 'sample_video.mp4');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('Range Parser Unit Tests (P13)', () => {
    it('parses standard explicit range bytes=0-499', () => {
      const parsed = parseRfc7233Range('bytes=0-499', fixtureSize);
      expect(parsed).toEqual({ start: 0, end: 499, isSatisfiable: true });
    });

    it('parses open-ended range bytes=1000-', () => {
      const parsed = parseRfc7233Range('bytes=1000-', fixtureSize);
      expect(parsed).toEqual({ start: 1000, end: 4999, isSatisfiable: true });
    });

    it('parses suffix range bytes=-500 (last 500 bytes without NaN)', () => {
      const parsed = parseRfc7233Range('bytes=-500', fixtureSize);
      expect(parsed).toEqual({ start: 4500, end: 4999, isSatisfiable: true });
    });

    it('clamps end to fileSize - 1 when range extends past EOF', () => {
      const parsed = parseRfc7233Range('bytes=0-999999', fixtureSize);
      expect(parsed).toEqual({ start: 0, end: 4999, isSatisfiable: true });
    });

    it('rejects unsatisfiable start past EOF (returns isSatisfiable: false -> 416)', () => {
      const parsed = parseRfc7233Range('bytes=6000-7000', fixtureSize);
      expect(parsed?.isSatisfiable).toBe(false);
    });

    it('rejects inverted range where start > end', () => {
      const parsed = parseRfc7233Range('bytes=500-200', fixtureSize);
      expect(parsed?.isSatisfiable).toBe(false);
    });
  });

  describe('Content-Disposition Formatting (RFC 5987)', () => {
    it('formats RFC 5987 compliant header with unicode filename* parameter', () => {
      const header = formatContentDisposition('vacation_photo_📷.jpg');
      expect(header).toContain('inline;');
      expect(header).toContain('filename*=UTF-8\'\'vacation_photo_');
      // Must not contain raw quotes around encodedURIComponent
      expect(header).not.toContain('filename="encodeURIComponent');
    });
  });

  describe('HTTP Server Streaming Integration Tests (A5)', () => {
    it('serves full 200 OK when no Range header is provided', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(res.headers.get('content-length')).toBe(String(fixtureSize));
      expect(res.headers.get('content-type')).toBe('video/mp4');

      const body = await res.arrayBuffer();
      expect(body.byteLength).toBe(fixtureSize);
    });

    it('serves 206 Partial Content with correct Content-Range for bytes=100-199', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/`, {
        headers: { Range: 'bytes=100-199' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes 100-199/${fixtureSize}`);
      expect(res.headers.get('content-length')).toBe('100');

      const body = await res.arrayBuffer();
      expect(body.byteLength).toBe(100);

      // Verify actual byte values match slice
      const bytes = new Uint8Array(body);
      expect(bytes[0]).toBe(100 % 256);
      expect(bytes[99]).toBe(199 % 256);
    });

    it('serves 206 Partial Content for suffix range bytes=-500', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/`, {
        headers: { Range: 'bytes=-500' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes 4500-4999/${fixtureSize}`);
      expect(res.headers.get('content-length')).toBe('500');

      const body = await res.arrayBuffer();
      expect(body.byteLength).toBe(500);
    });

    it('returns HTTP 416 Range Not Satisfiable when range is beyond EOF', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/`, {
        headers: { Range: 'bytes=10000-11000' },
      });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe(`bytes */${fixtureSize}`);
    });
  });
});
