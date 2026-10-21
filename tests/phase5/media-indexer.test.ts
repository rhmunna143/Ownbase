import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { mediaIndexer } from '../../src/daemon/files/media';
import { PrismaManager } from '../../src/daemon/db/prisma';

describe('Phase 5 - Item 5.13 & P14 & A7: Photo Indexer & Media Timeline', () => {
  const tempLibraryDir = path.join(os.tmpdir(), `phase5-media-test-${Date.now()}`);
  const prismaManager = new PrismaManager();

  beforeAll(async () => {
    fs.mkdirSync(tempLibraryDir, { recursive: true });

    // Seed test media files
    fs.writeFileSync(path.join(tempLibraryDir, 'summer_beach.jpg'), Buffer.from('fake-jpg-binary'));
    fs.writeFileSync(path.join(tempLibraryDir, 'mountain_hike.png'), Buffer.from('fake-png-binary'));
    fs.writeFileSync(path.join(tempLibraryDir, 'drone_flight.mp4'), Buffer.from('fake-mp4-binary'));
    fs.writeFileSync(path.join(tempLibraryDir, 'notes.txt'), 'ignore non-media text file');
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(tempLibraryDir)) {
        fs.rmSync(tempLibraryDir, { recursive: true, force: true });
      }
      const client = prismaManager.getClient();
      await (client as any).mediaItem.deleteMany({
        where: { library: 'test_photos' },
      });
    } catch {}
  });

  it('scans media library and populates MediaItem table (Item 5.13)', async () => {
    const scanResult = await mediaIndexer.scanLibrary('test_photos', tempLibraryDir);

    expect(scanResult.library).toBe('test_photos');
    expect(scanResult.scanned).toBe(3); // 2 images + 1 video, notes.txt ignored
    expect(scanResult.added).toBe(3);
  });

  it('serves paginated timeline from database in under 300 ms (A7)', async () => {
    const startTime = performance.now();
    const timeline = await mediaIndexer.getTimeline({
      library: 'test_photos',
      page: 1,
      pageSize: 10,
    });
    const queryDurationMs = performance.now() - startTime;

    expect(queryDurationMs).toBeLessThan(300); // SLA A7
    expect(timeline.total).toBe(3);
    expect(timeline.items.length).toBe(3);

    const first = timeline.items[0];
    expect(first.thumbnailUrl).toContain('/api/v1/media/thumbnail/');
    expect(first.streamUrl).toContain('/api/v1/files/stream');
  });
});
