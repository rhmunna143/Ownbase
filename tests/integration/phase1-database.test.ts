import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { PostgresManager } from '../../src/main/postgres';
import { PrismaManager } from '../../src/main/prisma';

describe('Phase 1 Integration: PostgreSQL & Prisma Bootstrapping', () => {
  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');

  beforeAll(async () => {
    // Check binaries exist
    const binDir = path.join(process.cwd(), 'extraResources', 'pgsql', 'bin');
    const initdb = path.join(binDir, 'initdb.exe');
    const postgres = path.join(binDir, 'postgres.exe');
    expect(fs.existsSync(initdb)).toBe(true);
    expect(fs.existsSync(postgres)).toBe(true);

    // Bootstrap and migrate
    await postgresManager.bootstrap();
    await prismaManager.runMigrations();
  }, 60000);

  afterAll(async () => {
    await postgresManager.stop();
    await prismaManager.disconnect();
  });

  it('runs PostgreSQL engine on port 5432 with active PID', () => {
    const status = postgresManager.getStatus();
    expect(status.port).toBe(5432);
    expect(status.pid).toBeDefined();
    expect(status.state).toBe('running');
  });

  it('connects via Prisma and executes ping query with low latency', async () => {
    const ping = await prismaManager.ping();
    expect(ping.success).toBe(true);
    expect(ping.latencyMs).toBeLessThan(1000);
  });

  it('retrieves configured services and routes from database', async () => {
    const services = await prismaManager.getServices();
    expect(services.length).toBeGreaterThanOrEqual(1);

    const routes = await prismaManager.getRoutes();
    expect(Array.isArray(routes)).toBe(true);
  });
});
