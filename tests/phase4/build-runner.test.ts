import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BuildRunner } from '../../src/daemon/deploy/build/runner';

describe('Phase 4 - Item 4.4 & A2: Supervised Build Runners in Job Objects', () => {
  let runner: BuildRunner;
  let workDir: string;

  beforeEach(() => {
    runner = new BuildRunner();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownbase-build-runner-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(workDir)) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('executes a successful build command and captures streamed logs', async () => {
    const logsReceived: string[] = [];
    const command = process.platform === 'win32'
      ? 'echo Building Ownbase App && echo Artifacts generated'
      : 'echo "Building Ownbase App" && echo "Artifacts generated"';

    const result = await runner.run({
      projectDir: workDir,
      command,
      onLog: (line) => logsReceived.push(line),
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.logs).toContain('Building Ownbase App');
    expect(result.logs).toContain('Artifacts generated');
    expect(logsReceived.length).toBeGreaterThan(0);
  });

  it('fails gracefully on non-zero exit and captures failing logs without throwing (A2)', async () => {
    const command = process.platform === 'win32'
      ? 'exit /b 42'
      : 'exit 42';

    const result = await runner.run({
      projectDir: workDir,
      command,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
    expect(result.error).toContain('Build process failed with exit code 42');
  });

  it('terminates and times out when build duration exceeds timeout limit', async () => {
    // 500ms timeout with command that sleeps for 5 seconds
    const command = process.platform === 'win32'
      ? 'ping -n 6 127.0.0.1 > nul'
      : 'sleep 5';

    const result = await runner.run({
      projectDir: workDir,
      command,
      timeoutMs: 500,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain('timed out');
  });

  it('returns early when build command is empty or whitespace', async () => {
    const result = await runner.run({
      projectDir: workDir,
      command: '   ',
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.logs).toContain('skipping build step');
  });
});
