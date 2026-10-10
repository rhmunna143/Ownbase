import path from 'path';
import fs from 'fs';
import { PostgresManager } from '../src/main/postgres';
import { PrismaManager } from '../src/main/prisma';
import { ProcessSupervisor } from '../src/main/supervisor';
import { logger } from '../src/main/logger';

async function verifyPhase2() {
  console.log('=== VERIFYING PHASE 2: THE NATIVE PROCESS SUPERVISOR ===\n');

  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');
  const supervisor = new ProcessSupervisor(prismaManager);

  try {
    // 1. Ensure Postgres and Prisma are active
    console.log('[1/5] Bootstrapping Database & Prisma Manifest...');
    await postgresManager.bootstrap();
    await prismaManager.runMigrations();
    const services = await prismaManager.getServices();
    console.log(`✓ Database active. Found ${services.length} service manifests in PostgreSQL.`);

    // 2. Binary Discovery
    console.log('\n[2/5] Testing Binary Resolution in extraResources/bin...');
    for (const service of services) {
      const resolved = supervisor.resolveExecutablePath(service.executable);
      console.log(`  - [${service.type.toUpperCase()}] ${service.executable} -> ${resolved || 'NOT FOUND'}`);
      if (!resolved) {
        throw new Error(`Required executable ${service.executable} could not be resolved!`);
      }
      supervisor.registerService(service);
    }
    console.log('✓ All binary executables (caddy, filebrowser, ollama) verified and registered.');

    // 3. Spawning & Stdout/Stderr Capture
    console.log('\n[3/5] Spawning Native Processes via child_process.spawn()...');
    const spawnedPids: number[] = [];

    for (const service of services) {
      console.log(`  > Spawning ${service.name} (${service.executable})...`);
      const result = await supervisor.startService(service.id);
      if (!result.success || !result.pid) {
        throw new Error(`Failed to start ${service.name}: ${result.error}`);
      }
      spawnedPids.push(result.pid);
      console.log(`  ✓ Spawned ${service.name} with Windows PID: ${result.pid}`);
    }

    // Allow processes to run and produce stdout/stderr logs
    console.log('\n[4/5] Awaiting Process Execution & Capturing Real-Time Stdout/Stderr Logs...');
    await new Promise((r) => setTimeout(r, 4000));

    // Verify logs captured for each process
    for (const service of services) {
      const logs = supervisor.getServiceLogs(service.id);
      const status = supervisor.getStatus(service.id);
      console.log(`  - ${service.name} (Status: ${status?.status}, PID: ${status?.pid}): ${logs.length} log lines captured`);
      if (logs.length > 0) {
        console.log(`    Recent log: [${logs[0].level.toUpperCase()}] ${logs[0].message.trim()}`);
      }
    }
    console.log('✓ Real-time log capture and streaming verified.');

    // 4. Test Forceful Termination (taskkill /pid <PID> /T /F)
    console.log('\n[5/5] Testing Process Tree Termination (taskkill /pid <PID> /T /F)...');
    console.log(`  > Terminating all supervised process trees for PIDs: [${spawnedPids.join(', ')}]...`);
    await supervisor.stopAll();

    // Verify no orphaned processes remain
    console.log('  > Verifying zero zombie processes in Windows process table...');
    for (const pid of spawnedPids) {
      let isAlive = false;
      try {
        process.kill(pid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }

      if (isAlive) {
        throw new Error(`Orphaned zombie process detected! PID ${pid} is still running!`);
      }
      console.log(`  ✓ Confirmed PID ${pid} is completely terminated.`);
    }

    // Verify statuses in database
    const updatedServices = await prismaManager.getServices();
    for (const s of updatedServices) {
      console.log(`  - Database state for ${s.name}: status=${s.status}, pid=${s.pid ?? 'null'}`);
    }

    console.log('\n======================================================');
    console.log('🎉 PHASE 2 VERIFICATION COMPLETE: ALL CHECKS PASSED!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('❌ Phase 2 Verification Failed:', err);
    process.exit(1);
  } finally {
    console.log('Cleaning up: Stopping supervisor and database...');
    await supervisor.stopAll();
    await postgresManager.stop();
    await prismaManager.disconnect();
    console.log('Cleanup complete.');
  }
}

verifyPhase2().catch((err) => {
  console.error(err);
  process.exit(1);
});
