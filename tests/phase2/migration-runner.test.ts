import { describe, it, expect } from 'vitest';
import { MigrationRunner } from '../../src/daemon/db/migrate';
import fs from 'fs';

describe('Item 2.5 & P11: Migration Runner (No db push fallback)', () => {
  const runner = new MigrationRunner();

  it('locates bundled Prisma CLI and Schema by absolute paths', () => {
    const cliPath = runner.resolvePrismaCli();
    const schemaPath = runner.resolveSchemaPath();

    expect(fs.existsSync(cliPath)).toBe(true);
    expect(fs.existsSync(schemaPath)).toBe(true);
    expect(cliPath).toContain('prisma');
    expect(schemaPath).toContain('schema.prisma');
  });

  it('fails loudly when provided an invalid database URL without attempting db push (P11)', async () => {
    // Attempting migration against a non-listening port to simulate failure
    const invalidDbUrl = 'postgresql://invalid_user:invalid_pass@127.0.0.1:54399/non_existent_db';
    const result = await runner.runMigrations(invalidDbUrl);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    const status = runner.getStatus();
    expect(status.state).toBe('error');
    expect(status.error).toBeDefined();

    // Verify it did not report successful sync via db push
    expect(status.state).not.toBe('applied');
  });
});
