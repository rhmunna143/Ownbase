import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import { secretsManager } from '../core/secrets';
import { configManager } from '../core/config';
import { PrismaManager } from '../db/prisma';

export interface BackupMetadata {
  id: string;
  name: string;
  createdAt: string;
  version: string;
  databaseName: string;
  components: string[];
  securityNotice: string;
  recordCounts?: Record<string, number>;
}

export interface BackupArchiveContent {
  manifest: BackupMetadata;
  config: any;
  secretsKeyEncrypted: string;
  databaseDump?: string;
  databaseTables?: Record<string, any[]>;
}

export interface BackupResult {
  id: string;
  name: string;
  archivePath: string;
  fileSizeBytes: number;
  checksumSha256: string;
  createdAt: string;
}

export interface RestoreResult {
  success: boolean;
  backupId: string;
  restoredAt: string;
  componentsRestored: string[];
  recordsRestored: Record<string, number>;
  message: string;
}

export class BackupManager {
  private prismaManager: PrismaManager;
  private backupsDir: string;
  private binDir: string = '';
  private scheduledInterval?: NodeJS.Timeout;

  constructor(prismaManager: PrismaManager, customBackupsDir?: string) {
    this.prismaManager = prismaManager;
    this.backupsDir = customBackupsDir || paths.backupsDir;
    this.ensureBackupsDir();
    this.resolveBinDir();
  }

  private ensureBackupsDir() {
    try {
      if (!fs.existsSync(this.backupsDir)) {
        fs.mkdirSync(this.backupsDir, { recursive: true });
      }
    } catch (err: any) {
      logger.error('backup', `Failed to create backups directory: ${err.message}`);
    }
  }

  private resolveBinDir() {
    const candidateDirs = [
      path.join(paths.extraResourcesDir, 'pgsql', 'bin'),
      path.join(paths.extraResourcesDir, 'bin'),
      path.join(paths.runtimesDir, 'pgsql', 'bin'),
      path.join(process.cwd(), 'extraResources', 'pgsql', 'bin'),
    ];

    for (const cand of candidateDirs) {
      if (fs.existsSync(path.join(cand, 'pg_dump.exe'))) {
        this.binDir = cand;
        break;
      }
    }
  }

  /**
   * Creates an encrypted backup archive containing the database, config, and encrypted secrets key.
   */
  public async createBackup(options?: {
    name?: string;
    trigger?: 'manual' | 'scheduled';
    targetVolumePath?: string;
  }): Promise<BackupResult> {
    const backupId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = options?.name || `ownbase-backup-${timestamp}`;
    const destinationDir = options?.targetVolumePath || this.backupsDir;

    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
    }

    const archiveFileName = `${backupName}-${backupId.slice(0, 8)}.ownbase.bak`;
    const archivePath = path.join(destinationDir, archiveFileName);

    logger.info('backup', `Starting automated backup "${backupName}" (ID: ${backupId})...`);

    // Record BackupJob in database (status: running)
    const prisma = this.prismaManager.getClient();
    let dbJobCreated = false;
    try {
      if ((prisma as any).backupJob) {
        await (prisma as any).backupJob.create({
          data: {
            id: backupId,
            name: backupName,
            status: 'running',
            archivePath,
            trigger: options?.trigger || 'manual',
            isEncrypted: true,
            components: ['database', 'config', 'secrets_key'],
          },
        });
        dbJobCreated = true;
      }
    } catch (err: any) {
      logger.warn('backup', `Database recording notice: ${err.message}`);
    }

