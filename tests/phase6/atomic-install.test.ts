import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ServiceInstaller } from '../../src/daemon/deploy/serviceInstaller';
import { CatalogRecipe } from '../../src/daemon/deploy/catalog';

describe('Phase 6: Atomic Installation & Checksum Verification (PRD A1 & A5)', () => {
  let tempBinDir: string;
  let tempDownloadsDir: string;
  let installer: ServiceInstaller;

  beforeEach(() => {
    tempBinDir = path.join(process.cwd(), '.data', `test-bin-${Date.now()}`);
    tempDownloadsDir = path.join(process.cwd(), '.data', `test-downloads-${Date.now()}`);
    fs.mkdirSync(tempBinDir, { recursive: true });
    fs.mkdirSync(tempDownloadsDir, { recursive: true });
    installer = new ServiceInstaller(tempBinDir, tempDownloadsDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempBinDir)) {
      try { fs.rmSync(tempBinDir, { recursive: true, force: true }); } catch {}
    }
    if (fs.existsSync(tempDownloadsDir)) {
      try { fs.rmSync(tempDownloadsDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('installs service binary atomically when checksum is valid (A1)', async () => {
    const dummyContent = 'MZ-DUMMY-OFFICIAL-BINARY-CONTENT-64BIT';
    const sourceFile = path.join(tempDownloadsDir, 'source.exe');
    fs.writeFileSync(sourceFile, dummyContent);

    const validHash = crypto.createHash('sha256').update(dummyContent).digest('hex');

    const recipe: CatalogRecipe = {
      id: 'test-service',
      name: 'Test Service',
      version: '1.0.0',
      category: 'Tools',
      description: 'Test binary',
      runtime: 'native',
      icon: 'Boxes',
      isPackaged: true,
      defaultPort: 9999,
      defaultSubdomain: 'test',
      env: {},
      spec: {
        command: 'test-service.exe',
        args: [],
        healthPath: '/',
        maxMemoryMb: 256,
      },
      source: {
        type: 'binary',
        url: 'https://example.com/test-service.exe',
        sha256: validHash,
      },
    };

    const res = await installer.verifyAndInstall(recipe, { localSourcePath: sourceFile });
    expect(res.success).toBe(true);
    expect(res.hash).toBe(validHash);
    expect(fs.existsSync(res.binaryPath)).toBe(true);

    // Verify temp files are completely cleaned up (A5)
    const tempFiles = fs.readdirSync(tempDownloadsDir).filter((f) => f.includes('install-'));
    expect(tempFiles).toHaveLength(0);
  });

  it('rejects tampered binary when checksum does not match expected hash (A1)', async () => {
    const originalContent = 'AUTHENTIC-BINARY-PAYLOAD';
    const tamperedContent = 'TAMPERED-MALICIOUS-PAYLOAD';

    const sourceFile = path.join(tempDownloadsDir, 'tampered.exe');
    fs.writeFileSync(sourceFile, tamperedContent);

    const expectedHash = crypto.createHash('sha256').update(originalContent).digest('hex');

    const recipe: CatalogRecipe = {
      id: 'tampered-service',
      name: 'Tampered Service',
      version: '1.0.0',
      category: 'Tools',
      description: 'Test binary',
      runtime: 'native',
      icon: 'Boxes',
      isPackaged: true,
      defaultPort: 9998,
      defaultSubdomain: 'tampered',
      env: {},
      spec: {
        command: 'tampered-service.exe',
        args: [],
        healthPath: '/',
        maxMemoryMb: 256,
      },
      source: {
        type: 'binary',
        url: 'https://example.com/tampered.exe',
        sha256: expectedHash,
      },
    };

    await expect(
      installer.verifyAndInstall(recipe, { localSourcePath: sourceFile })
    ).rejects.toThrow(/Checksum verification failed/);

    // Verify no corrupted binary was placed in binDir (A5 atomic safety)
    const targetBinary = path.join(tempBinDir, 'tampered-service.exe');
    expect(fs.existsSync(targetBinary)).toBe(false);

    // Verify temp download files are removed
    const leftoverTemp = fs.readdirSync(tempDownloadsDir).filter((f) => f.includes('install-tampered-service'));
    expect(leftoverTemp).toHaveLength(0);
  });

  it('guarantees atomic cleanup leaving no half-installed service on error (A5)', async () => {
    const brokenRecipe: CatalogRecipe = {
      id: 'crash-service',
      name: 'Crash Service',
      version: '1.0.0',
      category: 'Tools',
      description: 'Crash simulation',
      runtime: 'native',
      icon: 'Boxes',
      isPackaged: true,
      defaultPort: 9997,
      defaultSubdomain: 'crash',
      env: {},
      spec: {
        command: 'crash.exe',
        args: [],
        healthPath: '/',
        maxMemoryMb: 256,
      },
      source: {
        type: 'binary',
        url: 'https://invalid-host-that-does-not-exist-12345.org/binary.exe',
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      },
    };

    await expect(installer.verifyAndInstall(brokenRecipe)).rejects.toThrow();

    // Destination executable must not exist
    expect(fs.existsSync(path.join(tempBinDir, 'crash.exe'))).toBe(false);

    // Temporary files must be completely purged
    const tempFiles = fs.readdirSync(tempDownloadsDir).filter((f) => f.includes('crash-service'));
    expect(tempFiles).toHaveLength(0);
  });
});
