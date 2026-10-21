import { describe, it, expect } from 'vitest';
import { spawnInJob } from '../../src/daemon/supervisor/jobhost';

describe('Phase 3 - Item 3.3: Windows Job Object Sandboxing & Metrics', () => {
  it('spawns a child process enclosed in a Job Object with limits', async () => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'cmd.exe' : 'sleep';
    const args = isWindows ? ['/c', 'timeout /t 5 /nobreak >nul'] : ['5'];

    const job = await spawnInJob({
      executable: cmd,
      args,
      cwd: process.cwd(),
      env: {},
      limits: {
        maxMemoryMb: 512,
        cpuLimitPct: 50,
      },
      killOnClose: true,
    });

    expect(job.pid).toBeGreaterThan(0);
    expect(job.child).toBeDefined();

    if (isWindows) {
      expect(job.isJobObjectActive).toBe(true);
      const metrics = job.getMetrics();
      if (metrics) {
        expect(metrics.pid).toBe(job.pid);
        expect(metrics.activeProcesses).toBeGreaterThanOrEqual(1);
      }
    }

    // Gracefully stop the job
    await job.stop(1000);
    expect(job.child.killed || job.child.exitCode !== null).toBe(true);
  });
});
