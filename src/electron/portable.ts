import { spawn, exec, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { app } from 'electron';

let portableDaemonChild: ChildProcess | null = null;
let activeDaemonPort = 3001;
let lastDaemonError: string | null = null;
let inProcessDaemonStarted = false;

export function stopPortableDaemon(): void {
  if (inProcessDaemonStarted) {
    try {
      const { postgresManager } = require('../daemon/db/postgres');
      postgresManager.stop().catch(() => {});
    } catch {}
    try {
      const { powerManager } = require('../daemon/core/power');
      powerManager.disablePowerPersistence();
    } catch {}
    inProcessDaemonStarted = false;
  }

  if (portableDaemonChild) {
    try {
      if (process.platform === 'win32' && portableDaemonChild.pid) {
        exec(`taskkill /PID ${portableDaemonChild.pid} /T /F`, () => {});
      } else {
        portableDaemonChild.kill();
      }
    } catch {}
    portableDaemonChild = null;
  }
}

export function getActiveDaemonPort(): number {
  return activeDaemonPort;
}

export function setActiveDaemonPort(port: number) {
  activeDaemonPort = port;
}

export function getDaemonLastError(): string | null {
  return lastDaemonError;
}

export function readStoredDaemonPort(): number | null {
  const candidatePaths = [
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data', 'daemon.port') : null,
    path.join(process.cwd(), 'data', 'daemon.port'),
    path.join(process.cwd(), '.data', 'daemon.port'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Ownbase', 'daemon.port'),
  ].filter(Boolean) as string[];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const val = parseInt(fs.readFileSync(p, 'utf-8').trim(), 10);
        if (val > 0 && val <= 65535) return val;
      }
    } catch {}
  }
  return null;
}

export async function findRunningDaemonPort(): Promise<number | null> {
  const stored = readStoredDaemonPort();
  const candidatePorts = Array.from(
    new Set(
      [stored, activeDaemonPort, 3001, 3400, 3500, 3600, 3700, 3800].filter(
        (p): p is number => typeof p === 'number' && p > 0
      )
    )
  );

  for (const port of candidatePorts) {
    if (await isDaemonRunning(port)) {
      activeDaemonPort = port;
      return port;
    }
  }
  return null;
}

export async function isDaemonRunning(port = activeDaemonPort): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/v1/health',
        method: 'GET',
        timeout: 1000,
      },
      (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 503);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Portable Mode (Item 2.12):
 * Same daemon started directly in-process or as a managed fallback.
 * Clearly documented as 'no pre-login start'.
 */
