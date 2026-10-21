import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { RuntimeManager, RuntimeManifestEntry } from '../../src/daemon/deploy/runtimes';

describe('Phase 4 - Item 4.1 & A7: Runtime Manager & Integrity Verification', () => {
  let runtimeManager: RuntimeManager;
  let tempRuntimesDir: string;
  let mockManifest: Record<string, RuntimeManifestEntry>;

  beforeEach(() => {
    tempRuntimesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownbase-runtime-test-'));

    mockManifest = {
      node: {
        id: 'node',
        name: 'Node.js LTS',
        version: '24.0.0',
        useHost: true,
        binPath: 'node.exe',
        url: 'https://example.com/node.zip',
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      },
      'test-tool': {
        id: 'test-tool',
        name: 'Test Tool',
        version: '1.0.0',
        useHost: false,
        binPath: 'test.exe',
        url: 'https://example.com/test.zip',
        sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
    };

    runtimeManager = new RuntimeManager(mockManifest, tempRuntimesDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempRuntimesDir)) {
      try {
        fs.rmSync(tempRuntimesDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('reuses the host Node.js runtime without downloading', async () => {
    const resolved = await runtimeManager.resolveRuntime('node');
    expect(resolved.id).toBe('node');
    expect(resolved.isHost).toBe(true);
    expect(resolved.executable).toBe(process.execPath);
    expect(fs.existsSync(resolved.executable)).toBe(true);
  });

  it('computes accurate SHA-256 hash for local files', async () => {
    const testFile = path.join(tempRuntimesDir, 'sample.txt');
    const content = 'Hello Ownbase Runtime Manager';
    fs.writeFileSync(testFile, content, 'utf-8');

    const expectedHash = crypto.createHash('sha256').update(content).digest('hex').toLowerCase();
    const actualHash = await runtimeManager.computeFileSha256(testFile);

    expect(actualHash).toBe(expectedHash);
  });

  it('rejects installation and throws on SHA-256 mismatch (A7)', async () => {
    const corruptedArchive = path.join(tempRuntimesDir, 'corrupted.zip');
    fs.writeFileSync(corruptedArchive, 'tampered-archive-content');

    // Expected hash is deadbeef... but actual is different
    await expect(
      runtimeManager.installLocalArchive('test-tool', corruptedArchive)
    ).rejects.toThrow(/Runtime checksum mismatch for "test-tool"/);
  });

  it('throws an error for unrecognized runtime ids', async () => {
    await expect(runtimeManager.resolveRuntime('ruby-on-rails')).rejects.toThrow(/Unknown runtime requested/);
  });
});