    try {
      // 1. Gather manifest & security notice
      const manifest: BackupMetadata = {
        id: backupId,
        name: backupName,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
        databaseName: 'postgres',
        components: ['database', 'config', 'secrets_key'],
        securityNotice:
          'IMPORTANT: Retain your master secrets key. If lost, encrypted credentials cannot be decrypted.',
        recordCounts: {},
      };

      // 2. Export database: either pg_dump or high-fidelity structured table export
      let databaseDump: string | undefined;
      let databaseTables: Record<string, any[]> | undefined;

      const pgDumpExe = path.join(this.binDir, 'pg_dump.exe');
      if (fs.existsSync(pgDumpExe)) {
        try {
          databaseDump = await this.executePgDump(pgDumpExe);
          manifest.recordCounts!['database_sql_bytes'] = databaseDump.length;
        } catch (dumpErr: any) {
          logger.warn('backup', `pg_dump failed (${dumpErr.message}), falling back to structured table export`);
          databaseTables = await this.exportTablesViaPrisma(prisma, manifest);
        }
      } else {
        databaseTables = await this.exportTablesViaPrisma(prisma, manifest);
      }

      // 3. Gather daemon configuration
      const config = configManager.getConfig();

      // 4. Encrypt master data key for disaster recovery
      const dataKey = secretsManager.getOrCreateDataKey();
      const secretsKeyEncrypted = secretsManager.encrypt(dataKey.toString('hex'));

      // 5. Construct payload archive
      const payload: BackupArchiveContent = {
        manifest,
        config,
        secretsKeyEncrypted,
        databaseDump,
        databaseTables,
      };

      const payloadJson = JSON.stringify(payload, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      );

      // 6. Encrypt archive using AES-256-GCM
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
      let encrypted = cipher.update(payloadJson, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Archive format: [IV (12 bytes)][AuthTag (16 bytes)][Encrypted Payload]
      const archiveBuffer = Buffer.concat([iv, authTag, encrypted]);

      // Calculate SHA-256 checksum
      const checksumSha256 = crypto.createHash('sha256').update(archiveBuffer).digest('hex');

      // Atomic file write
      const tempPath = `${archivePath}.tmp`;
      fs.writeFileSync(tempPath, archiveBuffer);
      fs.renameSync(tempPath, archivePath);

      const fileSizeBytes = archiveBuffer.length;

      // Update BackupJob in database
      if (dbJobCreated) {
        await (prisma as any).backupJob.update({
          where: { id: backupId },
          data: {
            status: 'completed',
            archivePath,
            fileSizeBytes: BigInt(fileSizeBytes),
            checksumSha256,
            metadata: manifest as any,
            completedAt: new Date(),
          },
        });
      }

      logger.success(
        'backup',
        `Backup completed successfully: "${archiveFileName}" (${(fileSizeBytes / 1024).toFixed(1)} KB, SHA-256: ${checksumSha256.slice(0, 10)}...)`
      );

      return {
        id: backupId,
        name: backupName,
        archivePath,
        fileSizeBytes,
        checksumSha256,
        createdAt: manifest.createdAt,
      };
    } catch (err: any) {
      logger.error('backup', `Backup failed: ${err.message}`);
      if (dbJobCreated) {
        await (prisma as any).backupJob
          .update({
            where: { id: backupId },
            data: {
              status: 'failed',
              error: err.message,
              completedAt: new Date(),
            },
          })
          .catch(() => {});
      }
      throw err;
    }
  }

  /**
   * One-click restore recovering database, configuration, routes, and services from an archive.
   */
  public async restoreBackup(jobIdOrPath: string): Promise<RestoreResult> {
    logger.info('backup', `Initiating restore from "${jobIdOrPath}"...`);

    let archivePath = jobIdOrPath;

    // Check if parameter is a BackupJob ID
    const prisma = this.prismaManager.getClient();
    let expectedChecksum: string | undefined;

    try {
      if ((prisma as any).backupJob) {
        const job = await (prisma as any).backupJob.findUnique({
          where: { id: jobIdOrPath },
        });
        if (job && job.archivePath) {
          archivePath = job.archivePath;
          expectedChecksum = job.checksumSha256 || undefined;
        }
      }
    } catch {}

    if (!fs.existsSync(archivePath)) {
      throw new Error(`Backup archive not found at path: ${archivePath}`);
    }

    // 1. Read archive buffer & verify integrity
    const archiveBuffer = fs.readFileSync(archivePath);

    if (expectedChecksum) {
      const computedHash = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
      if (computedHash !== expectedChecksum) {
        throw new Error(
          `Integrity checksum mismatch! Expected: ${expectedChecksum}, Computed: ${computedHash}. Archive may be tampered or corrupted.`
        );
      }
    }

    if (archiveBuffer.length < 28) {
      throw new Error('Invalid archive format: file is smaller than header size.');
    }

    // 2. Decrypt archive using master key
    const dataKey = secretsManager.getOrCreateDataKey();
    const iv = archiveBuffer.subarray(0, 12);
    const authTag = archiveBuffer.subarray(12, 28);
    const encryptedData = archiveBuffer.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, iv);
    decipher.setAuthTag(authTag);

