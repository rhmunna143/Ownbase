import { ipcMain, app } from 'electron';
import os from 'os';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { logger } from './logger';
import { BootstrapStep, SystemInfo } from '../shared/types';

export function registerIpcHandlers(
  postgresManager: PostgresManager,
  prismaManager: PrismaManager,
  getBootstrapSteps: () => BootstrapStep[]
) {
  ipcMain.handle('get-system-info', async (): Promise<SystemInfo> => {
    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      appDataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
    };
  });

  ipcMain.handle('get-postgres-status', async () => {
    return postgresManager.getStatus();
  });

  ipcMain.handle('get-migration-status', async () => {
    return prismaManager.getStatus();
  });

  ipcMain.handle('get-bootstrap-steps', async () => {
    return getBootstrapSteps();
  });

  ipcMain.handle('ping-database', async () => {
    logger.info('ipc', 'Received ping-database request from renderer');
    const result = await prismaManager.ping();
    logger.info('ipc', `Database ping response: success=${result.success}, latency=${result.latencyMs}ms`);
    return result;
  });

  ipcMain.handle('get-services', async () => {
    try {
      return await prismaManager.getServices();
    } catch (err: any) {
      logger.error('ipc', `Failed to get services: ${err.message}`);
      return [];
    }
  });

  ipcMain.handle('create-service', async (_event, data) => {
    logger.info('ipc', `Creating service via Prisma: ${data.name} (${data.type})`);
    return await prismaManager.createService(data);
  });

  ipcMain.handle('get-routes', async () => {
    try {
      return await prismaManager.getRoutes();
    } catch (err: any) {
      logger.error('ipc', `Failed to get routes: ${err.message}`);
      return [];
    }
  });

  ipcMain.handle('create-route', async (_event, data) => {
    logger.info('ipc', `Creating route via Prisma: subdomain=${data.subdomain} -> port=${data.targetPort}`);
    return await prismaManager.createRoute(data);
  });

  ipcMain.handle('get-logs', async () => {
    return logger.getLogs();
  });
}
