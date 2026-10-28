import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ROUTE_TABLE } from '../../src/shared/contract/routes';

describe('Phase 8 - Acceptance Criteria A3: Clean Repository & DRY Audit', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('asserts no hardcoded default password (admin12345678) exists in src, catalog, or migrations', () => {
    const searchDirs = [
      path.join(rootDir, 'src'),
      path.join(rootDir, 'catalog'),
      path.join(rootDir, 'prisma', 'schema', 'migrations'),
    ];

    const forbiddenString = 'admin12345678';
    const foundViolations: string[] = [];

    function scanDir(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && !entry.name.endsWith('.png') && !entry.name.endsWith('.ico')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes(forbiddenString)) {
            foundViolations.push(fullPath);
          }
        }
      }
    }

    for (const dir of searchDirs) {
      scanDir(dir);
    }

    expect(foundViolations, `Found hardcoded password in: ${foundViolations.join(', ')}`).toEqual([]);
  });

  it('asserts no simulators are referenced in release build scripts or packaging configs', () => {
    const packageJsonPath = path.join(rootDir, 'package.json');
    const electronBuilderPath = path.join(rootDir, 'electron-builder.json');

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const builder = JSON.parse(fs.readFileSync(electronBuilderPath, 'utf8'));

    // Release build scripts must not invoke compile:mocks or compile:binaries
    const buildScripts = [
      pkg.scripts['build'],
      pkg.scripts['build:electron'],
      pkg.scripts['build:next'],
      pkg.scripts['build:installer'],
      pkg.scripts['build:portable'],
      pkg.scripts['dist:dir'],
      pkg.scripts['dist:win'],
      pkg.scripts['dist:portable'],
    ];

    for (const script of buildScripts) {
      if (script) {
        expect(script).not.toContain('compile:mocks');
        expect(script).not.toContain('tools/mocks');
      }
    }

    // electron-builder files and extraResources must not include tools/mocks
    const extraResourcesJson = JSON.stringify(builder.extraResources || []);
    expect(extraResourcesJson).not.toContain('tools/mocks');
    expect(extraResourcesJson).not.toContain('tools\\mocks');
  });

  it('asserts zero duplicate route definitions exist in ROUTE_TABLE', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const route of ROUTE_TABLE) {
      const key = `${route.method.toUpperCase()} ${route.path.toLowerCase()}`;
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }

    expect(duplicates, `Found duplicate route definitions: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('asserts zero Electron imports exist anywhere in the src/daemon codebase (Zero-Electron Rule)', () => {
    const daemonDir = path.join(rootDir, 'src', 'daemon');
    const violations: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes("from 'electron'") || content.includes('require("electron")') || content.includes("require('electron')")) {
            violations.push(fullPath);
          }
        }
      }
    }

    scanDir(daemonDir);
    expect(violations, `Violations of Zero-Electron Rule in: ${violations.join(', ')}`).toEqual([]);
  });
});
