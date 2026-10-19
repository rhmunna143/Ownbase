import { describe, it, expect } from 'vitest';
import path from 'path';
import { FileManager } from '../../src/main/fileManager';

/**
 * P4 Security Defect: Path Traversal and Arbitrary File Access in safeResolve
 * 
 * Requirement FR4 / Item 1.8: All path resolution must strictly verify containment
 * inside the configured storage root using PathGuard.
 * Any input that escapes the root (via nested traversal ....//, absolute Windows paths,
 * or alternate data streams) MUST be rejected.
 * 
 * Expected in Phase 0: FAIL (Current prototype's safeResolve is vulnerable to ....// and absolute drive paths).
 */
describe('P4: Path Traversal & Containment Guard', () => {
  const fileManager = new FileManager();
  const root = fileManager.getStorageDirectory();

  function isContained(resolvedPath: string, expectedRoot: string): boolean {
    const relative = path.relative(expectedRoot, resolvedPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  it('rejects nested traversal strings like ....//....// escaping the root', () => {
    const maliciousInput = '....//....//....//....//Windows/win.ini';
    const resolved = fileManager.safeResolve(maliciousInput);

    // Secure expectation: resolved path MUST be strictly contained inside storageDir
    const contained = isContained(resolved, root);
    expect(contained).toBe(true);
  });

  it('rejects absolute Windows drive paths (e.g. C:\\Windows\\System32)', () => {
    const maliciousInput = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    const resolved = fileManager.safeResolve(maliciousInput);

    // Secure expectation: absolute input outside storage must be rejected or trapped in root
    const contained = isContained(resolved, root);
    expect(contained).toBe(true);
  });

  it('rejects backslash traversal strings like ..\\..\\ escaping the root', () => {
    const maliciousInput = '..\\..\\..\\..\\Windows\\System32\\cmd.exe';
    const resolved = fileManager.safeResolve(maliciousInput);

    const contained = isContained(resolved, root);
    expect(contained).toBe(true);
  });

  it('rejects Windows Alternate Data Streams (ADS) and reserved device names', () => {
    const adsInput = 'storage_test.txt::$DATA';
    const resolved = fileManager.safeResolve(adsInput);

    // Secure expectation: ADS must not be resolved blindly as valid storage file
    expect(resolved).not.toContain('::$DATA');
  });
});
