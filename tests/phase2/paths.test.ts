import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PathsManager } from '../../src/daemon/core/paths';

describe('Item 2.1: Paths Resolution & Legacy Migration', () => {
  let tempTestDir: string;

  beforeEach(() => {
    tempTestDir = path.join(os.tmpdir(), `ownbase-paths-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(tempTestDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('correctly resolves service mode to ProgramData\\Ownbase', () => {
    const manager = new PathsManager('service');
    const p = manager.getPaths();
    expect(manager.getMode()).toBe('service');
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    expect(p.dataDir.toLowerCase()).toBe(path.join(programData, 'Ownbase').toLowerCase());
    expect(p.postgresDir).toBe(path.join(p.dataDir, 'postgres'));
    expect(p.storageDir).toBe(path.join(p.dataDir, 'storage'));
    expect(p.secretsDir).toBe(path.join(p.dataDir, 'secrets'));
  });

  it('correctly resolves dev mode to .data', () => {
    const manager = new PathsManager('dev');
    const p = manager.getPaths();
    expect(manager.getMode()).toBe('dev');
    expect(p.dataDir).toBe(path.resolve(process.cwd(), '.data'));
  });

  it('correctly resolves portable mode to custom or executable data directory', () => {
    const customData = path.join(tempTestDir, 'portable-data');
    const manager = new PathsManager('portable', customData);
    const p = manager.getPaths();
    expect(manager.getMode()).toBe('portable');
    expect(p.dataDir).toBe(path.resolve(customData));
    expect(fs.existsSync(p.dataDir)).toBe(true);
    expect(fs.existsSync(p.postgresDir)).toBe(true);
  });

  it('performs legacy data migration when target is empty and writes marker', () => {
    const targetData = path.join(tempTestDir, 'new-data');
    const legacyFake = path.join(tempTestDir, 'fake-appdata', 'native-windows-server-hub');
    fs.mkdirSync(legacyFake, { recursive: true });
    fs.writeFileSync(path.join(legacyFake, 'legacy-secret.txt'), 'secret123', 'utf-8');

    // Override APPDATA temporarily
    const originalAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tempTestDir, 'fake-appdata');

    try {
      const manager = new PathsManager('dev', targetData);
      const res = manager.migrateLegacyDataIfNeeded();
      expect(res.migrated).toBe(true);
      expect(res.source).toBe(legacyFake);

      // Verify copied content
      const migratedSecret = path.join(targetData, 'legacy-secret.txt');
      expect(fs.existsSync(migratedSecret)).toBe(true);
      expect(fs.readFileSync(migratedSecret, 'utf-8')).toBe('secret123');

      // Verify migration marker
      const markerPath = path.join(targetData, 'legacy-migration.json');
      expect(fs.existsSync(markerPath)).toBe(true);

      // Second run should be skipped
      const res2 = manager.migrateLegacyDataIfNeeded();
      expect(res2.migrated).toBe(false);
    } finally {
      process.env.APPDATA = originalAppData;
    }
  });
});
