import path from 'path';
import fs from 'fs';
import os from 'os';
import { PostgresManager } from '../src/main/postgres';
import { PrismaManager } from '../src/main/prisma';
import { logger } from '../src/main/logger';

async function verifyPhase1() {
  console.log('=== VERIFYING PHASE 1: CORE FOUNDATION & DATABASE BOOTSTRAPPING ===\n');

  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');

  try {
    // 1. Verify Portable Binaries
    console.log('[1/5] Verifying PostgreSQL Portable Binaries...');
    const binDir = path.join(process.cwd(), 'extraResources', 'pgsql', 'bin');
    const initdb = path.join(binDir, 'initdb.exe');
    const postgres = path.join(binDir, 'postgres.exe');
    
    if (!fs.existsSync(initdb) || !fs.existsSync(postgres)) {
      throw new Error(`Binaries missing: initdb=${fs.existsSync(initdb)}, postgres=${fs.existsSync(postgres)}`);
    }
    console.log(`✓ Binaries verified in ${binDir}`);

    // 2. Bootstrap Postgres Engine (initdb & launch)
    console.log('\n[2/5] Bootstrapping PostgreSQL Engine...');
    await postgresManager.bootstrap();
    const status = postgresManager.getStatus();
    console.log(`✓ PostgreSQL engine active on port ${status.port} (PID: ${status.pid})`);

    // 3. Run Programmatic Prisma Migrations
    console.log('\n[3/5] Executing Programmatic Prisma Migrations (npx prisma migrate deploy)...');
    await prismaManager.runMigrations();
    console.log('✓ Prisma migrations deployed successfully');

    // 4. Test Prisma Client & Database Queries
    console.log('\n[4/5] Testing Prisma Client Query & Latency...');
    const ping = await prismaManager.ping();
    console.log(`✓ Ping result: success=${ping.success}, latency=${ping.latencyMs}ms, dbTime=${ping.time}`);

    console.log('\n[5/5] Querying Seeded Services & Routes via Prisma...');
    const services = await prismaManager.getServices();
    console.log(`✓ Retrieved ${services.length} services from PostgreSQL:`);
    for (const s of services) {
      console.log(`  - [${s.type.toUpperCase()}] ${s.name} (Executable: ${s.executable}, Port: ${s.port}, Routes: ${s.routes?.length || 0})`);
    }

    const routes = await prismaManager.getRoutes();
    console.log(`✓ Retrieved ${routes.length} routes from PostgreSQL:`);
    for (const r of routes) {
      console.log(`  - Subdomain: ${r.subdomain} -> ${r.targetHost}:${r.targetPort} (TLS: ${r.tlsEnabled})`);
    }

    console.log('\n======================================================');
    console.log('🎉 PHASE 1 VERIFICATION COMPLETE: ALL CHECKS PASSED!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('❌ Phase 1 Verification Failed:', err);
    process.exit(1);
  } finally {
    console.log('Cleaning up: Stopping PostgreSQL...');
    await postgresManager.stop();
    await prismaManager.disconnect();
    console.log('PostgreSQL stopped gracefully.');
  }
}

verifyPhase1().catch((err) => {
  console.error(err);
  process.exit(1);
});
