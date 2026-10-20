import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../core/logger';
import { MigrationStatus } from '../../shared/types';

export interface MigrationResult {
  success: boolean;
  error?: string;
  output?: string;
}

export class MigrationRunner {
  private status: MigrationStatus = { state: 'idle' };

  public getStatus(): MigrationStatus {
    return { ...this.status };
  }

  public resolvePrismaCli(): string {
    const candidatePaths = [
      path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
      path.join(__dirname, '..', '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
    ];

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
    const candidatePaths = [
      path.join(process.cwd(), 'prisma', 'schema', 'schema.prisma'),
      path.join(__dirname, '..', '..', '..', 'prisma', 'schema', 'schema.prisma'),
      path.join(process.cwd(), 'prisma', 'schema.prisma'),
    ];

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    throw new Error('Prisma schema (schema.prisma) not found');
  }

  /**
   * Executes prisma migrate deploy via bundled Node.js and Prisma CLI.
   * Defect P11 Resolution:
   * - Sets DATABASE_URL explicitly in the environment.
   * - Invokes process.execPath with absolute path to Prisma CLI.
   * - NEVER falls back to `db push`. Fails loudly and updates status so daemon can operate in degraded mode.
   */
  public async runMigrations(databaseUrl: string): Promise<MigrationResult> {
    this.status = { state: 'running' };
    logger.info('prisma', 'Initiating database migrations with bundled CLI (no db push fallback)...');

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

      logger.info('prisma', `Executing: "${nodeExe}" "${prismaCliPath}" migrate deploy --schema "${schemaPath}"`);

      const child = spawn(nodeExe, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
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
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          logger.info('prisma', line);
        }
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString();
        stderrData += text;
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
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
          logger.success('prisma', 'All Prisma database migrations deployed successfully.');
          this.status = {
            state: 'applied',
            appliedAt: new Date().toISOString(),
          };
          resolve({ success: true, output: stdoutData });
        } else {
          // P11: Explicitly NO db push fallback! Report failure loudly.
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
