import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeFileSha256, generateChecksums } from '../../scripts/generate-checksums';

describe('Phase 8 - Item 8.4: Packaging Engine & Verification (PRD §8.4 & Acceptance A2)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const electronBuilderPath = path.join(rootDir, 'electron-builder.json');
  const winswXmlPath = path.join(rootDir, 'installer', 'winsw', 'ownbase-service.xml');
  const winswInstallPs1 = path.join(rootDir, 'installer', 'winsw', 'install-service.ps1');
  const winswUninstallPs1 = path.join(rootDir, 'installer', 'winsw', 'uninstall-service.ps1');
  const firewallPs1 = path.join(rootDir, 'installer', 'firewall-rules.ps1');

  it('validates electron-builder.json configuration for NSIS installer and portable bundles', () => {
    expect(fs.existsSync(electronBuilderPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(electronBuilderPath, 'utf8'));

    // Identity & Product metadata
    expect(config.appId).toBe('com.rhmunna143.nativewindowsserverhub');
    expect(config.productName).toBe('Native Windows Server Hub');

    // Bundled files and asar configuration
    expect(config.asar).toBe(true);
    expect(config.files).toContain('dist/electron/**/*');
    expect(config.files).toContain('package.json');
    expect(config.files).toContain('prisma/**/*');

    // Targets: Both NSIS installer and Portable binary
    const winTargets = config.win.target.map((t: any) => (typeof t === 'string' ? t : t.target));
    expect(winTargets).toContain('nsis');
    expect(winTargets).toContain('portable');

    // NSIS parameters
    expect(config.nsis).toBeDefined();
    expect(config.nsis.oneClick).toBe(false);
    expect(config.nsis.allowToChangeInstallationDirectory).toBe(true);
    expect(config.nsis.allowElevation).toBe(true);
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false); // Data safety on uninstall
  });

  it('validates WinSW Windows Service configuration XML schema', () => {
    expect(fs.existsSync(winswXmlPath)).toBe(true);
    const xml = fs.readFileSync(winswXmlPath, 'utf8');

    // XML structural tags
    expect(xml).toContain('<service>');
    expect(xml).toContain('<id>ownbase</id>');
    expect(xml).toContain('<name>Ownbase Server Daemon</name>');
    expect(xml).toContain('<startmode>Automatic</startmode>');
    expect(xml).toContain('<delayedAutoStart>true</delayedAutoStart>');

    // Virtual service account (Item 2.7)
    expect(xml).toContain('NT SERVICE\\Ownbase');

    // Failure recovery policy: restart 3 times, then every 60s
    expect(xml).toContain('<onfailure action="restart" delay="5 sec" />');
    expect(xml).toContain('<onfailure action="restart" delay="10 sec" />');
    expect(xml).toContain('<onfailure action="restart" delay="20 sec" />');
    expect(xml).toContain('<resetfailure>60 sec</resetfailure>');
  });

  it('validates Windows Service installer and uninstaller PowerShell scripts', () => {
    expect(fs.existsSync(winswInstallPs1)).toBe(true);
    expect(fs.existsSync(winswUninstallPs1)).toBe(true);

    const installScript = fs.readFileSync(winswInstallPs1, 'utf8');
    expect(installScript).toContain('NT SERVICE\\Ownbase');
    expect(installScript).toContain('icacls');
    expect(installScript).toContain('ProgramData\\Ownbase');
    expect(installScript).toContain('delayed-auto');

    const uninstallScript = fs.readFileSync(winswUninstallPs1, 'utf8');
    expect(uninstallScript).toContain('Stop-Service');
    expect(uninstallScript).toContain('delete ownbase');
    expect(uninstallScript).toContain('%ProgramData%\\Ownbase have been preserved');
  });

  it('validates hardened inbound firewall rules (only ports 80 and 443 permitted on Private profile)', () => {
    expect(fs.existsSync(firewallPs1)).toBe(true);
    const firewallScript = fs.readFileSync(firewallPs1, 'utf8');

    // Legacy unauthenticated port rules must be purged
    expect(firewallScript).toContain('Remove-NetFirewallRule -Name $rule');
    expect(firewallScript).toContain('Ownbase-Internal-3001');
    expect(firewallScript).toContain('Ownbase-PostgreSQL-5432');
    expect(firewallScript).toContain('Ownbase-FileBrowser-8080');

    // Strictly ports 80 and 443 allowed on Private profile
    expect(firewallScript).toContain('-LocalPort 80');
    expect(firewallScript).toContain('-LocalPort 443');
    expect(firewallScript).toContain('-Profile Private');
  });

  it('validates SHA-256 checksum generation for release artifacts', () => {
    const tempDir = path.join(rootDir, 'node_modules', '.temp-checksum-test');
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      const testFile = path.join(tempDir, 'test-package.exe');
      fs.writeFileSync(testFile, 'Ownbase Release Artifact Content ' + Date.now(), 'utf8');

      const expectedHash = computeFileSha256(testFile);
      expect(typeof expectedHash).toBe('string');
      expect(expectedHash.length).toBe(64); // SHA-256 hex length

      const checksums = generateChecksums(tempDir);
      expect(checksums['test-package.exe']).toBe(expectedHash);

      const sumsFile = path.join(tempDir, 'SHA256SUMS.txt');
      expect(fs.existsSync(sumsFile)).toBe(true);
      const sumsContent = fs.readFileSync(sumsFile, 'utf8');
      expect(sumsContent).toContain(expectedHash);
      expect(sumsContent).toContain('test-package.exe');
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
