import { paths, pathsManager } from './core/paths';
import { config } from './core/config';
import { logger } from './core/logger';
import { secretsManager } from './core/secrets';
import { powerManager } from './core/power';
import { postgresManager } from './db/postgres';
import { prismaManager } from './db/prisma';
import { ProcessSupervisor } from './supervisor/supervisor';
import { CaddyManager } from './network/caddy';
import { TailscaleManager } from './network/tailscale';
import { WebApiServer } from './gateway/httpServer';
import { BootstrapStep } from '../shared/types';
import { hostBuilder } from './core/hostBuilder';

const bootstrapSteps: BootstrapStep[] = [
  { id: 'paths-init', name: 'Path Environment', description: `Resolved ${paths.mode} mode data root`, status: 'pending' },
  { id: 'config-init', name: 'Configuration & Secrets', description: 'Loaded validated config.json and master data key', status: 'pending' },
  { id: 'gateway-early', name: 'API Gateway', description: 'Early HTTP listener on loopback port 3001', status: 'pending' },
  { id: 'postgres-init', name: 'PostgreSQL Database', description: 'Hardened loopback engine with scram-sha-256', status: 'pending' },
  { id: 'prisma-migrate', name: 'Database Migrations', description: 'Bundled Prisma deploy without db push fallback', status: 'pending' },
  { id: 'supervisor-init', name: 'Process Supervisor', description: 'Supervised native processes (caddy, filebrowser, ollama)', status: 'pending' },
  { id: 'caddy-proxy', name: 'Edge Reverse Proxy', description: 'Caddy dynamic reverse proxy and TLS gateway', status: 'pending' },
  { id: 'tailscale-mesh', name: 'Tailscale Mesh', description: 'Secure WireGuard mesh overlay network', status: 'pending' },
  { id: 'power-persistence', name: '24/7 Power Persistence', description: 'Windows system suspension blocker', status: 'pending' },
];

export function updateStep(id: string, status: BootstrapStep['status'], detail?: string) {
  const step = bootstrapSteps.find((s) => s.id === id);
  if (step) {
    step.status = status;
    step.detail = detail;
    step.timestamp = new Date().toISOString();
  }
}

