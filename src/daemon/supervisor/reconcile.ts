import { PrismaManager } from '../db/prisma';
import { logger } from '../core/logger';

/**
 * Checks if a PID is actively running on the system.
 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 tests process existence without killing it
    return true;
  } catch (err: any) {
    return err.code === 'EPERM'; // exists but lacking permissions to signal
  }
}

/**
 * Reconciles process states in the database on daemon boot to clear stale PIDs from hard crashes.
 */
export async function reconcileStaleProcesses(prismaManager: PrismaManager): Promise<{
  reconciledCount: number;
  clearedServices: string[];
}> {
  logger.info('supervisor', 'Starting boot process reconciliation for stale service records...');
  const client = prismaManager.getClient();
  const services = await client.service.findMany();

  let reconciledCount = 0;
  const clearedServices: string[] = [];

  for (const service of services) {
    if (service.status === 'running' || service.status === 'starting') {
      const pid = service.pid;
      const alive = pid ? isPidAlive(pid) : false;

      if (!alive) {
        logger.warn(
          'supervisor',
          `Detected stale active status for "${service.name}" (recorded PID ${pid} is not alive). Reconciling to stopped.`
        );

        await client.service.update({
          where: { id: service.id },
          data: {
            status: 'stopped',
            pid: null,
          },
        });

        reconciledCount++;
        clearedServices.push(service.name);
      } else {
        logger.info(
          'supervisor',
          `Service "${service.name}" is already alive with PID ${pid}; preserving state.`
        );
      }
    }
  }

  logger.info(
    'supervisor',
    `Reconciliation complete. ${reconciledCount} stale process records cleaned up.`
  );

  return { reconciledCount, clearedServices };
}
