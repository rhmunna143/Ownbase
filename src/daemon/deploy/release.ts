import fs from 'fs';
import path from 'path';
import http from 'http';
import { paths } from '../core/paths';
import { logger } from '../core/logger';
import { prismaManager } from '../db/prisma';
import { portAllocator } from './ports';
import { spawnInJob, ManagedJob } from '../supervisor/jobhost';
import { buildIsolatedEnvironment } from '../supervisor/env';
import { caddyManager } from '../network/caddy';
import { eventBus } from '../core/events';

export const KEEP_RELEASES_COUNT = 3;

export interface ReleaseInfo {
  id: string;
  appId: string;
  releaseNumber: number;
  commitHash?: string | null;
  port: number;
  status: string;
  releasePath: string;
  buildLogs?: string | null;
  createdAt: string;
}

export class ReleaseManager {
  private activeJobs = new Map<string, ManagedJob>(); // releaseId -> ManagedJob

  /**
   * Resolve directory path for a versioned release
   */
  public getReleaseDir(appId: string, releaseNumber: number): string {
    return path.join(paths.appsDir, appId, 'releases', `${releaseNumber}`);
  }

  /**
   * Create directory structure and copy built files into atomic release folder (Item 4.6)
   */
  public async prepareReleaseDirectory(appId: string, releaseNumber: number, sourceBuildDir: string): Promise<string> {
    const releaseDir = this.getReleaseDir(appId, releaseNumber);
    if (fs.existsSync(releaseDir)) {
      try {
        fs.rmSync(releaseDir, { recursive: true, force: true });
      } catch {}
    }
    fs.mkdirSync(releaseDir, { recursive: true });

    this.copyDirectoryRecursive(sourceBuildDir, releaseDir);
    logger.info('release-manager', `Prepared release folder at ${releaseDir}`);
    return releaseDir;
  }

