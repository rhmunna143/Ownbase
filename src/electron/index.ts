import { app, BrowserWindow, Tray, Menu, shell, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import {
  isDaemonRunning,
  ensurePortableDaemon,
  getActiveDaemonPort,
  findRunningDaemonPort,
  getDaemonLastError,
  stopPortableDaemon,
} from './portable';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuittingViewer = false;

function getDaemonPort(): number {
  return getActiveDaemonPort();
}

function getDaemonUrl(): string {
  return `http://127.0.0.1:${getActiveDaemonPort()}`;
}

function getAppIcon(): string | undefined {
  const resPath = (process as any).resourcesPath || '';
  const candidatePaths = [
    resPath ? path.join(resPath, 'assets', 'icon.ico') : '',
    resPath ? path.join(resPath, 'assets', 'icon.png') : '',
    path.join(process.cwd(), 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', '..', 'assets', 'icon.ico'),
    path.join(process.cwd(), 'assets', 'icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
  ].filter(Boolean);
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
      user-select: none;
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
      transition: background 0.2s, opacity 0.2s;
      margin: 6px;
    }
    button:hover:not(:disabled) { background: #2563eb; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    button.secondary {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
    }
    button.secondary:hover:not(:disabled) { background: #334155; }
    .status-msg {
      margin-top: 20px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.4;
      display: none;
      text-align: left;
    }
    .status-info { background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); }
    .status-error { background: rgba(239, 68, 68, 0.15); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); }
    .status-success { background: rgba(34, 197, 94, 0.15); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.3); }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Windows Service Stopped</div>
    <h1>Ownbase Server is Offline</h1>
    <p>The headless background daemon is not running. Start the service or launch in portable mode to access your self-hosted cloud.</p>
    <div>
      <button id="btn-start" onclick="startService()">Start Ownbase Service</button>
      <button id="btn-retry" class="secondary" onclick="retryConnection()">Retry Connection</button>
    </div>
    <div id="status-msg" class="status-msg"></div>
  </div>
  <script>
    async function startService() {
      const btnStart = document.getElementById('btn-start');
      const btnRetry = document.getElementById('btn-retry');
      const statusMsg = document.getElementById('status-msg');

      btnStart.disabled = true;
      btnRetry.disabled = true;
      btnStart.innerText = 'Starting Service...';
      statusMsg.style.display = 'block';
      statusMsg.className = 'status-msg status-info';
      statusMsg.innerText = 'Attempting to start background service or portable daemon...';

      if (window.thinClientAPI && window.thinClientAPI.startService) {
        try {
          const res = await window.thinClientAPI.startService();
          if (res && res.success) {
            statusMsg.className = 'status-msg status-success';
            statusMsg.innerText = 'Service started successfully! Connecting to dashboard...';
          } else {
            statusMsg.className = 'status-msg status-error';
            statusMsg.innerText = res && res.error ? 'Start failed: ' + res.error : 'Could not start service. Check permissions or run as administrator.';
            btnStart.disabled = false;
            btnRetry.disabled = false;
            btnStart.innerText = 'Start Ownbase Service';
          }
        } catch (err) {
          statusMsg.className = 'status-msg status-error';
          statusMsg.innerText = 'Error: ' + (err.message || 'Unknown error');
          btnStart.disabled = false;
          btnRetry.disabled = false;
          btnStart.innerText = 'Start Ownbase Service';
        }
      } else {
        window.location.href = 'http://127.0.0.1:${getDaemonPort()}';
      }
    }

    async function retryConnection() {
      const btnStart = document.getElementById('btn-start');
      const btnRetry = document.getElementById('btn-retry');
      const statusMsg = document.getElementById('status-msg');

      btnStart.disabled = true;
      btnRetry.disabled = true;
      btnRetry.innerText = 'Connecting...';
      statusMsg.style.display = 'block';
      statusMsg.className = 'status-msg status-info';
      statusMsg.innerText = 'Testing connection to http://127.0.0.1:${getDaemonPort()}...';

      if (window.thinClientAPI && window.thinClientAPI.retryConnection) {
        try {
          const res = await window.thinClientAPI.retryConnection();
          if (res && res.success) {
            statusMsg.className = 'status-msg status-success';
            statusMsg.innerText = 'Connection established! Loading dashboard...';
          } else {
            statusMsg.className = 'status-msg status-error';
            statusMsg.innerText = res && res.error ? res.error : 'Server is still offline on 127.0.0.1:${getDaemonPort()}. Click "Start Ownbase Service" to start it.';
            btnStart.disabled = false;
            btnRetry.disabled = false;
            btnRetry.innerText = 'Retry Connection';
          }
        } catch (err) {
          statusMsg.className = 'status-msg status-error';
          statusMsg.innerText = 'Error: ' + (err.message || 'Unknown error');
          btnStart.disabled = false;
          btnRetry.disabled = false;
          btnRetry.innerText = 'Retry Connection';
        }
      } else {
        window.location.href = 'http://127.0.0.1:${getDaemonPort()}';
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

  mainWindow.on('close', (event) => {
    if (!isQuittingViewer) {
      const isPortable =
        process.argv.includes('--portable') ||
        !!process.env.PORTABLE_EXECUTABLE_DIR;
      if (isPortable) {
        // Portable mode: closing the window terminates the portable session cleanly
        isQuittingViewer = true;
        stopPortableDaemon();
        app.quit();
      } else {
        // Installed mode: hide window to system tray, background service continues
        event.preventDefault();
        mainWindow?.hide();
      }
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
    await ensurePortableDaemon();
  }

  let runningPort = await findRunningDaemonPort();
  if (!runningPort) {
    // Give background daemon up to 6 seconds to complete socket initialization
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      runningPort = await findRunningDaemonPort();
      if (runningPort) break;
    }
  }

  if (runningPort) {
    try {
      await mainWindow.loadURL(getDaemonUrl());
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
          shell.openExternal(getDaemonUrl());
        },
      },
      {
        label: `About Ownbase (v${app.getVersion()})`,
        click: () => {
          dialog.showMessageBox({
            type: 'info',
            title: 'About Ownbase',
            message: `Ownbase Server Platform v${app.getVersion()}`,
            detail: `Native Windows Server Hub - Standalone server orchestration without Docker or WSL2.\n\nDeveloper: rhmunna143 (rhmunna19@gmail.com)\nArchitecture: Windows x64\nLicense: MIT\nDocs: https://rhmunna143.github.io/ownbase/`,
            buttons: ['OK', 'View Documentation', 'GitHub'],
            defaultId: 0,
            cancelId: 0,
          }).then((res) => {
            if (res.response === 1) {
              shell.openExternal('https://rhmunna143.github.io/ownbase/');
            } else if (res.response === 2) {
              shell.openExternal('https://github.com/rhmunna143/ownbase');
            }
          });
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
      {
        label: 'Stop Server & Exit All',
        sublabel: '(Terminates daemon and viewer)',
        click: () => {
          isQuittingViewer = true;
          stopPortableDaemon();
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
  if (mainWindow) {
    mainWindow.close();
  }
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
            ensurePortableDaemon()
              .then(async (started) => {
                if (started && mainWindow) {
                  await mainWindow.loadURL(getDaemonUrl()).catch(() => {});
                }
                const errorMsg = started ? undefined : (getDaemonLastError() || 'Failed to start daemon fallback');
                resolve({ success: started, error: errorMsg });
              })
              .catch((e) => resolve({ success: false, error: e.message }));
          } else {
            findRunningDaemonPort().then(async (port) => {
              if (port && mainWindow) {
                await mainWindow.loadURL(getDaemonUrl()).catch(() => {});
              }
              resolve({ success: !!port, error: port ? undefined : 'Service started but daemon port not ready' });
            });
          }
        });
      } else {
        // Service not installed on this system (e.g. dev machine or portable): launch standalone daemon
        ensurePortableDaemon()
          .then(async (started) => {
            if (started && mainWindow) {
              await mainWindow.loadURL(getDaemonUrl()).catch(() => {});
            }
            const errorMsg = started ? undefined : (getDaemonLastError() || 'Failed to launch standalone daemon process');
            resolve({ success: started, error: errorMsg });
          })
          .catch((e) => resolve({ success: false, error: e.message }));
      }
    });
  });
});

ipcMain.handle('connection:retry', async () => {
  const runningPort = await findRunningDaemonPort();
  if (runningPort) {
    if (mainWindow) {
      try {
        await mainWindow.loadURL(getDaemonUrl());
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return { success: true };
  } else {
    // If portable or dev, attempt auto-starting daemon on retry
    const isPortable = process.argv.includes('--portable') || !!process.env.PORTABLE_EXECUTABLE_DIR;
    const isDev = process.argv.includes('--dev') || !app.isPackaged;
    if (isPortable || isDev) {
      const started = await ensurePortableDaemon();
      if (started && mainWindow) {
        await mainWindow.loadURL(getDaemonUrl()).catch(() => {});
        return { success: true };
      }
    }
    const lastErr = getDaemonLastError();
    return { success: false, error: lastErr || `Server daemon is offline on 127.0.0.1:${getDaemonPort()}` };
  }
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
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
}

app.on('window-all-closed', () => {
  const isPortable = process.argv.includes('--portable') || !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (isPortable || isQuittingViewer || process.platform !== 'win32') {
    stopPortableDaemon();
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuittingViewer = true;
  stopPortableDaemon();
});
