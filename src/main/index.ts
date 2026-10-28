import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { ProcessSupervisor } from './supervisor';
import { CaddyManager } from './caddy';
import { TailscaleManager } from './tailscale';
import { LifecycleManager } from './lifecycle';
import { WebApiServer } from './httpServer';
import { registerIpcHandlers } from './ipc';
import { logger } from './logger';
import { BootstrapStep } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let postgresManager: PostgresManager;
let prismaManager: PrismaManager;
let supervisor: ProcessSupervisor;
let caddyManager: CaddyManager;
let tailscaleManager: TailscaleManager;
let lifecycleManager: LifecycleManager;
let webApiServer: WebApiServer;

const bootstrapSteps: BootstrapStep[] = [
  { id: 'electron-init', name: 'Electron Shell', description: 'Initializing desktop runtime environment', status: 'pending' },
  { id: 'postgres-bin', name: 'PostgreSQL Binaries', description: 'Locating portable PostgreSQL distribution', status: 'pending' },
  { id: 'postgres-initdb', name: 'Database Cluster', description: 'Validating/Initializing data directory (initdb)', status: 'pending' },
  { id: 'postgres-start', name: 'PostgreSQL Engine', description: 'Launching silent postgres.exe process', status: 'pending' },
  { id: 'postgres-port', name: 'TCP Port Probe', description: 'Verifying database port 5432 is listening', status: 'pending' },
  { id: 'prisma-migration', name: 'Prisma Migrations', description: 'Executing programmatic database migrations', status: 'pending' },
  { id: 'prisma-client', name: 'Data Layer', description: 'Initializing Prisma client and verifying models', status: 'pending' },
  { id: 'supervisor-init', name: 'Process Supervisor', description: 'Supervising native processes (caddy, filebrowser, ollama)', status: 'pending' },
  { id: 'caddy-proxy', name: 'Dynamic Reverse Proxy', description: 'Caddy Admin REST API & dynamic routing', status: 'pending' },
  { id: 'tailscale-mesh', name: 'Tailscale Mesh VPN', description: 'WireGuard encrypted mesh overlay', status: 'pending' },
  { id: 'lifecycle-init', name: '24/7 Server Persistence', description: 'System tray & Windows power suspension blocker', status: 'pending' },
  { id: 'ui-ready', name: 'User Interface', description: 'Mounting dashboard and establishing IPC channels', status: 'pending' },
];

function updateStep(id: string, status: BootstrapStep['status'], detail?: string) {
  const step = bootstrapSteps.find((s) => s.id === id);
  if (step) {
    step.status = status;
    step.detail = detail;
    step.timestamp = new Date().toISOString();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bootstrap-update', [...bootstrapSteps]);
  }
}

