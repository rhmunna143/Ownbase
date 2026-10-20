import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * P5 Security Defect: Hardcoded Default Credentials & Insecure Authentication Defaults
 * 
 * Requirement FR2 / Item 1.10: Default credentials (admin / admin12345678) must not exist
 * hardcoded anywhere in the codebase or UI. First-run provisioning must require an interactive
 * setup wizard with strong user-generated passwords.
 * 
 * Expected in Phase 0: FAIL (Current prototype has admin12345678 hardcoded in supervisor, UI components, and README).
 */
describe('P5: Elimination of Hardcoded Default Credentials', () => {
  const FORBIDDEN_PASSWORD = 'admin12345678';
  const SCAN_DIRS = ['src', 'scripts', 'prisma'];

  function scanDirectory(dir: string): string[] {
    const results: string[] = [];
    const fullPath = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) return results;

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      const res = path.join(fullPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanDirectory(path.relative(process.cwd(), res)));
      } else if (/\.(ts|tsx|js|mjs|json|md)$/.test(entry.name)) {
        const content = fs.readFileSync(res, 'utf-8');
        if (content.includes(FORBIDDEN_PASSWORD)) {
          results.push(path.relative(process.cwd(), res));
        }
      }
    }
    return results;
  }

  it('ensures no hardcoded default passwords exist in active source code (src/)', () => {
    const srcMatches = scanDirectory('src');
    // Secure expectation: zero occurrences in src/
    expect(srcMatches).toEqual([]);
  });

  it('ensures supervisor.ts does not auto-initialize accounts with hardcoded default password', () => {
    const supervisorPath = path.resolve(process.cwd(), 'src/main/supervisor.ts');
    const content = fs.readFileSync(supervisorPath, 'utf-8');
    expect(content.includes(FORBIDDEN_PASSWORD)).toBe(false);
  });
});
