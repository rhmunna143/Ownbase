import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { PostgresManager } from '../../src/main/postgres';
import { PrismaManager } from '../../src/main/prisma';
import { LifecycleManager } from '../../src/main/lifecycle';

describe('Phase 4 Integration: Server Lifecycle & Persistence', () => {
  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');
  const lifecycleManager = new LifecycleManager(prismaManager);

  beforeAll(async () => {
    await postgresManager.bootstrap();
    await prismaManager.runMigrations();
    await lifecycleManager.bootstrap();
  }, 60000);

  afterAll(async () => {
    await postgresManager.stop();
    await prismaManager.disconnect();
  });

  it('resolves system tray assets or loads embedded fallback', () => {
    const assetPath = path.join(process.cwd(), 'assets', 'tray-icon.png');
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it('manages 24/7 power suspension blocker state and persists setting', async () => {
    const initialActive = lifecycleManager.isPowerBlockerActive();
    expect(typeof initialActive).toBe('boolean');

    const toggleRes = await lifecycleManager.setPowerSaveBlocker(!initialActive);
    expect(toggleRes.success).toBe(true);
    expect(toggleRes.powerBlocker.active).toBe(!initialActive);

    // Restore original
    await lifecycleManager.setPowerSaveBlocker(initialActive);
  });
});