function getAppIcon(): string | undefined {
  const candidatePaths = [
    path.join(process.cwd(), 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', '..', 'assets', 'icon.ico'),
    path.join((process as any).resourcesPath || '', 'assets', 'icon.ico'),
    path.join(process.cwd(), 'assets', 'icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
    path.join((process as any).resourcesPath || '', 'assets', 'icon.png'),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function createWindow() {
  const iconPath = getAppIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1000,
    minHeight: 700,
    title: 'Ownbase',
    backgroundColor: '#090d16',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  if (iconPath && mainWindow) {
    try {
      mainWindow.setIcon(iconPath);
    } catch {}
  }

  logger.setWindow(mainWindow);
  if (supervisor) {
    supervisor.setWindow(mainWindow);
  }

  // Hook status updates to window
  postgresManager.setStatusCallback((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('postgres-status-changed', status);
    }
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
    logger.setWindow(null);
    if (supervisor) {
      supervisor.setWindow(null);
    }
  });

  return mainWindow;
}

async function startBootstrap() {
  updateStep('electron-init', 'running');
  logger.info('electron', 'Ownbase starting up...');
  updateStep('electron-init', 'success', 'Electron shell active');

  // Step 2 & 3 & 4 & 5: Postgres
  updateStep('postgres-bin', 'running');
  updateStep('postgres-initdb', 'running');
  updateStep('postgres-start', 'running');
  updateStep('postgres-port', 'running');

  try {
    await postgresManager.bootstrap();
    updateStep('postgres-bin', 'success', 'Binaries verified in extraResources/pgsql');
    updateStep('postgres-initdb', 'success', 'PostgreSQL cluster ready');
    updateStep('postgres-start', 'success', `Engine running on PID ${postgresManager.getStatus().pid || 'active'}`);
    updateStep('postgres-port', 'success', 'Port 5432 actively listening and accepting TCP');
  } catch (err: any) {
    updateStep('postgres-bin', 'error', err.message);
    updateStep('postgres-initdb', 'error', err.message);
    updateStep('postgres-start', 'error', err.message);
    updateStep('postgres-port', 'error', err.message);
    logger.error('postgres', `Database initialization error: ${err.message}`);
    await loadFrontend();
    return;
  }

  // Step 6: Programmatic Prisma Migrations
  updateStep('prisma-migration', 'running', 'Running prisma migrate deploy via Node.js');
  try {
    await prismaManager.runMigrations();
    updateStep('prisma-migration', 'success', 'All Prisma migrations applied successfully');
  } catch (err: any) {
    updateStep('prisma-migration', 'error', err.message);
    logger.error('prisma', `Migration error: ${err.message}`);
  }

  // Step 7: Prisma Client & Verification
  updateStep('prisma-client', 'running', 'Connecting Prisma client');
  try {
    const pingRes = await prismaManager.ping();
    if (pingRes.success) {
      updateStep('prisma-client', 'success', `Connected (${pingRes.latencyMs}ms latency)`);
    } else {
      updateStep('prisma-client', 'error', pingRes.error);
    }
  } catch (err: any) {
    updateStep('prisma-client', 'error', err.message);
  }

  // Step 8: Phase 2 Process Supervisor Bootstrapping
  updateStep('supervisor-init', 'running', 'Initializing ProcessSupervisor & registry');
  try {
    await supervisor.syncAndAutoStart();
    updateStep('supervisor-init', 'success', 'Supervisor active with process tree isolation');
  } catch (err: any) {
    updateStep('supervisor-init', 'error', err.message);
    logger.error('supervisor', `Supervisor sync error: ${err.message}`);
  }

  // Step 9: Phase 3 Caddy Dynamic Reverse Proxy
  updateStep('caddy-proxy', 'running', 'Verifying Caddy Admin REST API & syncing routes');
  try {
    // Wait briefly for Caddy to start listening if auto-started
    setTimeout(async () => {
      try {
        const caddyStatus = await caddyManager.getStatus();
        if (caddyStatus.isListening) {
          const syncRes = await caddyManager.syncAllRoutes();
          updateStep('caddy-proxy', 'success', `Caddy REST API active (${syncRes.count} routes mapped)`);
        } else {
          updateStep('caddy-proxy', 'pending', 'Caddy process idle (start service to activate proxy)');
        }
      } catch {
        updateStep('caddy-proxy', 'pending', 'Caddy process idle (start service to activate proxy)');
      }
    }, 2000);
  } catch (err: any) {
    updateStep('caddy-proxy', 'error', err.message);
  }

  // Step 10: Phase 3 Tailscale Mesh Tunneling
  updateStep('tailscale-mesh', 'running', 'Checking Tailscale mesh state');
  const syncTailscaleMesh = async () => {
    try {
      const tsStatus = await tailscaleManager.getStatus();
      if (tsStatus.connected) {
        updateStep('tailscale-mesh', 'success', tsStatus.ip ? `Connected (Mesh IP: ${tsStatus.ip})` : 'Connected to mesh network');
      } else {
        updateStep('tailscale-mesh', 'pending', 'Tailscale CLI ready (configure Auth Key to connect)');
      }
    } catch {
      updateStep('tailscale-mesh', 'pending', 'Tailscale CLI ready');
    }
  };
  await syncTailscaleMesh();
  setTimeout(syncTailscaleMesh, 2000);
  setTimeout(syncTailscaleMesh, 5000);

  // Step 11: Phase 4 24/7 Server Persistence & Power Suspension Blocker
  updateStep('lifecycle-init', 'running', 'Engaging power suspension blocker & system tray');
  try {
    await lifecycleManager.bootstrap();
    updateStep('lifecycle-init', 'success', 'Tray active & prevent-app-suspension engaged');
  } catch (err: any) {
    updateStep('lifecycle-init', 'error', err.message);
  }

  // Step 12: Mount UI
  updateStep('ui-ready', 'running', 'Mounting user interface');
  await loadFrontend();
  updateStep('ui-ready', 'success', 'IPC channels active and dashboard mounted');
}

async function loadFrontend() {
  if (!mainWindow) return;

  const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
  const isHidden = process.argv.includes('--hidden');
  const devUrl = 'http://localhost:3000';

  if (isDev) {
    logger.info('electron', `Loading development server at ${devUrl}...`);
    try {
      await mainWindow.loadURL(devUrl);
    } catch (e) {
      logger.warn('electron', `Dev server connection failed, loading static export fallback...`);
      await loadStaticBundle();
    }
  } else {
    await loadStaticBundle();
  }

  if (!isHidden) {
    mainWindow.show();
  } else {
    logger.info('electron', 'Started with --hidden flag. Running silently in Windows system tray.');
  }
}

async function loadStaticBundle() {
  if (!mainWindow) return;
  const port = typeof webApiServer !== 'undefined' && webApiServer ? webApiServer.getPort() : 3001;
  const url = `http://127.0.0.1:${port}`;
  logger.info('electron', `Loading dashboard from local server gateway: ${url}`);
  try {
    await mainWindow.loadURL(url);
  } catch (err: any) {
    logger.warn('electron', `Gateway connecting: ${err.message}. Retrying in 1.5s...`);
    setTimeout(async () => {
      if (mainWindow) {
        try {
          await mainWindow.loadURL(url);
        } catch {}
      }
    }, 1500);
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.rhmunna143.nativewindowsserverhub');
    }
  postgresManager = new PostgresManager(5432);
  prismaManager = new PrismaManager(5432, 'postgres');
  supervisor = new ProcessSupervisor(prismaManager);
  caddyManager = new CaddyManager(prismaManager);
  tailscaleManager = new TailscaleManager(prismaManager);
  lifecycleManager = new LifecycleManager(prismaManager);

  registerIpcHandlers(
    postgresManager,
    prismaManager,
    supervisor,
    caddyManager,
    tailscaleManager,
    lifecycleManager,
    () => bootstrapSteps
  );

  webApiServer = new WebApiServer(
    postgresManager,
    prismaManager,
    supervisor,
    caddyManager,
    tailscaleManager,
    lifecycleManager,
    () => bootstrapSteps
  );
  await webApiServer.start();

  await createWindow();
  if (mainWindow) {
    lifecycleManager.setWindow(mainWindow);
  }

  await startBootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().then((win) => {
        if (win) lifecycleManager.setWindow(win);
      });
    } else if (mainWindow) {
      lifecycleManager.restoreWindow();
    }
  });
});
}

