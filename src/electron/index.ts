import { app, BrowserWindow, Tray, Menu, shell, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { isDaemonRunning, ensurePortableDaemon } from './portable';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuittingViewer = false;

const DAEMON_PORT = 3001;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;

function getAppIcon(): string | undefined {
  const candidatePaths = [
    path.join(process.cwd(), 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', '..', 'assets', 'icon.ico'),
    path.join(process.cwd(), 'assets', 'icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createFallbackHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ownbase - Service Offline</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 36px 44px;
      max-width: 440px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    }
    h1 { font-size: 20px; margin-bottom: 12px; color: #f8fafc; font-weight: 600; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
      margin-bottom: 16px;
    }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
      margin: 6px;
    }
    button:hover { background: #2563eb; }
    button.secondary {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
    }
    button.secondary:hover { background: #334155; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Windows Service Stopped</div>
    <h1>Ownbase Server is Offline</h1>
    <p>The headless background daemon is not running. Start the service or launch in portable mode to access your self-hosted cloud.</p>
    <div>
      <button onclick="startService()">Start Ownbase Service</button>
      <button class="secondary" onclick="window.location.reload()">Retry Connection</button>
    </div>
  </div>
  <script>
    function startService() {
      if (window.thinClientAPI && window.thinClientAPI.startService) {
        window.thinClientAPI.startService().then(res => {
          setTimeout(() => window.location.reload(), 2000);
        });
      }
    }
  </script>
</body>
</html>`;
}

async function createWindow() {
  const iconPath = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1000,
    minHeight: 700,
    title: 'Ownbase Server',
    backgroundColor: '#090d16',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

  // Intercept window close (Item 2.10 / Defect P1):
  // Closing window hides or closes the client, leaving daemon 100% active in background!
  mainWindow.on('close', (event) => {
    if (!isQuittingViewer) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  await loadDashboard();

  mainWindow.show();
  return mainWindow;
}

async function loadDashboard() {
  if (!mainWindow) return;

  const isPortable = process.argv.includes('--portable') || !!process.env.PORTABLE_EXECUTABLE_DIR;
  const isDev = process.argv.includes('--dev') || !app.isPackaged;

  if (isPortable || isDev) {
    await ensurePortableDaemon(DAEMON_PORT);
  }

  const running = await isDaemonRunning(DAEMON_PORT);
  if (running) {
    try {
      await mainWindow.loadURL(DAEMON_URL);
    } catch {
      await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createFallbackHtml())}`);
    }
  } else {
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createFallbackHtml())}`);
  }
}

function createTray() {
  const iconPath = getAppIcon();
  if (!iconPath) return;

  try {
    tray = new Tray(iconPath);
    tray.setToolTip('Ownbase Server (Thin Desktop Client)');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Dashboard',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      {
        label: 'Open in Browser',
        click: () => {
          shell.openExternal(DAEMON_URL);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Desktop Viewer',
        sublabel: '(Server continues running)',
        click: () => {
          isQuittingViewer = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err: any) {
    console.error('Failed to create tray icon:', err.message);
  }
}

// Window control IPC handlers
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.hide();
});

ipcMain.on('shell:open-external', (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

ipcMain.handle('service:start', async () => {
  return new Promise((resolve) => {
    // Check if the Windows Service "ownbase" actually exists
    exec('powershell.exe -Command "Get-Service -Name ownbase -ErrorAction SilentlyContinue"', (err, stdout) => {
      const serviceExists = !err && stdout && stdout.toLowerCase().includes('ownbase');
      if (serviceExists) {
        // Service exists: start via UAC
        exec('powershell.exe -Command "Start-Process cmd -ArgumentList \'/c net start ownbase\' -Verb runAs -Wait"', (startErr) => {
          if (startErr) {
            ensurePortableDaemon(DAEMON_PORT)
              .then((started) => resolve({ success: started }))
              .catch((e) => resolve({ success: false, error: e.message }));
          } else {
            resolve({ success: true });
          }
        });
      } else {
        // Service not installed on this system (e.g. dev machine or portable): launch standalone daemon
        ensurePortableDaemon(DAEMON_PORT)
          .then((started) => resolve({ success: started }))
          .catch((e) => resolve({ success: false, error: e.message }));
      }
    });
  });
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.rhmunna143.ownbase');
  }

  createTray();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // Do not quit when windows close unless explicit quit
  if (process.platform !== 'win32' && isQuittingViewer) {
    app.quit();
  }
});

// Notice: Closing Electron thin client does NOT terminate background daemon or database (P1 closed)
app.on('before-quit', () => {
  isQuittingViewer = true;
});
