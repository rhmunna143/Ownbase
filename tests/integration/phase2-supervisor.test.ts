import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { PostgresManager } from '../../src/main/postgres';
import { PrismaManager } from '../../src/main/prisma';
import { ProcessSupervisor } from '../../src/main/supervisor';

describe('Phase 2 Integration: Process Supervisor', () => {
  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');
  const supervisor = new ProcessSupervisor(prismaManager);

  beforeAll(async () => {
    await postgresManager.bootstrap();
    await prismaManager.runMigrations();
  }, 60000);

  afterAll(async () => {
    await supervisor.stopAll();
    await postgresManager.stop();
    await prismaManager.disconnect();
  });

  it('resolves native executables in candidate resource directories', () => {
    const caddyResolved = supervisor.resolveExecutablePath('caddy.exe');
    expect(caddyResolved).toBeDefined();
    expect(fs.existsSync(caddyResolved!)).toBe(true);
  });

  it('registers a managed service and tracks its lifecycle', async () => {
    const testService = {
      id: 'test-filebrowser-service',
      name: 'Test FileBrowser Process',
      type: 'filebrowser',
      executable: 'filebrowser.exe',
      port: 8089,
      status: 'stopped' as const,
      autoStart: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const managed = supervisor.registerService(testService);
    expect(managed.serviceId).toBe('test-filebrowser-service');
    expect(managed.status).toBe('stopped');

    const startResult = await supervisor.startService('test-filebrowser-service');
    expect(startResult.success).toBe(true);
    expect(startResult.pid).toBeDefined();

    const statusAfterStart = supervisor.getStatus('test-filebrowser-service');
    expect(statusAfterStart?.status).toBe('running');

    const stopResult = await supervisor.stopService('test-filebrowser-service');
    expect(stopResult.success).toBe(true);

    const statusAfterStop = supervisor.getStatus('test-filebrowser-service');
    expect(statusAfterStop?.status).toBe('stopped');
  }, 30000);
});
