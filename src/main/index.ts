import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { PostgresManager } from './postgres';
import { PrismaManager } from './prisma';
import { ProcessSupervisor } from './supervisor';
import { registerIpcHandlers } from './ipc';
import { logger } from './logger';
import { BootstrapStep } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let postgresManager: PostgresManager;
let prismaManager: PrismaManager;
let supervisor: ProcessSupervisor;

const bootstrapSteps: BootstrapStep[] = [
  { id: 'electron-init', name: 'Electron Shell', description: 'Initializing desktop runtime environment', status: 'pending' },
  { id: 'postgres-bin', name: 'PostgreSQL Binaries', description: 'Locating portable PostgreSQL distribution', status: 'pending' },
  { id: 'postgres-initdb', name: 'Database Cluster', description: 'Validating/Initializing data directory (initdb)', status: 'pending' },
  { id: 'postgres-start', name: 'PostgreSQL Engine', description: 'Launching silent postgres.exe process', status: 'pending' },
  { id: 'postgres-port', name: 'TCP Port Probe', description: 'Verifying database port 5432 is listening', status: 'pending' },
  { id: 'prisma-migration', name: 'Prisma Migrations', description: 'Executing programmatic database migrations', status: 'pending' },
  { id: 'prisma-client', name: 'Data Layer', description: 'Initializing Prisma client and verifying models', status: 'pending' },
  { id: 'supervisor-init', name: 'Process Supervisor', description: 'Supervising native processes (caddy, filebrowser, ollama)', status: 'pending' },
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1000,
    minHeight: 700,
    title: 'Native Windows Server Hub',
    backgroundColor: '#090d16',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

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
  logger.info('electron', 'Native Windows Server Hub starting up...');
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

  // Step 9: Mount UI
  updateStep('ui-ready', 'running', 'Mounting user interface');
  await loadFrontend();
  updateStep('ui-ready', 'success', 'IPC channels active and dashboard mounted');
}

async function loadFrontend() {
  if (!mainWindow) return;

  const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
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

  mainWindow.show();
}

async function loadStaticBundle() {
  if (!mainWindow) return;
  const candidateHtmlPaths = [
    path.join(process.cwd(), 'out', 'index.html'),
    path.join(__dirname, '..', '..', '..', 'out', 'index.html'),
    path.join(__dirname, '..', '..', 'out', 'index.html'),
    path.join(app.getAppPath(), 'out', 'index.html'),
  ];

  for (const htmlPath of candidateHtmlPaths) {
    if (fs.existsSync(htmlPath)) {
      logger.info('electron', `Loading static frontend from: ${htmlPath}`);
      await mainWindow.loadFile(htmlPath);
      return;
    }
  }

  logger.error('electron', 'Static export out/index.html not found! Please run npm run build:next');
}

app.whenReady().then(async () => {
  postgresManager = new PostgresManager(5432);
  prismaManager = new PrismaManager(5432, 'postgres');
  supervisor = new ProcessSupervisor(prismaManager);

  registerIpcHandlers(postgresManager, prismaManager, supervisor, () => bootstrapSteps);

  await createWindow();
  await startBootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Phase 2: Graceful Termination with taskkill /pid <PID> /T /F before quit
app.on('before-quit', async (event) => {
  logger.info('electron', 'Application quitting. Terminating all supervised processes...');
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Process signal safety cleanup
process.on('SIGINT', async () => {
  if (supervisor) await supervisor.stopAll();
  if (postgresManager) await postgresManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (supervisor) await supervisor.stopAll();
  if (postgresManager) await postgresManager.stop();
  process.exit(0);
});