    let decryptedJson: string;
    try {
      decryptedJson = decipher.update(encryptedData, undefined, 'utf8');
      decryptedJson += decipher.final('utf8');
    } catch (decryptErr: any) {
      throw new Error(
        `Failed to decrypt backup archive: ${decryptErr.message}. Ensure the master secrets key matches the one used to create the backup.`
      );
    }

    const content: BackupArchiveContent = JSON.parse(decryptedJson);
    const { manifest, config, databaseDump, databaseTables } = content;

    const recordsRestored: Record<string, number> = {};
    const componentsRestored: string[] = [];

    // 3. Restore Database
    const psqlExe = path.join(this.binDir, 'psql.exe');
    if (databaseDump && fs.existsSync(psqlExe)) {
      await this.executePsqlRestore(psqlExe, databaseDump);
      componentsRestored.push('database_pg_dump');
      recordsRestored['database_sql_bytes'] = databaseDump.length;
    } else if (databaseTables) {
      // Structured table restore
      const counts = await this.restoreTablesViaPrisma(prisma, databaseTables);
      Object.assign(recordsRestored, counts);
      componentsRestored.push('database_tables');
    }

    // 4. Restore configuration if present
    if (config) {
      try {
        configManager.updateConfig(config);
        componentsRestored.push('config');
      } catch (confErr: any) {
        logger.warn('backup', `Failed to apply restored config: ${confErr.message}`);
      }
    }

    const restoredAt = new Date().toISOString();
    logger.success('backup', `Restore completed successfully for backup ID: ${manifest.id}`);

