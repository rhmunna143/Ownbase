import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { storagePlacementManager } from '../../src/daemon/storage/placement';
import { storageUsageManager } from '../../src/daemon/storage/usage';

describe('Phase 5 - Item 5.9 & Item 5.10 & A8: Storage Placement & Directory Junctions', () => {
  const testBaseDir = path.join(os.tmpdir(), `phase5-storage-test-${Date.now()}`);
  const targetDataDir = path.join(testBaseDir, 'target_volume_data');
  const junctionLinkPath = path.join(testBaseDir, 'links', 'service_mount');

  beforeAll(() => {
    fs.mkdirSync(testBaseDir, { recursive: true });
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testBaseDir)) {
        fs.rmSync(testBaseDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('creates an NTFS directory junction link to target directory without shell mklink (Item 5.9)', async () => {
    const createdLink = await storagePlacementManager.createJunction(targetDataDir, junctionLinkPath);

    expect(fs.existsSync(createdLink)).toBe(true);

    const lstat = fs.lstatSync(createdLink);
    expect(lstat.isSymbolicLink()).toBe(true);
  });

  it('verifies writing through junction link persists directly to target storage volume (A8)', async () => {
    const fileInLink = path.join(junctionLinkPath, 'test_write.txt');
    fs.writeFileSync(fileInLink, 'Hello from Phase 5 native junction storage!', 'utf8');

    // Check that file actually exists in the target storage directory
    const fileInTarget = path.join(targetDataDir, 'test_write.txt');
    expect(fs.existsSync(fileInTarget)).toBe(true);
    expect(fs.readFileSync(fileInTarget, 'utf8')).toBe('Hello from Phase 5 native junction storage!');
  });

  it('safely unlinks directory junction without touching files in the target directory', async () => {
    const unlinked = await storagePlacementManager.removeJunction(junctionLinkPath);
    expect(unlinked).toBe(true);

    // Junction link is gone
    expect(fs.existsSync(junctionLinkPath)).toBe(false);

    // Target directory and its files still exist completely intact!
    const fileInTarget = path.join(targetDataDir, 'test_write.txt');
    expect(fs.existsSync(fileInTarget)).toBe(true);
    expect(fs.readFileSync(fileInTarget, 'utf8')).toBe('Hello from Phase 5 native junction storage!');
  });

  it('calculates recursive directory size and enforces soft quotas (Item 5.10)', async () => {
    const size = await storageUsageManager.calculateDirectorySize(targetDataDir);
    expect(size).toBeGreaterThan(BigInt(0));

    // Check quota logic
    const quotaCheck = await storageUsageManager.checkQuota(junctionLinkPath, 1024);
    expect(quotaCheck.allowed).toBe(true);
  });
});
