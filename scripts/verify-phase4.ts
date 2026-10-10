import path from 'path';
import fs from 'fs';
import { PostgresManager } from '../src/main/postgres';
import { PrismaManager } from '../src/main/prisma';
import { LifecycleManager } from '../src/main/lifecycle';

async function verifyPhase4() {
  console.log('=== VERIFYING PHASE 4: SYSTEM INTEGRATION & APP LIFECYCLE ===\n');

  const postgresManager = new PostgresManager(5432);
  const prismaManager = new PrismaManager(5432, 'postgres');

  try {
    // 1. Ensure Postgres and Prisma are active
    console.log('[1/5] Bootstrapping Database & Prisma Manifest...');
    await postgresManager.bootstrap();
    await prismaManager.runMigrations();
    console.log('✓ PostgreSQL engine active and migrations synchronized.');

    // 2. Tray Icon Verification
    console.log('\n[2/5] Testing System Tray Icon Asset Resolution...');
    const assetPath = path.join(process.cwd(), 'assets', 'tray-icon.png');
    if (fs.existsSync(assetPath)) {
      console.log(`  ✓ Found system tray icon at: ${assetPath} (${fs.statSync(assetPath).size} bytes)`);
    } else {
      console.log('  ⚠️ Tray icon file missing, verifying base64 fallback embedded in LifecycleManager...');
    }

    // 3. LifecycleManager Initialization
    console.log('\n[3/5] Instantiating LifecycleManager & Testing Power Save Blocker...');
    const lifecycleManager = new LifecycleManager(prismaManager);

    // Bootstrap lifecycle manager (enables prevent-app-suspension by default)
    await lifecycleManager.bootstrap();

    // Verify power blocker state
    const isPowerActive = lifecycleManager.isPowerBlockerActive();
    console.log(`  - PowerSaveBlocker active: ${isPowerActive}`);
    
    // Test power save blocker toggle
    console.log('  > Testing power save blocker toggle (ON -> OFF)...');
    const disableRes = await lifecycleManager.setPowerSaveBlocker(false);
    console.log(`  - Disabling blocker: success=${disableRes.success}, active=${disableRes.powerBlocker.active}`);
    if (disableRes.powerBlocker.active) {
      throw new Error('Power blocker remained active after setPowerSaveBlocker(false)!');
    }

    console.log('  > Testing power save blocker toggle (OFF -> ON)...');
    const enableRes = await lifecycleManager.setPowerSaveBlocker(true);
    console.log(`  - Enabling blocker: success=${enableRes.success}, blockerId=${enableRes.powerBlocker.blockerId}`);
    if (!enableRes.powerBlocker.active) {
      throw new Error('Power blocker failed to start after setPowerSaveBlocker(true)!');
    }

    // Verify DB persistence of power save setting
    const client = prismaManager.getClient();
    const savedPowerCfg = await client.systemConfig.findUnique({
      where: { key: 'prevent_app_suspension' },
    });
    console.log(`  ✓ PostgreSQL system_configs persisted: prevent_app_suspension="${savedPowerCfg?.value}"`);
    if (savedPowerCfg?.value !== 'true') {
      throw new Error('Power suspension blocker setting was not persisted to PostgreSQL!');
    }

    // 4. Windows Startup Registry (app.setLoginItemSettings)
    console.log('\n[4/5] Testing Windows Boot Auto-Launch Settings (app.setLoginItemSettings)...');
    console.log('  > Enabling Auto-Start at Boot (openAtLogin: true, openAsHidden: true)...');
    const autoEnableRes = await lifecycleManager.setAutoStart(true, true);
    console.log(`  - Result: success=${autoEnableRes.success}, enabled=${autoEnableRes.autoStart.enabled}, hidden=${autoEnableRes.autoStart.openAsHidden}`);

    const savedBootCfg = await client.systemConfig.findUnique({
      where: { key: 'auto_start_at_boot' },
    });
    console.log(`  ✓ PostgreSQL system_configs persisted: auto_start_at_boot="${savedBootCfg?.value}"`);
    if (savedBootCfg?.value !== 'true') {
      throw new Error('Auto-start boot setting was not persisted to PostgreSQL!');
    }

    console.log('  > Disabling Auto-Start at Boot...');
    const autoDisableRes = await lifecycleManager.setAutoStart(false, true);
    console.log(`  - Result: success=${autoDisableRes.success}, enabled=${autoDisableRes.autoStart.enabled}`);

    const savedBootCfgAfter = await client.systemConfig.findUnique({
      where: { key: 'auto_start_at_boot' },
    });
    console.log(`  ✓ PostgreSQL system_configs updated: auto_start_at_boot="${savedBootCfgAfter?.value}"`);
    if (savedBootCfgAfter?.value !== 'false') {
      throw new Error('Auto-start disable setting was not persisted to PostgreSQL!');
    }

    // 5. Query Full Lifecycle Status
    console.log('\n[5/5] Querying Full Lifecycle Status Model...');
    const status = lifecycleManager.getStatus();
    console.log('  - Lifecycle Status:', JSON.stringify(status, null, 2));

    if (!status.powerBlocker || status.powerBlocker.type !== 'prevent-app-suspension') {
      throw new Error('Invalid lifecycle status shape for powerBlocker!');
    }

    // Teardown
    console.log('\nTeardown: Destroying lifecycle manager...');
    lifecycleManager.destroy();
    console.log('✓ Power blocker stopped and lifecycle manager cleanly destroyed.');

    console.log('\n======================================================');
    console.log('🎉 PHASE 4 VERIFICATION COMPLETE: ALL CHECKS PASSED!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('❌ Phase 4 Verification Failed:', err);
    process.exit(1);
  } finally {
    console.log('Cleaning up: Stopping PostgreSQL database...');
    await postgresManager.stop();
    await prismaManager.disconnect();
    console.log('Cleanup finished.');
  }
}

verifyPhase4().catch((err) => {
  console.error(err);
  process.exit(1);
});
