import { ipcMain, app } from 'electron';
import os from 'os';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { ProcessSupervisor } from './supervisor';
import { CaddyManager } from './caddy';
import { TailscaleManager } from './tailscale';
import { LifecycleManager } from './lifecycle';
import { logger } from './logger';
import { BootstrapStep, SystemInfo } from '../shared/types';

import { TableBrowser } from './db/browser';

export function registerIpcHandlers(
  postgresManager: PostgresManager,
  prismaManager: PrismaManager,
  supervisor: ProcessSupervisor,
  caddyManager: CaddyManager,
  tailscaleManager: TailscaleManager,
  lifecycleManager: LifecycleManager,
  getBootstrapSteps: () => BootstrapStep[]
) {
  const tableBrowser = new TableBrowser(prismaManager);
  ipcMain.handle('get-system-info', async (): Promise<SystemInfo> => {
    const interfaces = os.networkInterfaces();
    let localIp = '127.0.0.1';
    let tailscaleIp: string | undefined = undefined;
    const allIps: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
          allIps.push(net.address);
          if (name.toLowerCase().includes('tailscale') || net.address.startsWith('100.')) {
            tailscaleIp = net.address;
          } else if (localIp === '127.0.0.1') {
            localIp = net.address;
          }
        }
      }
    }

    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      appDataDir: (app && typeof app.getPath === 'function') ? app.getPath('userData') : process.cwd(),
      appVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : '0.1.0',
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
      localIp,
      tailscaleIp,
      allIps,
    };
  });

  ipcMain.handle('get-postgres-status', async () => {
    return postgresManager.getStatus();
  });

  ipcMain.handle('get-migration-status', async () => {
    return prismaManager.getStatus();
  });

  ipcMain.handle('get-bootstrap-steps', async () => {
    try {
      const tsStatus = await tailscaleManager.getStatus();
      const steps = getBootstrapSteps();
      const tsStep = steps.find((s) => s.id === 'tailscale-mesh');
      if (tsStep) {
        if (tsStatus.connected) {
          tsStep.status = 'success';
          tsStep.detail = tsStatus.ip ? `Connected (Mesh IP: ${tsStatus.ip})` : 'Connected to mesh network';
          tsStep.timestamp = new Date().toISOString();
        } else if (tsStep.status === 'success') {
          tsStep.status = 'pending';
          tsStep.detail = 'Tailscale CLI ready (configure Auth Key to connect)';
          tsStep.timestamp = new Date().toISOString();
        }
      }
    } catch {}
    return getBootstrapSteps();
  });

  ipcMain.handle('ping-database', async () => {
    logger.info('ipc', 'Received ping-database request from renderer');
    const result = await prismaManager.ping();
    logger.info('ipc', `Database ping response: success=${result.success}, latency=${result.latencyMs}ms`);
    return result;
  });

  // Item 1.7: Read-only Table Browser IPC Handlers (replaces arbitrary execute-query)
  ipcMain.handle('table-browser:get-tables', async () => {
    return tableBrowser.getPermittedTables();
  });

  ipcMain.handle('table-browser:query-table', async (_event, table: string, options: any) => {
    try {
      return await tableBrowser.queryTable(table, options);
    } catch (err: any) {
      return { error: err.message, rows: [], totalCount: 0, columns: [] };
    }
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
    const status = await tailscaleManager.getStatus();
    const tsStep = getBootstrapSteps().find((s) => s.id === 'tailscale-mesh');
    if (tsStep) {
      if (status.connected) {
        tsStep.status = 'success';
        tsStep.detail = status.ip ? `Connected (Mesh IP: ${status.ip})` : 'Connected to mesh network';
        tsStep.timestamp = new Date().toISOString();
      } else if (tsStep.status === 'success') {
        tsStep.status = 'pending';
        tsStep.detail = 'Tailscale CLI ready (configure Auth Key to connect)';
        tsStep.timestamp = new Date().toISOString();
      }
    }
    return status;
  });

  ipcMain.handle('tailscale:connect', async (_event, authKey: string, hostname?: string) => {
    logger.info('ipc', 'Received tailscale:connect request');
    const res = await tailscaleManager.connect(authKey, hostname);
    if (res.success) {
      const tsStep = getBootstrapSteps().find((s) => s.id === 'tailscale-mesh');
      if (tsStep) {
        tsStep.status = 'success';
        tsStep.detail = res.ip ? `Connected (Mesh IP: ${res.ip})` : 'Connected to mesh network';
        tsStep.timestamp = new Date().toISOString();
      }
    }
    return res;
  });

  ipcMain.handle('tailscale:disconnect', async () => {
    logger.info('ipc', 'Received tailscale:disconnect request');
    const res = await tailscaleManager.disconnect();
    if (res.success) {
      const tsStep = getBootstrapSteps().find((s) => s.id === 'tailscale-mesh');
      if (tsStep) {
        tsStep.status = 'pending';
        tsStep.detail = 'Tailscale CLI ready (configure Auth Key to connect)';
        tsStep.timestamp = new Date().toISOString();
      }
    }
    return res;
  });

  // Phase 4: System Integration & App Lifecycle Handlers
  ipcMain.handle('lifecycle:get-status', async () => {
    return lifecycleManager.getStatus();
  });

  ipcMain.handle('lifecycle:set-auto-start', async (_event, enabled: boolean, openAsHidden?: boolean) => {
    logger.info('ipc', `Received lifecycle:set-auto-start request: enabled=${enabled}, openAsHidden=${openAsHidden}`);
    return await lifecycleManager.setAutoStart(enabled, openAsHidden);
  });

  ipcMain.handle('lifecycle:set-power-blocker', async (_event, enabled: boolean) => {
    logger.info('ipc', `Received lifecycle:set-power-blocker request: enabled=${enabled}`);
    return await lifecycleManager.setPowerSaveBlocker(enabled);
  });

  ipcMain.handle('lifecycle:minimize-to-tray', async () => {
    logger.info('ipc', 'Received lifecycle:minimize-to-tray request');
    lifecycleManager.minimizeToTray();
  });

  ipcMain.handle('lifecycle:quit-app', async () => {
    logger.info('ipc', 'Received lifecycle:quit-app request');
    lifecycleManager.quitApp();
  });

  ipcMain.handle('get-logs', async () => {
    return logger.getLogs();
  });
}
