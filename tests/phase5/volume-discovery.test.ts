import { describe, it, expect } from 'vitest';
import { volumeManager } from '../../src/daemon/storage/volumes';

describe('Phase 5 - Item 5.8 & A8: Windows Volume Discovery', () => {
  it('discovers system volumes and reports disk capacity and free space', async () => {
    const volumes = await volumeManager.discoverVolumes(true);

    expect(volumes.length).toBeGreaterThanOrEqual(1);

    const systemVol = volumes.find((v) => v.isSystemDrive);
    expect(systemVol).toBeDefined();
    expect(systemVol?.driveLetter).toMatch(/^[A-Z]:$/);
    expect(systemVol?.totalBytes).toBeGreaterThan(BigInt(0));
    expect(systemVol?.freeBytes).toBeGreaterThan(BigInt(0));
    expect(systemVol?.fileSystem).toBeDefined();
  });

  it('reuses cached volume results when force is false', async () => {
    const v1 = await volumeManager.discoverVolumes(false);
    const v2 = await volumeManager.discoverVolumes(false);

    expect(v1).toBe(v2);
  });
});
