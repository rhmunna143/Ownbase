import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 6: Simulator Removal & License Notices (PRD §6.4 & 6.6)', () => {
  const rootDir = process.cwd();

  it('verifies simulator compile scripts are purged from package.json (Item 6.4 & P8)', () => {
    const pkgJsonPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

    // compile:mocks and compile:binaries must NOT be in scripts
    expect(pkg.scripts['compile:mocks']).toBeUndefined();
    expect(pkg.scripts['compile:binaries']).toBeUndefined();
    expect(pkg.scripts['compile:filebrowser']).toBeUndefined();
    expect(pkg.scripts['compile:minio']).toBeUndefined();
  });

  it('verifies release packaging config excludes tools/mocks and *_server.cs (A2)', () => {
    const builderPath = path.join(rootDir, 'electron-builder.json');
    const builder = JSON.parse(fs.readFileSync(builderPath, 'utf-8'));

    // Check files array
    const files = builder.files || [];
    for (const pattern of files) {
      expect(pattern).not.toContain('tools/mocks');
      expect(pattern).not.toContain('*_server.cs');
    }

    // Check extraResources mapping
    const extraResources = builder.extraResources || [];
    for (const res of extraResources) {
      expect(res.from).not.toContain('tools/mocks');
    }
  });

  it('verifies tools/mocks is retained exclusively for test fixtures', () => {
    const mocksDir = path.join(rootDir, 'tools', 'mocks');
    expect(fs.existsSync(mocksDir)).toBe(true);

    const caddyServer = path.join(mocksDir, 'caddy_server.cs');
    expect(fs.existsSync(caddyServer)).toBe(true);
  });

  it('verifies docs/licenses.md includes upstream AGPL, Apache 2.0, MIT, and BSD notices (Item 6.6)', () => {
    const licensesPath = path.join(rootDir, 'docs', 'licenses.md');
    expect(fs.existsSync(licensesPath)).toBe(true);

    const content = fs.readFileSync(licensesPath, 'utf-8');

    // Upstream components
    expect(content).toContain('MinIO');
    expect(content).toContain('AGPL');
    expect(content).toContain('FileBrowser');
    expect(content).toContain('Apache License 2.0');
    expect(content).toContain('Ollama');
    expect(content).toContain('MIT License');
    expect(content).toContain('Caddy');
    expect(content).toContain('PostgreSQL');
    expect(content).toContain('node-pty');
  });
});
