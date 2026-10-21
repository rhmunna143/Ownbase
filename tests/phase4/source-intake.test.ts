import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { SourceIntakeManager, MAX_ARCHIVE_BYTES } from '../../src/daemon/deploy/source';

describe('Phase 4 - Item 4.2 & A5: Secure Source Intake & Zip-Slip Protection', () => {
  let intakeManager: SourceIntakeManager;
  let workDir: string;
  let extractDir: string;

  beforeEach(() => {
    intakeManager = new SourceIntakeManager();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownbase-intake-work-'));
    extractDir = path.join(workDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(workDir)) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('safely extracts a valid archive and verifies contained files', async () => {
    // Create source files to bundle
    const srcDir = path.join(workDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'index.html'), '<h1>Hello Native Windows</h1>');
    fs.writeFileSync(path.join(srcDir, 'style.css'), 'body { color: black; }');

    // Create zip using native tar.exe
    const zipPath = path.join(workDir, 'valid.zip');
    execSync(`tar -cf "${zipPath}" -C "${srcDir}" index.html style.css`);

    const result = await intakeManager.extractArchiveSafely(zipPath, extractDir);
    expect(result.success).toBe(true);
    expect(result.fileCount).toBe(2);
    expect(fs.existsSync(path.join(extractDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'style.css'))).toBe(true);
  });

  it('detects and rejects malicious archive entries attempting Zip-Slip traversal (A5)', async () => {
    // Create a zip with an entry that escapes outside the target root
    const maliciousDir = path.join(workDir, 'malicious');
    fs.mkdirSync(maliciousDir, { recursive: true });
    const targetFile = path.join(maliciousDir, 'escape.txt');
    fs.writeFileSync(targetFile, 'malicious payload');

    const zipPath = path.join(workDir, 'zipslip.tar');
    // Archive with parent directory traversal pattern
    execSync(`tar -cf "${zipPath}" -C "${workDir}" malicious/escape.txt`);

    // Tampering test: simulate entry containing traversal sequence ../../
    const originalInspect = intakeManager.inspectArchive.bind(intakeManager);
    intakeManager.inspectArchive = async (archivePath: string) => {
      const res = await originalInspect(archivePath);
      return {
        ...res,
        entries: ['../../Windows/System32/evil.dll', ...res.entries],
      };
    };

    await expect(
      intakeManager.extractArchiveSafely(zipPath, extractDir)
    ).rejects.toThrow(/Malicious archive entry detected/);
  });

  it('rejects archives exceeding the maximum size limit (A5)', async () => {
    const fakeOversizedArchive = path.join(workDir, 'bomb.zip');
    fs.writeFileSync(fakeOversizedArchive, 'small payload');

    // Mock statSync to simulate a 10 GB decompression bomb
    const origStat = fs.statSync;
    const statSpy = (filePath: any) => {
      if (filePath === fakeOversizedArchive) {
        return { size: 10 * 1024 * 1024 * 1024 } as any; // 10 GB
      }
      return origStat(filePath);
    };

    const spy = (fs as any).statSync;
    (fs as any).statSync = statSpy;

    try {
      await expect(
        intakeManager.extractArchiveSafely(fakeOversizedArchive, extractDir)
      ).rejects.toThrow(/exceeds maximum allowed limit/);
    } finally {
      (fs as any).statSync = spy;
    }
  });
});