  /**
   * Start release process within an isolated Win32 Job Object (Item 4.4 & 4.6)
   */
  public async startReleaseProcess(params: {
    releaseId: string;
    releasePath: string;
    startCommand: string;
    port: number;
    env?: Record<string, string>;
    maxMemoryMb?: number;
    onLog?: (line: string, isError: boolean) => void;
  }): Promise<ManagedJob> {
    const { releaseId, releasePath, startCommand, port, env = {}, maxMemoryMb = 512, onLog } = params;

    // Stop existing process for this release if any
    await this.stopReleaseProcess(releaseId);

    const mergedEnv = await buildIsolatedEnvironment({
      serviceEnv: {
        ...env,
        PORT: port.toString(),
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
      },
    });

    const executable = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', startCommand] : ['-c', startCommand];

    logger.info('release-manager', `Starting release ${releaseId} on port ${port} (cwd: ${releasePath})`);

    const managedJob = await spawnInJob({
      executable,
      args,
      cwd: releasePath,
      env: mergedEnv,
      limits: {
        maxMemoryMb,
      },
      killOnClose: true,
    });

    const child = managedJob.child;

    child.stdout?.on('data', (d: Buffer) => {
      const text = d.toString('utf-8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (onLog) onLog(line, false);
      }
    });

    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString('utf-8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (onLog) onLog(line, true);
      }
    });

    this.activeJobs.set(releaseId, managedJob);
    return managedJob;
  }

  /**
   * Probe health endpoint until HTTP 200 or TCP success, or until timeoutMs expires
   */
  public async waitForReleaseHealth(
    port: number,
    healthPath = '/',
    timeoutMs = 30000,
    intervalMs = 500
  ): Promise<boolean> {
    const startTime = Date.now();
    logger.info('release-manager', `Probing health for port ${port} at path ${healthPath}...`);

    while (Date.now() - startTime < timeoutMs) {
      const isListening = await portAllocator.isPortListening(port, 300);
      if (isListening) {
        const httpOk = await this.probeHttpHealth(port, healthPath);
        if (httpOk) {
          logger.success('release-manager', `Release passed health check on port ${port} (${Date.now() - startTime}ms)`);
          return true;
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    logger.warn('release-manager', `Health probe timed out after ${timeoutMs}ms for port ${port}`);
    return false;
  }

  private async probeHttpHealth(port: number, healthPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const cleanPath = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: cleanPath,
          method: 'GET',
          timeout: 1000,
        },
        (res) => {
          // Accept any 2xx or 3xx or 404 (if root is mounted but no explicit health endpoint)
          const ok = (res.statusCode && res.statusCode < 500) || false;
          resolve(ok);
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
   * Zero-downtime cutover & promotion (Item 4.6 & A3):
   * 1. Updates Caddy route upstream to the new release port.
   * 2. Synchronizes Caddy config.
   * 3. Updates activeReleaseId in database.
   * 4. Drains old release process (grace period).
   * 5. Prunes old releases beyond KEEP_RELEASES_COUNT.
   */
  public async promoteRelease(params: {
    appId: string;
    newReleaseId: string;
    newPort: number;
    oldReleaseId?: string | null;
    drainGraceMs?: number;
  }): Promise<void> {
    const { appId, newReleaseId, newPort, oldReleaseId, drainGraceMs = 3000 } = params;
    const client = prismaManager.getClient();

    const app = await client.app.findUnique({
      where: { id: appId },
    });

    if (!app) {
      throw new Error(`App ${appId} not found`);
    }

    logger.info('release-manager', `Promoting release ${newReleaseId} to active for app "${app.name}"...`);

    // 1. Update or create Route for app slug in database
    const existingRoute = await client.route.findUnique({
      where: { subdomain: app.slug },
    });

    if (existingRoute) {
      await client.route.update({
        where: { subdomain: app.slug },
        data: { targetPort: newPort },
      });
    } else {
      // Find or link a service entry or create standalone route
      let service = await client.service.findFirst({ where: { name: app.name } });
      if (!service) {
        service = await client.service.create({
          data: {
            name: app.name,
            type: 'custom',
            executable: 'node.exe',
            port: newPort,
            status: 'running',
            description: `Managed deployment app: ${app.name}`,
          },
        });
      }
      await client.route.create({
        data: {
          serviceId: service.id,
          subdomain: app.slug,
          targetPort: newPort,
          tlsEnabled: true,
        },
      });
    }

    // 2. Hot-reload Caddy reverse proxy upstream (zero downtime)
    await caddyManager.syncAllRoutes();

    // 3. Update App and Release database records
    await client.$transaction([
      client.app.update({
        where: { id: appId },
        data: {
          activeReleaseId: newReleaseId,
          port: newPort,
          status: 'running',
        },
      }),
      client.release.update({
        where: { id: newReleaseId },
        data: { status: 'healthy' },
      }),
    ]);

    // Emit event stream update
    eventBus.emitEvent({
      type: 'service.status',
      data: {
        id: appId,
        name: app.name,
        status: 'running',
        port: newPort,
        activeReleaseId: newReleaseId,
      },
    });

    // 4. Drain & gracefully stop old release process after grace period
    if (oldReleaseId && oldReleaseId !== newReleaseId) {
      setTimeout(async () => {
        logger.info('release-manager', `Draining complete; stopping old release ${oldReleaseId}`);
        await this.stopReleaseProcess(oldReleaseId);
        try {
          const oldRel = await client.release.findUnique({ where: { id: oldReleaseId } });
          if (oldRel) {
            portAllocator.releasePort(oldRel.port);
            await client.release.update({
              where: { id: oldReleaseId },
              data: { status: 'archived' },
            });
          }
        } catch {}
      }, drainGraceMs);
    }

    // 5. Prune old release folders to keep disk usage bounded
    await this.pruneOldReleases(appId);
  }

  /**
   * Instant Rollback (<15s) to a previously successful release (Item 4.6 & A4)
   */
  public async rollback(appId: string, targetReleaseId: string): Promise<ReleaseInfo> {
    const startTime = Date.now();
    const client = prismaManager.getClient();

    const [app, targetRelease] = await Promise.all([
      client.app.findUnique({ where: { id: appId } }),
      client.release.findUnique({ where: { id: targetReleaseId } }),
    ]);

    if (!app || !targetRelease) {
      throw new Error(`Cannot rollback: App or Target Release not found`);
    }

    if (!fs.existsSync(targetRelease.releasePath)) {
      throw new Error(`Cannot rollback: Release folder "${targetRelease.releasePath}" does not exist on disk`);
    }

    logger.info('release-manager', `Initiating instant rollback for app "${app.name}" to release #${targetRelease.releaseNumber}`);

    // Allocate fresh port for the previous release
    const targetPort = await portAllocator.allocatePort(targetRelease.port);

    // Start target release process
    await this.startReleaseProcess({
      releaseId: targetRelease.id,
      releasePath: targetRelease.releasePath,
      startCommand: app.startCommand || 'npm start',
      port: targetPort,
      maxMemoryMb: 512,
    });

    // Wait for target release health probe
    const healthy = await this.waitForReleaseHealth(targetPort, app.healthPath || '/', 12000);
    if (!healthy) {
      await this.stopReleaseProcess(targetRelease.id);
      portAllocator.releasePort(targetPort);
      throw new Error(`Rollback failed: previous release failed health check on port ${targetPort}`);
    }

    // Promote target release
    await this.promoteRelease({
      appId,
      newReleaseId: targetRelease.id,
      newPort: targetPort,
      oldReleaseId: app.activeReleaseId,
      drainGraceMs: 2000,
    });

    const elapsedMs = Date.now() - startTime;
    logger.success('release-manager', `Instant rollback completed in ${elapsedMs}ms (< 15s)`);

    return {
      ...targetRelease,
      port: targetPort,
      createdAt: targetRelease.createdAt.toISOString(),
    };
  }

  /**
   * Stop running release process
   */
  public async stopReleaseProcess(releaseId: string): Promise<void> {
    const job = this.activeJobs.get(releaseId);
    if (job) {
      this.activeJobs.delete(releaseId);
      await job.stop(3000);
      job.cleanup();
    }
  }

  /**
   * Prune old release folders from disk, keeping the latest N
   */
  public async pruneOldReleases(appId: string, keepCount = KEEP_RELEASES_COUNT): Promise<void> {
    try {
      const client = prismaManager.getClient();
      const releases = await client.release.findMany({
        where: { appId },
        orderBy: { releaseNumber: 'desc' },
      });

      if (releases.length <= keepCount) {
        return;
      }

      const toPrune = releases.slice(keepCount);
      for (const rel of toPrune) {
        // If active release, do not delete
        const app = await client.app.findUnique({ where: { id: appId } });
        if (app?.activeReleaseId === rel.id) continue;

        if (fs.existsSync(rel.releasePath)) {
          try {
            fs.rmSync(rel.releasePath, { recursive: true, force: true });
            logger.info('release-manager', `Pruned old release folder: ${rel.releasePath}`);
          } catch {}
        }

        await client.release.update({
          where: { id: rel.id },
          data: { status: 'archived' },
        });
      }
    } catch (err: any) {
      logger.warn('release-manager', `Prune notice: ${err.message}`);
    }
  }

  private copyDirectoryRecursive(src: string, dest: string) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      // Skip .git and node_modules if needed or keep compiled output
      if (entry.name === '.git') continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

export const releaseManager = new ReleaseManager();