export async function bootstrapDaemon(): Promise<{
  webApiServer: WebApiServer;
  supervisor: ProcessSupervisor;
  caddyManager: CaddyManager;
  tailscaleManager: TailscaleManager;
}> {
  logger.info('daemon', `Starting Ownbase Server Daemon (Mode: ${paths.mode}, Data: ${paths.dataDir})...`);

  // 1. Paths & Config
  const migRes = pathsManager.migrateLegacyDataIfNeeded();
  updateStep('paths-init', 'success', `Mode: ${paths.mode}${migRes.migrated ? ' (Migrated from legacy AppData)' : ''}`);
  updateStep('config-init', 'running');
  secretsManager.getOrCreateDataKey();
  updateStep('config-init', 'success', 'Validated config and 256-bit encryption key');

  // 2. Early API Gateway on 127.0.0.1:3001 (Degraded mode ready)
  updateStep('gateway-early', 'running');
  const supervisor = new ProcessSupervisor(prismaManager);
  const caddyManager = new CaddyManager(prismaManager);
  const tailscaleManager = new TailscaleManager(prismaManager);
  const webApiServer = new WebApiServer(
    postgresManager,
    prismaManager,
    supervisor,
    caddyManager,
    tailscaleManager,
    () => bootstrapSteps,
    config.ports.daemon
  );

  await webApiServer.start();
  updateStep('gateway-early', 'success', `Listening on 127.0.0.1:${config.ports.daemon}`);

  // 3. PostgreSQL Database
  updateStep('postgres-init', 'running');
  try {
    await postgresManager.bootstrap();
    updateStep('postgres-init', 'success', `Running on PID ${postgresManager.getStatus().pid} (port 5432)`);
  } catch (pgErr: any) {
    updateStep('postgres-init', 'error', pgErr.message);
    logger.error('postgres', `Database engine error: ${pgErr.message}. Continuing in degraded mode.`);
  }

  // 4. Prisma Migrations (Fail loudly, no db push fallback)
  updateStep('prisma-migrate', 'running');
  try {
    const migOk = await prismaManager.runMigrations();
    if (migOk) {
      updateStep('prisma-migrate', 'success', 'All Prisma database migrations deployed');
    } else {
      updateStep('prisma-migrate', 'error', 'Prisma migrations failed or database degraded');
    }
  } catch (migErr: any) {
    updateStep('prisma-migrate', 'error', migErr.message);
    logger.error('prisma', `Migration error: ${migErr.message}`);
  }

  // 5. Supervisor Auto-start
  updateStep('supervisor-init', 'running');
  try {
    await supervisor.syncAndAutoStart();
    updateStep('supervisor-init', 'success', 'Supervisor services registered and active');
  } catch (supErr: any) {
    updateStep('supervisor-init', 'error', supErr.message);
    logger.warn('supervisor', `Supervisor auto-start error: ${supErr.message}`);
  }

  // 6. Caddy Route Sync
  updateStep('caddy-proxy', 'running');
  try {
    setTimeout(async () => {
      try {
        const caddyStatus = await caddyManager.getStatus();
        if (caddyStatus.isListening) {
          const syncRes = await caddyManager.syncAllRoutes();
          updateStep('caddy-proxy', 'success', `Caddy active with ${syncRes.count} routes`);
        } else {
          updateStep('caddy-proxy', 'pending', 'Caddy process idle');
        }
      } catch {
        updateStep('caddy-proxy', 'pending', 'Caddy process idle');
      }
    }, 2000);
  } catch (caddyErr: any) {
    updateStep('caddy-proxy', 'error', caddyErr.message);
  }

  // 7. Tailscale Mesh
  updateStep('tailscale-mesh', 'running');
  const syncTailscaleStep = async () => {
    try {
      const tsStatus = await tailscaleManager.getStatus();
      if (tsStatus.connected) {
        updateStep('tailscale-mesh', 'success', tsStatus.ip ? `Connected (Mesh IP: ${tsStatus.ip})` : 'Connected to mesh network');
      } else {
        updateStep('tailscale-mesh', 'pending', 'Tailscale CLI ready (awaiting Auth Key)');
      }
    } catch {
      updateStep('tailscale-mesh', 'pending', 'Tailscale CLI ready');
    }
  };

  await syncTailscaleStep();
  setTimeout(syncTailscaleStep, 2000);
  setTimeout(syncTailscaleStep, 5000);

  // Subscribe to live network interface changes to auto-update step dynamically
  hostBuilder.onNetworkChange((state) => {
    if (state.tailscaleIp) {
      updateStep('tailscale-mesh', 'success', `Connected (Mesh IP: ${state.tailscaleIp})`);
    } else {
      syncTailscaleStep();
    }
  });

  // 8. Power Persistence (24/7 background operation)
  updateStep('power-persistence', 'running');
  powerManager.enablePowerPersistence();
  updateStep('power-persistence', 'success', 'SetThreadExecutionState persistence active');

  logger.success('daemon', `Ownbase Headless Daemon fully initialized on http://127.0.0.1:${config.ports.daemon}`);

  // Graceful shutdown hooks
  const shutdown = async (signal: string) => {
    logger.info('daemon', `Received ${signal}. Shutting down Ownbase Daemon gracefully...`);
    powerManager.disablePowerPersistence();
    try {
      await supervisor.stopAll();
    } catch {}
    try {
      await postgresManager.stop();
      await prismaManager.disconnect();
    } catch {}
    try {
      await webApiServer.stop();
    } catch {}
    logger.info('daemon', 'Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return {
    webApiServer,
    supervisor,
    caddyManager,
    tailscaleManager,
  };
}

// When executed directly: start daemon
if (require.main === module) {
  bootstrapDaemon().catch((err) => {
    logger.error('daemon', `Fatal daemon startup error: ${err.message}`);
    process.exit(1);
  });
}