// Phase 2 & 4: Graceful Termination with taskkill /pid <PID> /T /F before quit
app.on('before-quit', async (event) => {
  logger.info('electron', 'Application quitting. Terminating all supervised processes...');
  if (webApiServer) {
    try {
      await webApiServer.stop();
    } catch {}
  }

  if (lifecycleManager) {
    lifecycleManager.setIsQuitting(true);
    lifecycleManager.destroy();
  }

  if (supervisor) {
    try {
      await supervisor.stopAll();
    } catch (e: any) {
      logger.warn('supervisor', `Error during supervisor stopAll: ${e.message}`);
    }
  }

  if (postgresManager) {
    logger.info('electron', 'Stopping PostgreSQL supervisor...');
    try {
      await postgresManager.stop();
      await prismaManager.disconnect();
    } catch (e) {
      // ignore
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && lifecycleManager && lifecycleManager.getIsQuitting()) {
    app.quit();
  }
});

process.on('SIGINT', async () => {
  if (lifecycleManager) lifecycleManager.destroy();
  if (supervisor) await supervisor.stopAll();
  if (postgresManager) await postgresManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (lifecycleManager) lifecycleManager.destroy();
  if (supervisor) await supervisor.stopAll();
  if (postgresManager) await postgresManager.stop();
  process.exit(0);
});
