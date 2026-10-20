import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

let portableDaemonChild: ChildProcess | null = null;

export async function isDaemonRunning(port = 3001): Promise<boolean> {
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
 * Same daemon started as a hidden child of the portable exe.
 * Clearly documented as 'no pre-login start'.
 */
export async function ensurePortableDaemon(daemonPort = 3001): Promise<boolean> {
  const running = await isDaemonRunning(daemonPort);
  if (running) return true;

  const candidateScripts = [
    path.join(process.cwd(), 'dist', 'daemon', 'main.js'),
    path.join(__dirname, '..', 'daemon', 'main.js'),
    path.join(__dirname, '..', '..', 'dist', 'daemon', 'main.js'),
  ];

  let scriptPath: string | null = null;
  for (const cand of candidateScripts) {
    if (fs.existsSync(cand)) {
      scriptPath = cand;
      break;
    }
  }

  const isPortable = process.argv.includes('--portable') || !!process.env.PORTABLE_EXECUTABLE_DIR;
  const mode = isPortable ? 'portable' : 'dev';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    OWNBASE_MODE: mode,
  };

  const nodeExe = process.execPath;

  if (scriptPath) {
    portableDaemonChild = spawn(nodeExe, [scriptPath, `--${mode}`], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
      env,
    });
    portableDaemonChild.unref();
  } else {
    // If running in development without built dist/ yet: spawn tsx src/daemon/main.ts
    const tsMain = path.join(process.cwd(), 'src', 'daemon', 'main.ts');
    if (fs.existsSync(tsMain)) {
      const tsxBin = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
      if (fs.existsSync(tsxBin)) {
        portableDaemonChild = spawn(nodeExe, [tsxBin, tsMain], {
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
          env,
        });
        portableDaemonChild.unref();
      }
    }
  }

  // Wait up to 15 seconds for daemon to start listening
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isDaemonRunning(daemonPort)) {
      return true;
    }
  }

  return false;
}
