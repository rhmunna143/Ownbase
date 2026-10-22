import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { deploymentPipeline } from '../../src/daemon/deploy/pipeline';
import { prismaManager } from '../../src/daemon/db/prisma';
import { releaseManager } from '../../src/daemon/deploy/release';

describe('Phase 4 - Item 4.7 & A2: Deployment Pipeline Orchestrator', () => {
  let workDir: string;
  let appId: string;

  beforeEach(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownbase-pipeline-test-'));

    const client = prismaManager.getClient();
    const app = await client.app.create({
      data: {
        name: `Pipeline Test App ${Date.now()}`,
        slug: `pipeline-app-${Date.now()}`,
        sourceType: 'archive',
        runtime: 'node',
        startCommand: 'node server.js',
        status: 'idle',
      },
    });
    appId = app.id;
  });

  afterEach(async () => {
    try {
      const client = prismaManager.getClient();
      if (appId) {
        const app = await client.app.findUnique({ where: { id: appId } });
        if (app?.activeReleaseId) {
          await releaseManager.stopReleaseProcess(app.activeReleaseId);
        }
        await client.service.deleteMany({ where: { name: { startsWith: 'Pipeline Test App' } } }).catch(() => {});
        await client.app.delete({ where: { id: appId } }).catch(() => {});
      }
    } catch {}

    if (fs.existsSync(workDir)) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('executes full pipeline successfully: queued -> fetching -> starting -> healthy -> promoted', async () => {
    // Prepare valid Node app in archive
    const appSrc = path.join(workDir, 'app');
    fs.mkdirSync(appSrc, { recursive: true });
    fs.writeFileSync(
      path.join(appSrc, 'package.json'),
      JSON.stringify({
        name: 'sample-app',
        main: 'server.js',
        scripts: { start: 'node server.js' },
      })
    );
    fs.writeFileSync(
      path.join(appSrc, 'server.js'),
      `const http = require('http');
       const port = process.env.PORT || 4100;
       http.createServer((req, res) => {
         res.writeHead(200, { 'Content-Type': 'text/plain' });
         res.end('HELLO_FROM_PIPELINE');
       }).listen(port);`
    );

    const archivePath = path.join(workDir, 'app.zip');
    execSync(`tar -cf "${archivePath}" -C "${appSrc}" package.json server.js`);

    const trigger = await deploymentPipeline.triggerDeploy({
      appId,
      sourceType: 'archive',
      archivePath,
    });

    expect(trigger.status).toBe('queued');

    // Poll until deployment finishes
    const client = prismaManager.getClient();
    let finalDep: any = null;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      finalDep = await client.deployment.findUnique({ where: { id: trigger.id } });
      if (finalDep && ['promoted', 'failed', 'cancelled'].includes(finalDep.status)) {
        break;
      }
    }

    expect(finalDep?.status).toBe('promoted');
    expect(finalDep?.releaseId).toBeTruthy();

    const app = await client.app.findUnique({ where: { id: appId } });
    expect(app?.status).toBe('running');
    expect(app?.activeReleaseId).toBe(finalDep.releaseId);
  });

  it('rejects concurrent deployments on the same app (one deploy per app)', async () => {
    // Create an app that takes time
    const client = prismaManager.getClient();

    // Trigger first deploy
    const appSrc = path.join(workDir, 'app');
    fs.mkdirSync(appSrc, { recursive: true });
    fs.writeFileSync(path.join(appSrc, 'index.html'), '<h1>Test</h1>');
    const archivePath = path.join(workDir, 'app.zip');
    execSync(`tar -cf "${archivePath}" -C "${appSrc}" index.html`);

    await deploymentPipeline.triggerDeploy({
      appId,
      sourceType: 'archive',
      archivePath,
    });

    // Immediate second trigger on same app should reject
    await expect(
      deploymentPipeline.triggerDeploy({
        appId,
        sourceType: 'archive',
        archivePath,
      })
    ).rejects.toThrow(/Deployment already in progress/);
  });

  it('failing build NEVER touches running release and records failing logs (A2)', async () => {
    const client = prismaManager.getClient();

    // Set initial working active release
    const initialRelease = await client.release.create({
      data: {
        appId,
        releaseNumber: 1,
        port: 4199,
        status: 'healthy',
        releasePath: workDir,
      },
    });

    await client.app.update({
      where: { id: appId },
      data: {
        activeReleaseId: initialRelease.id,
        port: 4199,
        status: 'running',
        buildCommand: 'exit /b 99', // Deliberately failing build command
      },
    });

    const appSrc = path.join(workDir, 'app_broken');
    fs.mkdirSync(appSrc, { recursive: true });
    fs.writeFileSync(path.join(appSrc, 'server.js'), 'console.log("Broken");');
    const archivePath = path.join(workDir, 'broken.zip');
    execSync(`tar -cf "${archivePath}" -C "${appSrc}" server.js`);

    const trigger = await deploymentPipeline.triggerDeploy({
      appId,
      sourceType: 'archive',
      archivePath,
    });

    // Await failure
    let finalDep: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 400));
      finalDep = await client.deployment.findUnique({ where: { id: trigger.id } });
      if (finalDep && ['promoted', 'failed', 'cancelled'].includes(finalDep.status)) {
        break;
      }
    }

    expect(finalDep?.status).toBe('failed');
    expect(finalDep?.error).toContain('Build failed');

    // Requirement A2: Active running release remains 100% untouched!
    const unchangedApp = await client.app.findUnique({ where: { id: appId } });
    expect(unchangedApp?.activeReleaseId).toBe(initialRelease.id);
    expect(unchangedApp?.port).toBe(4199);
  });
});