export async function ensurePortableDaemon(daemonPort = activeDaemonPort): Promise<boolean> {
  const runningPort = await findRunningDaemonPort();
  if (runningPort) {
    activeDaemonPort = runningPort;
    lastDaemonError = null;
    return true;
  }

  if (inProcessDaemonStarted) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const port = await findRunningDaemonPort();
      if (port) {
        activeDaemonPort = port;
        lastDaemonError = null;
        return true;
      }
    }
    return false;
  }

  inProcessDaemonStarted = true;
  lastDaemonError = null;

  // 1. Primary Strategy: In-process daemon bootstrapping
  // Electron's main process runs inside Node.js with built-in ASAR and native module support.
  // Running in-process guarantees zero detached process bugs, zero %TEMP% path issues,
  // and clean synchronous lifecycle integration.
  try {
    const isPortable =
      process.argv.includes('--portable') ||
      !!process.env.PORTABLE_EXECUTABLE_DIR;
    if (isPortable) {
      process.env.OWNBASE_MODE = 'portable';
    }

    const { bootstrapDaemon } = require('../daemon/main');
    await bootstrapDaemon();

    for (let i = 0; i < 40; i++) {
      const port = await findRunningDaemonPort();
      if (port) {
        activeDaemonPort = port;
        lastDaemonError = null;
        return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (directErr: any) {
    console.warn('[portable] Direct require("../daemon/main") notice:', directErr.message);
  }

  // 2. Secondary Fallback: Child process spawn if in-process failed
  const resPath =
    (process as any).resourcesPath ||
    path.join(path.dirname(process.execPath), 'resources') ||
    '';

  const candidateScripts = [
    resPath ? path.join(resPath, 'dist', 'daemon', 'main.js') : '',
    resPath ? path.join(resPath, 'app.asar.unpacked', 'dist', 'daemon', 'main.js') : '',
    resPath ? path.join(resPath, 'app.asar', 'dist', 'daemon', 'main.js') : '',
    path.join(path.dirname(process.execPath), 'resources', 'dist', 'daemon', 'main.js'),
    path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'dist', 'daemon', 'main.js'),
    path.join(__dirname, '..', '..', '..', 'dist', 'daemon', 'main.js'),
    path.join(__dirname, '..', 'daemon', 'main.js'),
    path.join(process.cwd(), 'dist', 'daemon', 'main.js'),
  ].filter(Boolean);

  let scriptPath: string | null = null;
  for (const cand of candidateScripts) {
    if (cand && fs.existsSync(cand)) {
      scriptPath = cand;
      break;
    }
  }

  const isPortable =
    process.argv.includes('--portable') ||
    !!process.env.PORTABLE_EXECUTABLE_DIR ||
    (typeof app !== 'undefined' && app.isPackaged);
  const mode = isPortable ? 'portable' : 'dev';

  const asarNodeModules = path.join(resPath, 'app.asar', 'node_modules');
  const unpackedNodeModules = path.join(resPath, 'app.asar.unpacked', 'node_modules');
  const resNodeModules = path.join(resPath, 'node_modules');
  const extraResNodeModules = path.join(resPath, 'extraResources', 'node_modules');
  const execDirNodeModules = path.join(path.dirname(process.execPath), 'node_modules');
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const nodePathEntries = [
    unpackedNodeModules,
    asarNodeModules,
    resNodeModules,
    extraResNodeModules,
    execDirNodeModules,
    path.join(process.cwd(), 'node_modules'),
    process.env.NODE_PATH || '',
  ].filter(Boolean);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    OWNBASE_MODE: mode,
    RESOURCES_PATH: resPath,
    NODE_PATH: nodePathEntries.join(delimiter),
  };

  const nodeExe = process.execPath;

  const dataDir = process.env.PORTABLE_EXECUTABLE_DIR
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
    : path.resolve(process.cwd(), mode === 'dev' ? '.data' : 'data');
  const logsDir = path.join(dataDir, 'logs');
  let stdioConfig: any = 'ignore';
  const logFilePath = path.join(logsDir, 'daemon-portable.log');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const logFd = fs.openSync(logFilePath, 'a');
    stdioConfig = ['ignore', logFd, logFd];
  } catch {}

  let daemonExited = false;
  lastDaemonError = null;

  if (scriptPath) {
    portableDaemonChild = spawn(nodeExe, [scriptPath, `--${mode}`], {
      windowsHide: true,
      detached: true,
      stdio: stdioConfig,
      env,
    });
  } else {
    const tsMain = path.join(process.cwd(), 'src', 'daemon', 'main.ts');
    if (fs.existsSync(tsMain)) {
      const tsxBin = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
      if (fs.existsSync(tsxBin)) {
        portableDaemonChild = spawn(nodeExe, [tsxBin, tsMain], {
          windowsHide: true,
          detached: true,
          stdio: stdioConfig,
          env,
        });
      }
    }
  }

  if (portableDaemonChild) {
    portableDaemonChild.on('error', (err) => {
      daemonExited = true;
      lastDaemonError = `Failed to spawn daemon process: ${err.message}`;
    });

    portableDaemonChild.on('exit', (code, signal) => {
      daemonExited = true;
      try {
        if (fs.existsSync(logFilePath)) {
          const logContent = fs.readFileSync(logFilePath, 'utf-8');
          const lines = logContent.trim().split(/\r?\n/).filter(Boolean);
          const errorLines = lines.slice(-4).join('; ');
          if (errorLines) {
            lastDaemonError = `Daemon exited with code ${code}: ${errorLines}`;
            return;
          }
        }
      } catch {}
      lastDaemonError = `Daemon process exited prematurely (exit code ${code}${signal ? `, signal ${signal}` : ''})`;
    });

    portableDaemonChild.unref();
  } else if (!inProcessDaemonStarted) {
    lastDaemonError = 'Could not locate daemon entry point';
    return false;
  }

  for (let i = 0; i < 90; i++) {
    if (daemonExited) {
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
    const runningPort = await findRunningDaemonPort();
    if (runningPort) {
      activeDaemonPort = runningPort;
      lastDaemonError = null;
      return true;
    }
  }

  if (!lastDaemonError) {
    lastDaemonError = `Daemon process did not respond on loopback port within 45 seconds`;
  }
  return false;
}

