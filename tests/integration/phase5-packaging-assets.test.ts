import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

describe('Phase 5 Integration: Packaging & Asset Verification', () => {
  const rootDir = process.cwd();

  it('verifies Next.js static export bundle (out/index.html)', () => {
    const outDir = path.join(rootDir, 'out');
    const indexHtml = path.join(outDir, 'index.html');

    expect(fs.existsSync(indexHtml), 'out/index.html must exist').toBe(true);

    const htmlContent = fs.readFileSync(indexHtml, 'utf8');
    const hasHtmlTag = htmlContent.includes('<html') || htmlContent.includes('<!DOCTYPE html>');
    expect(hasHtmlTag, 'out/index.html must contain valid HTML content').toBe(true);
  });

  it('validates electron-builder packaging manifest & resource mappings', () => {
    const builderConfigPath = path.join(rootDir, 'electron-builder.json');
    expect(fs.existsSync(builderConfigPath), 'electron-builder.json must exist').toBe(true);

    const builderConfig = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'));
    expect(builderConfig.appId).toMatch(/ownbase|nativewindowsserverhub/);
    expect(builderConfig.productName).toMatch(/Ownbase|Native Windows Server Hub/);

    const extraResources = builderConfig.extraResources || [];
    const hasBinMapping = extraResources.some((r: any) => typeof r.from === 'string' && r.from.includes('extraResources/bin'));
    const hasPgsqlMapping = extraResources.some((r: any) => typeof r.from === 'string' && r.from.includes('extraResources/pgsql'));

    expect(hasBinMapping, 'extraResources must map extraResources/bin').toBe(true);
    expect(hasPgsqlMapping, 'extraResources must map extraResources/pgsql').toBe(true);
  });

  it('verifies NSIS configuration for installer options and shortcuts', () => {
    const builderConfigPath = path.join(rootDir, 'electron-builder.json');
    const builderConfig = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'));

    const nsis = builderConfig.nsis;
    expect(nsis, 'NSIS configuration block must exist in electron-builder.json').toBeDefined();
    expect(nsis.createDesktopShortcut, 'NSIS desktop shortcut should be true').toBe(true);
    expect(nsis.createStartMenuShortcut, 'NSIS start menu shortcut should be true').toBe(true);
  });

  it('verifies presence of bundled native binary assets in extraResources', () => {
    const binDir = path.join(rootDir, 'extraResources', 'bin');
    const pgsqlBinDir = path.join(rootDir, 'extraResources', 'pgsql', 'bin');

    const requiredBins = ['caddy.exe', 'filebrowser.exe', 'ollama.exe', 'tailscale.exe'];
    for (const bin of requiredBins) {
      const p = path.join(binDir, bin);
      expect(fs.existsSync(p), `Required asset extraResources/bin/${bin} must exist`).toBe(true);
    }

    const pgsqlExe = path.join(pgsqlBinDir, 'postgres.exe');
    const initdbExe = path.join(pgsqlBinDir, 'initdb.exe');
    expect(fs.existsSync(pgsqlExe), 'extraResources/pgsql/bin/postgres.exe must exist').toBe(true);
    expect(fs.existsSync(initdbExe), 'extraResources/pgsql/bin/initdb.exe must exist').toBe(true);
  });
});
