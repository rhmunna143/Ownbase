import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from '../core/logger';
import { MigrationStatus } from '../../shared/types';
import { EMBEDDED_MIGRATIONS, MigrationItem } from './migrationsData';

export interface MigrationResult {
  success: boolean;
  error?: string;
  output?: string;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inDollarQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    // Handle line comments (-- ...)
    if (!inString && !inDollarQuote && !inBlockComment && char === '-' && nextChar === '-') {
      inLineComment = true;
      i++;
      continue;
    }
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    // Handle block comments (/* ... */)
    if (!inString && !inDollarQuote && !inLineComment && char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    // Handle single-quoted strings ('...')
    if (!inDollarQuote && char === "'") {
      if (inString && nextChar === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
      current += char;
      continue;
    }

    // Handle dollar-quoted blocks ($$ ... $$)
    if (!inString && char === '$' && nextChar === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++;
      continue;
    }

    // Semicolon outside strings/quotes/comments terminates a statement
    if (!inString && !inDollarQuote && char === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

export class MigrationRunner {
  private status: MigrationStatus = { state: 'idle' };

  public getStatus(): MigrationStatus {
    return { ...this.status };
  }

  public resolvePrismaCli(): string {
    const resPath =
      process.env.RESOURCES_PATH ||
      (process as any).resourcesPath ||
      path.join(path.dirname(process.execPath), 'resources') ||
      '';

    const candidatePaths = [
      resPath ? path.join(resPath, 'app.asar.unpacked', 'node_modules', 'prisma', 'build', 'index.js') : '',
      resPath ? path.join(resPath, 'node_modules', 'prisma', 'build', 'index.js') : '',
      path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'node_modules', 'prisma', 'build', 'index.js'),
      path.join(path.dirname(process.execPath), 'resources', 'node_modules', 'prisma', 'build', 'index.js'),
      path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
      path.join(__dirname, '..', '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
      path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
    ].filter(Boolean);

    try {
      const resolved = require.resolve('prisma/build/index.js');
      if (fs.existsSync(resolved)) return resolved;
    } catch {}

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    throw new Error('Bundled Prisma CLI (prisma/build/index.js) not found');
  }

  public resolveSchemaPath(): string {
    const resPath =
      process.env.RESOURCES_PATH ||
      (process as any).resourcesPath ||
      path.join(path.dirname(process.execPath), 'resources') ||
      '';

    const candidatePaths = [
      resPath ? path.join(resPath, 'app.asar.unpacked', 'prisma', 'schema', 'schema.prisma') : '',
      resPath ? path.join(resPath, 'app.asar.unpacked', 'prisma', 'schema.prisma') : '',
      resPath ? path.join(resPath, 'prisma', 'schema', 'schema.prisma') : '',
      resPath ? path.join(resPath, 'prisma', 'schema.prisma') : '',
      path.join(path.dirname(process.execPath), 'resources', 'prisma', 'schema', 'schema.prisma'),
      path.join(path.dirname(process.execPath), 'resources', 'prisma', 'schema.prisma'),
      path.join(process.cwd(), 'prisma', 'schema', 'schema.prisma'),
      path.join(__dirname, '..', '..', '..', 'prisma', 'schema', 'schema.prisma'),
      path.join(__dirname, '..', '..', '..', '..', 'prisma', 'schema', 'schema.prisma'),
      path.join(process.cwd(), 'prisma', 'schema.prisma'),
    ].filter(Boolean);

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    throw new Error('Prisma schema (schema.prisma) not found');
  }

  /**
   * Discovers migration SQL on disk if available, otherwise falls back to EMBEDDED_MIGRATIONS.
   */
  private getMigrationsToRun(): MigrationItem[] {
    const resPath =
      process.env.RESOURCES_PATH ||
      (process as any).resourcesPath ||
      path.join(path.dirname(process.execPath), 'resources') ||
      '';

    const candidateMigrationDirs = [
      resPath ? path.join(resPath, 'prisma', 'schema', 'migrations') : '',
      resPath ? path.join(resPath, 'app.asar.unpacked', 'prisma', 'schema', 'migrations') : '',
      resPath ? path.join(resPath, 'prisma', 'migrations') : '',
      path.join(path.dirname(process.execPath), 'resources', 'prisma', 'schema', 'migrations'),
      path.join(path.dirname(process.execPath), 'resources', 'prisma', 'migrations'),
      path.join(process.cwd(), 'prisma', 'schema', 'migrations'),
      path.join(process.cwd(), 'prisma', 'migrations'),
      path.join(__dirname, '..', '..', '..', 'prisma', 'schema', 'migrations'),
      path.join(__dirname, '..', '..', '..', '..', 'prisma', 'schema', 'migrations'),
    ].filter(Boolean);

    for (const dir of candidateMigrationDirs) {
      if (fs.existsSync(dir)) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          const folders = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();

          const items: MigrationItem[] = [];
          for (const folder of folders) {
            const sqlPath = path.join(dir, folder, 'migration.sql');
            if (fs.existsSync(sqlPath)) {
              items.push({
                name: folder,
                sql: fs.readFileSync(sqlPath, 'utf-8'),
              });
            }
          }

          if (items.length > 0) {
            logger.info('prisma', `Found ${items.length} migration SQL files on disk at ${dir}`);
            return items;
          }
        } catch {}
      }
    }

    logger.info('prisma', `Using ${EMBEDDED_MIGRATIONS.length} embedded migrations`);
    return EMBEDDED_MIGRATIONS;
  }

  /**
   * Executes database migrations reliably directly against PostgreSQL (compatible with Prisma schema & _prisma_migrations).
   */
  public async runMigrations(databaseUrl: string): Promise<MigrationResult> {
    this.status = { state: 'running' };
    logger.info('prisma', 'Initiating PostgreSQL database schema deployment...');

    // 1. Direct programmatic migration execution
    try {
      const client = new PrismaClient({
        datasources: {
          db: { url: databaseUrl },
        },
      });

      // Ensure _prisma_migrations tracking table exists
      await client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
          "checksum"              VARCHAR(64) NOT NULL,
          "finished_at"           TIMESTAMPTZ,
          "migration_name"        VARCHAR(255) NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        TIMESTAMPTZ,
          "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
          "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
        );
      `);

      // Read applied migrations
      const appliedRows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;`
      );
      const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

      const migrations = this.getMigrationsToRun();
      let newlyApplied = 0;

      for (const m of migrations) {
        if (!appliedSet.has(m.name)) {
          logger.info('prisma', `Applying migration: ${m.name}...`);
          const migrationId = crypto.randomUUID();

          // Execute each statement in the migration individually to avoid PostgreSQL prepared-statement limits
          const statements = splitSqlStatements(m.sql);
          for (const stmt of statements) {
            try {
              await client.$executeRawUnsafe(stmt);
            } catch (stmtErr: any) {
              const msg = stmtErr.message || '';
              if (
                msg.includes('already exists') ||
                stmtErr.code === '42710' ||
                stmtErr.code === '42P07'
              ) {
                logger.info('prisma', `Statement notice: ${msg.split('\n')[0]}`);
              } else {
                logger.error('prisma', `Error executing statement in ${m.name}: ${msg}\nStatement: ${stmt.substring(0, 100)}...`);
                throw stmtErr;
              }
            }
          }

          // Record in _prisma_migrations
          await client.$executeRawUnsafe(`
            INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
            VALUES ('${migrationId}', 'sha256_${crypto.createHash('sha256').update(m.sql).digest('hex').substring(0, 16)}', now(), '${m.name}', 1);
          `);

          newlyApplied++;
          logger.success('prisma', `Migration ${m.name} successfully applied.`);
        } else {
          logger.info('prisma', `Migration ${m.name} already applied.`);
        }
      }

      // Verify public.users table exists
      const tableCheck = await client.$queryRawUnsafe<{ exists: boolean }[]>(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'users'
        ) as exists;
      `);

      const usersExist = tableCheck[0]?.exists === true;
      await client.$disconnect();

      if (usersExist) {
        logger.success('prisma', `Database schema fully initialized. Applied ${newlyApplied} migration(s).`);
        this.status = {
          state: 'applied',
          appliedAt: new Date().toISOString(),
        };
        return { success: true, output: `Applied ${newlyApplied} migration(s)` };
      } else {
        throw new Error('Schema verification failed: public.users table missing after migration execution');
      }
    } catch (directErr: any) {
      logger.warn('prisma', `Direct migration notice: ${directErr.message}. Attempting CLI fallback...`);
    }

    // 2. CLI fallback with explicit ELECTRON_RUN_AS_NODE=1
    return new Promise((resolve) => {
      let prismaCliPath: string;
      let schemaPath: string;

      try {
        prismaCliPath = this.resolvePrismaCli();
        schemaPath = this.resolveSchemaPath();
      } catch (err: any) {
        const errMsg = `Migration pre-flight error: ${err.message}`;
        logger.error('prisma', errMsg);
        this.status = { state: 'error', error: errMsg };
        return resolve({ success: false, error: errMsg });
      }

      const nodeExe = process.execPath;
      const args = [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath];

      logger.info('prisma', `CLI executing: "${nodeExe}" "${prismaCliPath}" migrate deploy --schema "${schemaPath}"`);

      const child = spawn(nodeExe, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          DATABASE_URL: databaseUrl,
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutData = '';
      let stderrData = '';

      child.stdout?.on('data', (data) => {
        const text = data.toString();
        stdoutData += text;
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          logger.info('prisma', line);
        }
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString();
        stderrData += text;
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          logger.warn('prisma', line);
        }
      });

      child.on('error', (err) => {
        const errMsg = `Failed to spawn Prisma CLI: ${err.message}`;
        logger.error('prisma', errMsg);
        this.status = { state: 'error', error: errMsg };
        resolve({ success: false, error: errMsg });
      });

      child.on('exit', (code) => {
        if (code === 0) {
          logger.success('prisma', 'All Prisma database migrations deployed successfully via CLI.');
          this.status = {
            state: 'applied',
            appliedAt: new Date().toISOString(),
          };
          resolve({ success: true, output: stdoutData });
        } else {
          const errMsg = `Prisma migrate deploy exited with code ${code}. Error: ${stderrData || stdoutData || 'Migration failed'}`;
          logger.error('prisma', errMsg);
          this.status = { state: 'error', error: errMsg };
          resolve({ success: false, error: errMsg, output: stdoutData });
        }
      });
    });
  }
}

export const migrationRunner = new MigrationRunner();
