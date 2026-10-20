import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PostgresManager } from '../../src/daemon/db/postgres';

describe('Item 2.6 & D6: Hardened Postgres & Stale Lock Handling', () => {
  let tempPgDir: string;

  beforeEach(() => {
    tempPgDir = path.join(os.tmpdir(), `pg-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
    fs.mkdirSync(tempPgDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempPgDir)) {
        fs.rmSync(tempPgDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('safely removes stale postmaster.pid when process is dead', () => {
    const manager = new PostgresManager(5432);
    (manager as any).dataDir = tempPgDir;

    const pidFile = path.join(tempPgDir, 'postmaster.pid');
    // Write dead PID that definitely does not exist
    fs.writeFileSync(pidFile, '999999\nC:\\fake\\path\n', 'utf-8');

    const removed = manager.handleStalePidLock();
    expect(removed).toBe(true);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('preserves postmaster.pid when process is active and alive', () => {
    const manager = new PostgresManager(5432);
    (manager as any).dataDir = tempPgDir;

    const pidFile = path.join(tempPgDir, 'postmaster.pid');
    // Write our own alive PID
    fs.writeFileSync(pidFile, `${process.pid}\nC:\\fake\\path\n`, 'utf-8');

    const removed = manager.handleStalePidLock();
    // Since PID is alive, it must NOT unlink the lock file
    expect(removed).toBe(false);
    expect(fs.existsSync(pidFile)).toBe(true);
  });
});
