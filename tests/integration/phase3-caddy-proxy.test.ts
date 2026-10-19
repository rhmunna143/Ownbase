import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresManager } from '../../src/main/postgres';
import { PrismaManager } from '../../src/main/prisma';
import { CaddyManager } from '../../src/main/caddy';

describe('Phase 3 Integration: Caddy Reverse Proxy Dynamic Config', () => {
  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');
  const caddyManager = new CaddyManager(prismaManager);

  beforeAll(async () => {
    await postgresManager.bootstrap();
    await prismaManager.runMigrations();
  }, 60000);

  afterAll(async () => {
    await postgresManager.stop();
    await prismaManager.disconnect();
  });

  it('queries Caddy Admin API status correctly', async () => {
    const status = await caddyManager.getStatus();
    expect(status).toBeDefined();
    expect(status.adminApiUrl).toContain('2019');
    expect(typeof status.isListening).toBe('boolean');
  });

  it('tests route resolution without throwing unhandled exceptions', async () => {
    const result = await caddyManager.testRoute('localhost', 80);
    expect(result).toBeDefined();
    expect(typeof result.latencyMs).toBe('number');
  });
});
