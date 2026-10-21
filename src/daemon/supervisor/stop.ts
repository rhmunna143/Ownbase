import { execFile } from 'child_process';
import { logger } from '../core/logger';
import { ManagedJob } from './jobhost';

export interface GracefulStopOptions {
  job?: ManagedJob | null;
  pid?: number | null;
  timeoutMs?: number;
  serviceName?: string;
}

/**
 * Performs a graceful shutdown of a process, asking it to stop via job host / Ctrl-Break,
 * waiting the configured timeout, and terminating the job object if it does not exit.
 * Completely replaces blind 'taskkill /T /F' as the primary shutdown path.
 */
export async function gracefulStopProcess(options: GracefulStopOptions): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const name = options.serviceName || 'process';

  // 1. Primary path: Use ManagedJob Win32 Job Object shutdown
  if (options.job) {
    logger.info('supervisor', `Requesting graceful stop for "${name}" (PID: ${options.job.pid})...`);
    try {
      await options.job.stop(timeoutMs);
      logger.success('supervisor', `Graceful stop completed for "${name}".`);
      return true;
    } catch (err: any) {
      logger.warn('supervisor', `Notice during graceful stop for "${name}": ${err.message}`);
    }
  }

  // 2. Fallback path if only PID is known (e.g. unmanaged PID or adopted process)
  const pid = options.pid;
  if (!pid || pid <= 0) {
    return true;
  }

  return new Promise((resolve) => {
    logger.info('supervisor', `Sending termination signal to PID ${pid} for "${name}"...`);

    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', pid.toString(), '/T', '/F'], { windowsHide: true }, (err, stdout) => {
        if (stdout) logger.info('supervisor', `[taskkill] ${stdout.trim()}`);
        if (err && !err.message.includes('not found')) {
          logger.warn('supervisor', `taskkill note for PID ${pid}: ${err.message}`);
        }
        resolve(true);
      });
    } else {
      try {
        process.kill(pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
          resolve(true);
        }, timeoutMs);
      } catch {
        resolve(true);
      }
    }
  });
}
