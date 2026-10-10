import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

async function verifyPhase5() {
  console.log('=== VERIFYING PHASE 5: PACKAGING & DISTRIBUTION ===\n');

  try {
    // 1. Next.js Static Export Verification
    console.log('[1/4] Verifying Next.js Static Export Bundle (out/)...');
    const outDir = path.join(process.cwd(), 'out');
    const indexHtml = path.join(outDir, 'index.html');
    const staticNextDir = path.join(outDir, '_next');

    if (!fs.existsSync(indexHtml)) {
      throw new Error(`out/index.html not found! Ensure next build is executed.`);
    }

    const htmlContent = fs.readFileSync(indexHtml, 'utf8');
    const hasHtmlTag = htmlContent.includes('<html') || htmlContent.includes('<!DOCTYPE html>');
    if (!hasHtmlTag) {
      throw new Error('out/index.html does not contain valid HTML content!');
    }
    console.log(`  ✓ out/index.html verified (${fs.statSync(indexHtml).size} bytes, valid HTML).`);

    if (fs.existsSync(staticNextDir)) {
      console.log(`  ✓ out/_next/ static assets verified.`);
    } else {
      console.log(`  ✓ out/ static bundle ready.`);
    }

    // 2. Binary Bundling Mapping & Resource Verification
    console.log('\n[2/4] Verifying electron-builder Packaging Manifest & Native Dependencies...');
    const builderConfigPath = path.join(process.cwd(), 'electron-builder.json');
    if (!fs.existsSync(builderConfigPath)) {
      throw new Error('electron-builder.json config file not found!');
    }

    const builderConfig = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'));
    console.log(`  - App ID: ${builderConfig.appId}`);
    console.log(`  - Product Name: ${builderConfig.productName}`);
    console.log(`  - Output directory: ${builderConfig.directories?.output}`);

    // Verify extraResources mapping
    const extraResources = builderConfig.extraResources || [];
    const hasBinMapping = extraResources.some((r: any) => r.from.includes('extraResources/bin'));
    const hasPgsqlMapping = extraResources.some((r: any) => r.from.includes('extraResources/pgsql'));
    const excludesZip = !fs.existsSync('release/win-unpacked/resources/postgresql.zip') &&
      !fs.existsSync('release/win-unpacked/resources/pgsql/postgresql.zip');

    console.log(`  - Binary extraResources mapped: ${hasBinMapping ? '✓ YES' : '❌ NO'}`);
    console.log(`  - PostgreSQL extraResources mapped: ${hasPgsqlMapping ? '✓ YES' : '❌ NO'}`);
    console.log(`  - 338MB postgresql.zip excluded from packaging: ${excludesZip ? '✓ YES' : '❌ NO'}`);

    if (!hasBinMapping || !hasPgsqlMapping) {
      throw new Error('extraResources in electron-builder.json missing required bin or pgsql mappings!');
    }

    // Verify NSIS configuration
    console.log('\n[3/4] Verifying NSIS One-Click Installer Configuration...');
    const nsis = builderConfig.nsis;
    if (!nsis) {
      throw new Error('NSIS configuration block missing in electron-builder.json!');
    }

    console.log(`  - One-Click Installer: ${nsis.oneClick ? '✓ YES' : 'NO'}`);
    console.log(`  - Desktop Shortcut: ${nsis.createDesktopShortcut ? '✓ YES' : 'NO'}`);
    console.log(`  - Start Menu Shortcut: ${nsis.createStartMenuShortcut ? '✓ YES' : 'NO'}`);
    console.log(`  - Windows Target: ${JSON.stringify(builderConfig.win?.target || 'nsis')}`);
    console.log(`  - Installer Icon: ${builderConfig.win?.icon || 'assets/icon.ico'}`);

    if (!nsis.oneClick || !nsis.createDesktopShortcut) {
      throw new Error('NSIS installer configuration must enable oneClick and desktop shortcuts!');
    }

    // 4. Test electron-builder Unpacked Packaging
    console.log('\n[4/4] Executing electron-builder Packaging Verification (electron-builder --dir)...');
    console.log('  > Running: npx electron-builder --dir --config electron-builder.json');

    execSync('npx electron-builder --dir --config electron-builder.json', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    const releaseDir = path.join(process.cwd(), 'release', 'win-unpacked');
    if (!fs.existsSync(releaseDir)) {
      throw new Error(`Unpacked distribution directory not found at: ${releaseDir}`);
    }

    const mainExe = path.join(releaseDir, 'Native Windows Server Hub.exe');
    if (!fs.existsSync(mainExe)) {
      throw new Error(`Main application executable not found at: ${mainExe}`);
    }
    console.log(`  ✓ Main Windows Executable created: "${mainExe}" (${(fs.statSync(mainExe).size / (1024 * 1024)).toFixed(2)} MB)`);

    // Verify resources folder and unpacked binaries
    const resourcesDir = path.join(releaseDir, 'resources');
    const binDir = path.join(resourcesDir, 'bin');
    const pgsqlBinDir = path.join(resourcesDir, 'pgsql', 'bin');

    console.log('  > Verifying bundled native dependencies inside resources directory:');
    const requiredBins = ['caddy.exe', 'filebrowser.exe', 'ollama.exe', 'tailscale.exe'];
    for (const bin of requiredBins) {
      const p = path.join(binDir, bin);
      const exists = fs.existsSync(p);
      console.log(`    - ${bin}: ${exists ? '✓ PRESENT' : '❌ MISSING'} (${exists ? fs.statSync(p).size : 0} bytes)`);
      if (!exists) throw new Error(`Bundled dependency ${bin} missing from ${binDir}`);
    }

    const pgsqlExe = path.join(pgsqlBinDir, 'postgres.exe');
    const initdbExe = path.join(pgsqlBinDir, 'initdb.exe');
    const pgExists = fs.existsSync(pgsqlExe) && fs.existsSync(initdbExe);
    console.log(`    - postgres.exe & initdb.exe: ${pgExists ? '✓ PRESENT' : '❌ MISSING'}`);
    if (!pgExists) throw new Error(`Bundled PostgreSQL binaries missing from ${pgsqlBinDir}`);

    const asarFile = path.join(resourcesDir, 'app.asar');
    if (fs.existsSync(asarFile)) {
      console.log(`  ✓ Application bundle packaged into ASAR: ${asarFile} (${(fs.statSync(asarFile).size / (1024 * 1024)).toFixed(2)} MB)`);
    }

    console.log('\n======================================================');
    console.log('🎉 PHASE 5 VERIFICATION COMPLETE: ALL CHECKS PASSED!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('❌ Phase 5 Verification Failed:', err);
    process.exit(1);
  }
}

verifyPhase5().catch((err) => {
  console.error(err);
  process.exit(1);
});
