import fs from 'fs';
import path from 'path';
import { prismaManager } from '../db/prisma';
import { logger } from '../core/logger';
import { paths } from '../core/paths';
import { sourceIntakeManager } from './source';
import { projectDetector, DetectedProject } from './detect';
import { buildRunner, BuildResult } from './build/runner';
import { releaseManager } from './release';
import { portAllocator } from './ports';
import { eventBus } from '../core/events';

export type DeploymentStatus =
  | 'queued'
  | 'fetching'
  | 'building'
  | 'starting'
  | 'healthy'
  | 'promoted'
  | 'failed'
  | 'cancelled';

export interface TriggerDeployOptions {
  appId: string;
  triggeredBy?: string;
  sourceType?: 'git' | 'archive' | 'catalog';
  archivePath?: string;
  commitHash?: string;
}

export interface DeploymentRecord {
  id: string;
  appId: string;
  releaseId?: string | null;
  status: DeploymentStatus;
  triggeredBy: string;
  commitHash?: string | null;
  error?: string | null;
  logs?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export class DeploymentPipeline {
  // App-level lock: appId -> deploymentId
  private activeAppDeploys = new Map<string, string>();
  private activeAborts = new Map<string, () => void>();

  /**
   * Check if an app currently has a running deployment
   */
  public isDeploying(appId: string): boolean {
    return this.activeAppDeploys.has(appId);
  }

  /**
   * Cancel an in-progress deployment
   */
  public cancelDeployment(deploymentId: string): boolean {
    const abortFn = this.activeAborts.get(deploymentId);
    if (abortFn) {
      abortFn();
      this.activeAborts.delete(deploymentId);
      logger.info('deploy-pipeline', `Cancellation requested for deployment ${deploymentId}`);
      return true;
    }
    return false;
  }

  /**
   * Execute full deployment pipeline:
   * queued -> fetching -> building -> starting -> healthy -> promoted (or failed)
   */
  public async triggerDeploy(options: TriggerDeployOptions): Promise<DeploymentRecord> {
    const { appId, triggeredBy = 'user', sourceType = 'git', archivePath } = options;
    const client = prismaManager.getClient();

    const app = await client.app.findUnique({
      where: { id: appId },
    });

    if (!app) {
      throw new Error(`App with ID "${appId}" not found`);
    }

    // Enforce strictly one deploy per app at a time
    if (this.activeAppDeploys.has(appId)) {
      throw new Error(`Deployment already in progress for app "${app.name}" (Active: ${this.activeAppDeploys.get(appId)})`);
    }

    // Create deployment record in DB
    const deployment = await client.deployment.create({
      data: {
        appId,
        status: 'queued',
        triggeredBy,
      },
    });

    this.activeAppDeploys.set(appId, deployment.id);

    // Launch pipeline asynchronously
    this.executePipeline(deployment.id, app, sourceType, archivePath)
      .catch((err) => {
        logger.error('deploy-pipeline', `Pipeline fatal error for ${deployment.id}: ${err.message}`);
      })
      .finally(() => {
        this.activeAppDeploys.delete(appId);
        this.activeAborts.delete(deployment.id);
      });

    return {
      ...deployment,
      triggeredBy: deployment.triggeredBy || 'user',
      status: 'queued' as DeploymentStatus,
      startedAt: deployment.startedAt.toISOString(),
      finishedAt: deployment.finishedAt ? deployment.finishedAt.toISOString() : null,
    };
  }

  private async executePipeline(
    deploymentId: string,
    app: any,
    sourceType: string,
    archivePath?: string
  ): Promise<void> {
    const client = prismaManager.getClient();
    let accumulatedLogs = '';
    let isCancelled = false;
    let allocatedPort: number | null = null;
    let newRelease: any = null;

    this.activeAborts.set(deploymentId, () => {
      isCancelled = true;
    });

    const updateStatus = async (status: DeploymentStatus, error?: string, releaseId?: string) => {
      try {
        await client.deployment.update({
          where: { id: deploymentId },
          data: {
            status,
            error,
            releaseId,
            logs: accumulatedLogs,
            finishedAt: ['promoted', 'failed', 'cancelled'].includes(status) ? new Date() : undefined,
          },
        });
      } catch {}

      eventBus.emitEvent({
        type: 'deploy.status',
        data: {
          deploymentId,
          appId: app.id,
          status,
          error,
          releaseId,
        },
      });
    };

    const appendLog = (line: string, isError = false) => {
      const sanitized = line.replace(/\r?\n$/, '');
      if (!sanitized) return;
      accumulatedLogs += (isError ? `[ERR] ` : `[OUT] `) + sanitized + '\n';

      eventBus.emitEvent({
        type: 'deploy.log',
        data: {
          deploymentId,
          appId: app.id,
          line: sanitized,
          isError,
        },
      });
    };

    const tempWorkDir = path.join(paths.dataDir, 'tmp', `build-${deploymentId}`);

    try {
      // 1. FETCHING
      await updateStatus('fetching');
      appendLog(`[PIPELINE] State -> FETCHING (${sourceType})`);

      if (sourceType === 'git') {
        if (!app.repoUrl) {
          throw new Error('Application does not have a configured Git repository URL');
        }
        appendLog(`Cloning repository ${app.repoUrl} (branch: ${app.branch || 'main'})...`);
        const cloneRes = await sourceIntakeManager.cloneGitRepository({
          repoUrl: app.repoUrl,
          targetDir: tempWorkDir,
          branch: app.branch || 'main',
          onProgress: (line) => appendLog(line),
        });

        if (!cloneRes.success) {
          throw new Error(`Git clone failed: ${cloneRes.error}`);
        }
        if (cloneRes.commitHash) {
          await client.deployment.update({
            where: { id: deploymentId },
            data: { commitHash: cloneRes.commitHash },
          });
        }
      } else if (sourceType === 'archive' && archivePath) {
        appendLog(`Extracting uploaded source archive from ${archivePath}...`);
        await sourceIntakeManager.extractArchiveSafely(archivePath, tempWorkDir);
      } else {
        throw new Error(`Unsupported source type or missing archive: ${sourceType}`);
      }

      if (isCancelled) {
        await updateStatus('cancelled', 'Deployment cancelled by user');
        return;
      }

      // 2. DETECTING & RECIPE RESOLUTION
      appendLog(`[PIPELINE] Inspecting project structure and build configuration...`);
      const detected = await projectDetector.detect(tempWorkDir, {
        runtime: app.runtime,
        buildCommand: app.buildCommand,
        startCommand: app.startCommand,
        port: app.port,
        healthPath: app.healthPath,
      });

      appendLog(`Detected runtime: ${detected.runtime} (framework: ${detected.detectedFramework || 'generic'})`);
      appendLog(`Build command: "${detected.buildCommand || 'none'}"`);
      appendLog(`Start command: "${detected.startCommand}"`);

      // 3. BUILDING
      if (detected.buildCommand) {
        await updateStatus('building');
        appendLog(`[PIPELINE] State -> BUILDING inside Win32 Job Object sandbox...`);

        const buildRes = await buildRunner.run({
          projectDir: tempWorkDir,
          command: detected.buildCommand,
          onLog: (line, isError) => appendLog(line, isError),
        });

        if (!buildRes.success) {
          // A2 Requirement: Failing build NEVER touches running release!
          throw new Error(`Build failed: ${buildRes.error || 'non-zero exit code'}`);
        }
      }

      if (isCancelled) {
        await updateStatus('cancelled', 'Deployment cancelled by user');
        return;
      }

      // 4. PREPARE ATOMIC RELEASE
      const lastRelease = await client.release.findFirst({
        where: { appId: app.id },
        orderBy: { releaseNumber: 'desc' },
      });
      const nextReleaseNum = (lastRelease?.releaseNumber || 0) + 1;

      appendLog(`[PIPELINE] Preparing atomic release #${nextReleaseNum}...`);
      const releaseFolder = await releaseManager.prepareReleaseDirectory(
        app.id,
        nextReleaseNum,
        tempWorkDir
      );

      // Allocate fresh port from 4000-4999 (Item 4.5)
      allocatedPort = await portAllocator.allocatePort(detected.defaultPort);
      appendLog(`Allocated port ${allocatedPort} for release #${nextReleaseNum}`);

      newRelease = await client.release.create({
        data: {
          appId: app.id,
          releaseNumber: nextReleaseNum,
          port: allocatedPort,
          status: 'building',
          releasePath: releaseFolder,
          buildLogs: accumulatedLogs,
        },
      });

      // 5. STARTING
      await updateStatus('starting', undefined, newRelease.id);
      appendLog(`[PIPELINE] State -> STARTING release #${nextReleaseNum} on port ${allocatedPort}...`);

      await releaseManager.startReleaseProcess({
        releaseId: newRelease.id,
        releasePath: releaseFolder,
        startCommand: detected.startCommand,
        port: allocatedPort,
        onLog: (line, isError) => appendLog(`[APP] ${line}`, isError),
      });

      // 6. HEALTH PROBING
      appendLog(`[PIPELINE] Probing health endpoint (${detected.healthPath || '/'}) on port ${allocatedPort}...`);
      const isHealthy = await releaseManager.waitForReleaseHealth(
        allocatedPort,
        detected.healthPath || '/',
        30000
      );

      if (!isHealthy) {
        // Health check failed! Stop new process, free port, leave active release untouched!
        await releaseManager.stopReleaseProcess(newRelease.id);
        portAllocator.releasePort(allocatedPort);
        await client.release.update({
          where: { id: newRelease.id },
          data: { status: 'failed' },
        });
        throw new Error(`Release failed health check on port ${allocatedPort} (${detected.healthPath})`);
      }

      await updateStatus('healthy', undefined, newRelease.id);
      appendLog(`[PIPELINE] State -> HEALTHY`);

      // 7. PROMOTION & ZERO-DOWNTIME CUTOVER (Item 4.6 & A3)
      appendLog(`[PIPELINE] State -> PROMOTING to live reverse proxy (zero-downtime cutover)...`);
      await releaseManager.promoteRelease({
        appId: app.id,
        newReleaseId: newRelease.id,
        newPort: allocatedPort,
        oldReleaseId: app.activeReleaseId,
        drainGraceMs: 3000,
      });

      await updateStatus('promoted', undefined, newRelease.id);
      appendLog(`[PIPELINE] State -> PROMOTED. App "${app.name}" is successfully live!`);
    } catch (err: any) {
      logger.error('deploy-pipeline', `Deployment failed: ${err.message}`);
      appendLog(`[PIPELINE ERROR] ${err.message}`, true);

      if (allocatedPort && (!newRelease || newRelease.status !== 'healthy')) {
        portAllocator.releasePort(allocatedPort);
      }

      await updateStatus(isCancelled ? 'cancelled' : 'failed', err.message, newRelease?.id);
    } finally {
      // Clean up temporary build workspace
      if (fs.existsSync(tempWorkDir)) {
        try {
          fs.rmSync(tempWorkDir, { recursive: true, force: true });
        } catch {}
      }
    }
  }
}

export const deploymentPipeline = new DeploymentPipeline();
