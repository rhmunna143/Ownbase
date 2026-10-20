import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P16: Decoupled Headless Daemon (Zero Electron Imports)', () => {
  function scanDir(dir: string, results: string[] = []): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full, results);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        results.push(full);
      }
    }
    return results;
  }

  it('ensures no file under src/daemon imports electron', () => {
    const daemonRoot = path.resolve(__dirname, '../../src/daemon');
    expect(fs.existsSync(daemonRoot)).toBe(true);

    const files = scanDir(daemonRoot);
    expect(files.length).toBeGreaterThan(0);

    const violations: { file: string; line: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /from\s+['"]electron['"]/.test(line) ||
          /require\s*\(\s*['"]electron['"]\s*\)/.test(line) ||
          /from\s+['"]electron\/.*['"]/.test(line)
        ) {
          violations.push({
            file: path.relative(path.resolve(__dirname, '../..'), file),
            line: `L${i + 1}: ${line.trim()}`,
          });
        }
      }
    }

    expect(
      violations,
      `Detected disallowed electron imports in src/daemon:\n${violations.map((v) => `${v.file} -> ${v.line}`).join('\n')}`
    ).toEqual([]);
  });
});
