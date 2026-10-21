import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { BackupManager } from '../../src/daemon/backup/manager';
import { secretsManager } from '../../src/daemon/core/secrets';

describe('Phase 7 - Item 7.3: Automated Database Backup & One-Click Restore Engine (PRD §7.4 & A2)', () => {
  let tempBackupsDir: string;
  let backupManager: BackupManager;
  let mockPrismaManager: any;
  let mockDbRecords: Record<string, any[]>;
  let createdBackupJobs: any[] = [];

  beforeAll(() => {
    tempBackupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownbase-backup-test-'));

    mockDbRecords = {
      user: [
        { id: 'usr-1', username: 'rootadmin', role: 'ROOT' },
        { id: 'usr-2', username: 'devops', role: 'ADMIN' },
      ],
      service: [
        { id: 'svc-1', name: 'FileBrowser', templateId: 'filebrowser', port: 8080 },
        { id: 'svc-2', name: 'Ollama AI', templateId: 'ollama', port: 11434 },
      ],
      route: [
        { id: 'rt-1', subdomain: 'files', targetPort: 8080, exposeLocal: true, exposeLan: true },
        { id: 'rt-2', subdomain: 'ai', targetPort: 11434, exposeLocal: true, exposeLan: true },
      ],
      storageVolume: [
        { id: 'vol-c', driveLetter: 'C:', totalBytes: 500000000000n, freeBytes: 250000000000n },
      ],
    };

    mockPrismaManager = {
      getClient: () => ({
        backupJob: {
          create: async ({ data }: any) => {
            const job = { ...data, createdAt: new Date() };
            createdBackupJobs.push(job);
            return job;
          },
          update: async ({ where, data }: any) => {
            const idx = createdBackupJobs.findIndex((j) => j.id === where.id);
            if (idx >= 0) {
              createdBackupJobs[idx] = { ...createdBackupJobs[idx], ...data };
              return createdBackupJobs[idx];
            }
            return data;
          },
          findUnique: async ({ where }: any) => {
            return createdBackupJobs.find((j) => j.id === where.id) || null;
          },
          findMany: async () => [...createdBackupJobs],
          delete: async ({ where }: any) => {
            const idx = createdBackupJobs.findIndex((j) => j.id === where.id);
            if (idx >= 0) createdBackupJobs.splice(idx, 1);
            return { id: where.id };
          },
        },
        user: {
          findMany: async () => [...mockDbRecords.user],
          upsert: async ({ create }: any) => {
            const existingIdx = mockDbRecords.user.findIndex((u) => u.id === create.id);
            if (existingIdx >= 0) mockDbRecords.user[existingIdx] = create;
            else mockDbRecords.user.push(create);
            return create;
          },
        },
        service: {
          findMany: async () => [...mockDbRecords.service],
          upsert: async ({ create }: any) => {
            const existingIdx = mockDbRecords.service.findIndex((s) => s.id === create.id);
            if (existingIdx >= 0) mockDbRecords.service[existingIdx] = create;
            else mockDbRecords.service.push(create);
            return create;
          },
        },
        route: {
          findMany: async () => [...mockDbRecords.route],
          upsert: async ({ create }: any) => {
            const existingIdx = mockDbRecords.route.findIndex((r) => r.id === create.id);
            if (existingIdx >= 0) mockDbRecords.route[existingIdx] = create;
            else mockDbRecords.route.push(create);
            return create;
          },
        },
        storageVolume: {
          findMany: async () => [...mockDbRecords.storageVolume],
          upsert: async ({ create }: any) => {
            const existingIdx = mockDbRecords.storageVolume.findIndex((v) => v.id === create.id);
            if (existingIdx >= 0) mockDbRecords.storageVolume[existingIdx] = create;
            else mockDbRecords.storageVolume.push(create);
            return create;
          },
        },
      }),
    };

    backupManager = new BackupManager(mockPrismaManager, tempBackupsDir);
    (backupManager as any).binDir = '';
  });

  afterAll(() => {
    try {
      fs.rmSync(tempBackupsDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates an encrypted backup archive with valid SHA-256 checksum and security notice', async () => {
    const backup = await backupManager.createBackup({
      name: 'pre-deployment-snapshot',
      trigger: 'manual',
    });

    expect(backup.id).toBeDefined();
    expect(backup.name).toBe('pre-deployment-snapshot');
    expect(fs.existsSync(backup.archivePath)).toBe(true);
    expect(backup.fileSizeBytes).toBeGreaterThan(0);
    expect(backup.checksumSha256).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex

    // Verify file content is encrypted (does not contain plaintext database records)
    const rawContent = fs.readFileSync(backup.archivePath);
    expect(rawContent.toString()).not.toContain('rootadmin');
    expect(rawContent.toString()).not.toContain('filebrowser');

    // Verify BackupJob status in database was updated to completed
    const recordedJob = createdBackupJobs.find((j) => j.id === backup.id);
    expect(recordedJob).toBeDefined();
    expect(recordedJob.status).toBe('completed');
    expect(recordedJob.metadata.securityNotice).toContain('Retain your master secrets key');
  });

  it('rejects restoring tampered or corrupted backup archive with checksum mismatch error', async () => {
    const backup = await backupManager.createBackup({ name: 'tamper-test' });

    // Tamper with archive bytes
    const buffer = fs.readFileSync(backup.archivePath);
    buffer[buffer.length - 1] ^= 0xff; // Flip a bit
    fs.writeFileSync(backup.archivePath, buffer);

    await expect(backupManager.restoreBackup(backup.id)).rejects.toThrow(/checksum mismatch/i);
  });

  it('performs one-click restore recovering database tables and system configurations (Criterion A2)', async () => {
    // 1. Create a pristine backup with known state
    const originalBackup = await backupManager.createBackup({ name: 'golden-state' });

    // 2. Mutate / wipe database records to simulate loss or corrupted migration
    mockDbRecords.user = [{ id: 'usr-rogue', username: 'intruder', role: 'VIEWER' }];
    mockDbRecords.service = [];
    mockDbRecords.route = [];

    expect(mockDbRecords.user.length).toBe(1);
    expect(mockDbRecords.service.length).toBe(0);

    // 3. Perform restore from backup
    const restoreResult = await backupManager.restoreBackup(originalBackup.id);

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.componentsRestored.some((c) => c.startsWith('database_'))).toBe(true);

    // 4. Verify all records are restored
    const rootUser = mockDbRecords.user.find((u) => u.username === 'rootadmin');
    expect(rootUser).toBeDefined();
    expect(rootUser?.role).toBe('ROOT');

    expect(mockDbRecords.service.length).toBe(2);
    expect(mockDbRecords.service.find((s) => s.templateId === 'ollama')).toBeDefined();

    expect(mockDbRecords.route.length).toBe(2);
    expect(mockDbRecords.route.find((r) => r.subdomain === 'files')).toBeDefined();
  });

  it('lists and deletes backup jobs and archive files cleanly', async () => {
    const backup = await backupManager.createBackup({ name: 'delete-me' });
    expect(fs.existsSync(backup.archivePath)).toBe(true);

    const initialList = await backupManager.listBackups();
    expect(initialList.find((b) => b.id === backup.id)).toBeDefined();

    const deleted = await backupManager.deleteBackup(backup.id);
    expect(deleted).toBe(true);

    expect(fs.existsSync(backup.archivePath)).toBe(false);

    const updatedList = await backupManager.listBackups();
    expect(updatedList.find((b) => b.id === backup.id)).toBeUndefined();
  });
});
