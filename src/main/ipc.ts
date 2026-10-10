import { ipcMain, app } from 'electron';
import os from 'os';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { ProcessSupervisor } from './supervisor';
import { CaddyManager } from './caddy';
import { TailscaleManager } from './tailscale';
import { logger } from './logger';
import { BootstrapStep, SystemInfo } from '../shared/types';

export function registerIpcHandlers(
  postgresManager: PostgresManager,
  prismaManager: PrismaManager,
  supervisor: ProcessSupervisor,
  caddyManager: CaddyManager,
  tailscaleManager: TailscaleManager,
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
      const services = await prismaManager.getServices();
      for (const s of services) {
        supervisor.registerService(s);
      }
      return services;
    } catch (err: any) {
      logger.error('ipc', `Failed to get services: ${err.message}`);
      return [];
    }
  });

  ipcMain.handle('create-service', async (_event, data) => {
    logger.info('ipc', `Creating service via Prisma: ${data.name} (${data.type})`);
    const service = await prismaManager.createService(data);
    supervisor.registerService(service);
    return service;
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
    const route = await prismaManager.createRoute(data);
    // Phase 3: dynamically register with Caddy Admin REST API without server restart
    try {
      await caddyManager.registerRoute(route);
    } catch (err: any) {
      logger.warn('caddy', `Notice: could not register route with Caddy REST API yet: ${err.message}`);
    }
    return route;
  });

  ipcMain.handle('delete-route', async (_event, routeId: string) => {
    logger.info('ipc', `Deleting route ID: ${routeId}`);
    try {
      const client = prismaManager.getClient();
      await client.route.delete({ where: { id: routeId } });
      await caddyManager.removeRoute(routeId);
      return true;
    } catch (err: any) {
      logger.error('ipc', `Failed to delete route: ${err.message}`);
      return false;
    }
  });

  // Phase 2: Process Supervisor IPC Handlers
  ipcMain.handle('supervisor:start-service', async (_event, serviceId: string) => {
    logger.info('ipc', `Requested to start service ID: ${serviceId}`);
    const res = await supervisor.startService(serviceId);
    // If starting Caddy, sync all routes after it launches
    const status = supervisor.getStatus(serviceId);
    if (res.success && status?.type === 'caddy') {
      setTimeout(() => {
        caddyManager.syncAllRoutes().catch(() => {});
      }, 1500);
    }
    return res;
  });

  ipcMain.handle('supervisor:stop-service', async (_event, serviceId: string) => {
    logger.info('ipc', `Requested to stop service ID: ${serviceId}`);
    return await supervisor.stopService(serviceId);
  });

  ipcMain.handle('supervisor:restart-service', async (_event, serviceId: string) => {
    logger.info('ipc', `Requested to restart service ID: ${serviceId}`);
    const res = await supervisor.restartService(serviceId);
    const status = supervisor.getStatus(serviceId);
    if (res.success && status?.type === 'caddy') {
      setTimeout(() => {
        caddyManager.syncAllRoutes().catch(() => {});
      }, 1500);
    }
    return res;
  });

  ipcMain.handle('supervisor:get-process-statuses', async () => {
    return supervisor.getAllStatuses();
  });

  ipcMain.handle('supervisor:get-service-logs', async (_event, serviceId: string) => {
    return supervisor.getServiceLogs(serviceId);
  });

  // Phase 3: Caddy Dynamic Reverse Proxy Handlers
  ipcMain.handle('caddy:get-status', async () => {
    return await caddyManager.getStatus();
  });

  ipcMain.handle('caddy:sync-routes', async () => {
    logger.info('ipc', 'Received caddy:sync-routes request');
    return await caddyManager.syncAllRoutes();
  });

  ipcMain.handle('caddy:test-route', async (_event, host: string) => {
    logger.info('ipc', `Testing upstream proxy for host: ${host}`);
    return await caddyManager.testRoute(host);
  });

  // Phase 3: Tailscale Mesh Tunneling Handlers
  ipcMain.handle('tailscale:get-status', async () => {
    return await tailscaleManager.getStatus();
  });

  ipcMain.handle('tailscale:connect', async (_event, authKey: string, hostname?: string) => {
    logger.info('ipc', 'Received tailscale:connect request');
    return await tailscaleManager.connect(authKey, hostname);
  });

  ipcMain.handle('tailscale:disconnect', async () => {
    logger.info('ipc', 'Received tailscale:disconnect request');
    return await tailscaleManager.disconnect();
  });

  ipcMain.handle('get-logs', async () => {
    return logger.getLogs();
  });
}