    return {
      success: true,
      backupId: manifest.id,
      restoredAt,
      componentsRestored,
      recordsRestored,
      message: 'System state, database, and configurations restored successfully.',
    };
  }

  /**
   * Lists all available backups from the database and directory.
   */
  public async listBackups(): Promise<any[]> {
    const prisma = this.prismaManager.getClient();
    let dbJobs: any[] = [];
    try {
      if ((prisma as any).backupJob) {
        const found = await (prisma as any).backupJob.findMany({
          orderBy: { createdAt: 'desc' },
        });
        if (Array.isArray(found)) {
          dbJobs = found.map((j: any) => ({
            ...j,
            fileSizeBytes: j.fileSizeBytes != null ? Number(j.fileSizeBytes) : 0,
          }));
        }
      }
    } catch {}

    // Fallback/Supplement: enumerate files in backupsDir
    const fileJobs: any[] = [];
    if (fs.existsSync(this.backupsDir)) {
      const files = fs.readdirSync(this.backupsDir).filter((f) => f.endsWith('.ownbase.bak'));
      for (const file of files) {
        const fullPath = path.join(this.backupsDir, file);
        const stats = fs.statSync(fullPath);
        const id = file.replace('.ownbase.bak', '');
        // If not already in dbJobs, include it
        if (!dbJobs.some((j) => j.id === id || j.archivePath === fullPath)) {
          fileJobs.push({
            id,
            name: file,
            status: 'completed',
            archivePath: fullPath,
            fileSizeBytes: stats.size,
            checksumSha256: '',
            createdAt: stats.birthtime.toISOString(),
          });
        }
      }
    }

    return [...dbJobs, ...fileJobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Deletes a backup record and its archive file.
   */
  public async deleteBackup(id: string): Promise<boolean> {
    const prisma = this.prismaManager.getClient();
    let archivePath: string | null = null;

    try {
      if ((prisma as any).backupJob) {
        const job = await (prisma as any).backupJob.findUnique({ where: { id } });
        if (job) {
          archivePath = job.archivePath;
          await (prisma as any).backupJob.delete({ where: { id } });
        }
      }
    } catch {}

    if (!archivePath) {
      // Check in directory
      const candidatePath = path.join(this.backupsDir, `${id}.ownbase.bak`);
      if (fs.existsSync(candidatePath)) {
        archivePath = candidatePath;
      }
    }

    if (archivePath && fs.existsSync(archivePath)) {
      try {
        fs.unlinkSync(archivePath);
        logger.info('backup', `Deleted backup file: ${archivePath}`);
      } catch (err: any) {
        logger.warn('backup', `Failed to delete archive file: ${err.message}`);
      }
    }

    return true;
  }

  // Helper: Execute pg_dump.exe
  private executePgDump(pgDumpExe: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const password = secretsManager.getOrCreatePostgresPassword();
      const args = [
        '-h', '127.0.0.1',
        '-p', '5432',
        '-U', 'postgres',
        '-d', 'postgres',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
      ];

      const proc = spawn(pgDumpExe, args, {
        env: { ...process.env, PGPASSWORD: password },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });
  }

  // Helper: Execute psql.exe for restore
  private executePsqlRestore(psqlExe: string, sqlContent: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const password = secretsManager.getOrCreatePostgresPassword();
      const args = ['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'postgres'];

      const proc = spawn(psqlExe, args, {
        env: { ...process.env, PGPASSWORD: password },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.stdin.write(sqlContent);
      proc.stdin.end();

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`psql restore exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });
  }

  // Helper: Export tables via Prisma
  private async exportTablesViaPrisma(prisma: any, manifest: BackupMetadata): Promise<Record<string, any[]>> {
    const tables: Record<string, any[]> = {};

    const entityNames = [
      'user',
      'systemConfig',
      'service',
      'route',
      'routeHost',
      'routePort',
      'storageVolume',
      'serviceMount',
      'app',
      'release',
    ];

    for (const name of entityNames) {
      if (prisma[name] && typeof prisma[name].findMany === 'function') {
        try {
          const rows = await prisma[name].findMany();
          tables[name] = rows;
          manifest.recordCounts![name] = rows.length;
        } catch (err: any) {
          logger.warn('backup', `Skipped exporting table ${name}: ${err.message}`);
        }
      }
    }

    return tables;
  }

  // Helper: Restore tables via Prisma
  private async restoreTablesViaPrisma(prisma: any, tables: Record<string, any[]>): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    // Restore users
    if (tables['user'] && prisma.user) {
      let count = 0;
      for (const u of tables['user']) {
        await prisma.user.upsert({
          where: { id: u.id },
          create: u,
          update: u,
        });
        count++;
      }
      counts['users'] = count;
    }

    // Restore services
    if (tables['service'] && prisma.service) {
      let count = 0;
      for (const s of tables['service']) {
        await prisma.service.upsert({
          where: { id: s.id },
          create: s,
          update: s,
        });
        count++;
      }
      counts['services'] = count;
    }

    // Restore routes
    if (tables['route'] && prisma.route) {
      let count = 0;
      for (const r of tables['route']) {
        await prisma.route.upsert({
          where: { id: r.id },
          create: r,
          update: r,
        });
        count++;
      }
      counts['routes'] = count;
    }

    // Restore apps
    if (tables['app'] && prisma.app) {
      let count = 0;
      for (const a of tables['app']) {
        await prisma.app.upsert({
          where: { id: a.id },
          create: a,
          update: a,
        });
        count++;
      }
      counts['apps'] = count;
    }

    // Restore storage volumes
    if (tables['storageVolume'] && prisma.storageVolume) {
      let count = 0;
      for (const v of tables['storageVolume']) {
        await prisma.storageVolume.upsert({
          where: { id: v.id },
          create: v,
          update: v,
        });
        count++;
      }
      counts['storageVolumes'] = count;
    }

    return counts;
  }
}
