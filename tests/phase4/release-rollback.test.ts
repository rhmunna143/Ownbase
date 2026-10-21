import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ReleaseManager } from '../../src/daemon/deploy/release';
import { prismaManager } from '../../src/daemon/db/prisma';

describe('Phase 4 - Item 4.6 & A4: Release & Instant Rollback Engine', () => {
  let releaseManager: ReleaseManager;
  let workDir: string;
  let appId: string;

  beforeEach(async () => {
    releaseManager = new ReleaseManager();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownbase-release-test-'));

    // Create test app in DB
    const client = prismaManager.getClient();
    const app = await client.app.create({
      data: {
        name: `Rollback Test App ${Date.now()}`,
        slug: `rollback-test-${Date.now()}`,
        sourceType: 'archive',
        runtime: 'node',
        startCommand: 'node server.js',
        port: 4190,
        status: 'idle',
      },
    });
    appId = app.id;
  });

  afterEach(async () => {
    // Cleanup DB and temporary folders
    try {
      const client = prismaManager.getClient();
      if (appId) {
        await client.app.delete({ where: { id: appId } }).catch(() => {});
      }
    } catch {}

    if (fs.existsSync(workDir)) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('prepares versioned release directory structure (apps/<id>/releases/<n>)', async () => {
    // Create source files
    const srcDir = path.join(workDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'server.js'), 'console.log("Release 1");');

    const releaseDir = await releaseManager.prepareReleaseDirectory(appId, 1, srcDir);
    expect(fs.existsSync(releaseDir)).toBe(true);
    expect(fs.existsSync(path.join(releaseDir, 'server.js'))).toBe(true);
    expect(releaseDir).toContain(path.join(appId, 'releases', '1'));
  });

  it('performs instant rollback (< 15s) to a previously healthy release (A4)', async () => {
    const client = prismaManager.getClient();

    // Prepare Release 1 files
    const rel1Dir = path.join(workDir, 'rel1');
    fs.mkdirSync(rel1Dir, { recursive: true });
    // Write a tiny HTTP server for release 1
    fs.writeFileSync(
      path.join(rel1Dir, 'server.js'),
      `const http = require('http');
       const port = process.env.PORT || 4191;
       http.createServer((req, res) => { res.writeHead(200); res.end('RELEASE_1'); }).listen(port);`
    );

    const targetDir1 = await releaseManager.prepareReleaseDirectory(appId, 1, rel1Dir);
    const release1 = await client.release.create({
      data: {
        appId,
        releaseNumber: 1,
        port: 4191,
        status: 'healthy',
        releasePath: targetDir1,
      },
    });

    // Prepare Release 2 files
    const rel2Dir = path.join(workDir, 'rel2');
    fs.mkdirSync(rel2Dir, { recursive: true });
    fs.writeFileSync(
      path.join(rel2Dir, 'server.js'),
      `const http = require('http');
       const port = process.env.PORT || 4192;
       http.createServer((req, res) => { res.writeHead(200); res.end('RELEASE_2'); }).listen(port);`
    );

    const targetDir2 = await releaseManager.prepareReleaseDirectory(appId, 2, rel2Dir);
    const release2 = await client.release.create({
      data: {
        appId,
        releaseNumber: 2,
        port: 4192,
        status: 'healthy',
        releasePath: targetDir2,
      },
    });

    // Set release 2 as current active release
    await client.app.update({
      where: { id: appId },
      data: {
        activeReleaseId: release2.id,
        port: 4192,
        status: 'running',
      },
    });

    // Measure rollback duration
    const startTime = Date.now();
    const rolledBack = await releaseManager.rollback(appId, release1.id);
    const durationMs = Date.now() - startTime;

    // Requirement A4: Rollback completes in under 15 seconds
    expect(durationMs).toBeLessThan(15000);
    expect(rolledBack.id).toBe(release1.id);

    // Verify active release in database is now release 1
    const updatedApp = await client.app.findUnique({ where: { id: appId } });
    expect(updatedApp?.activeReleaseId).toBe(release1.id);

    // Cleanup active release process
    await releaseManager.stopReleaseProcess(release1.id);
    await releaseManager.stopReleaseProcess(release2.id);
  });

  it('prunes older release folders to keep disk usage bounded (keeps last 3 releases)', async () => {
    const client = prismaManager.getClient();

    // Create 4 dummy releases
    const releases = [];
    for (let i = 1; i <= 4; i++) {
      const dir = path.join(workDir, `rel-${i}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.txt'), `Version ${i}`);
      const relDir = await releaseManager.prepareReleaseDirectory(appId, i, dir);

      const r = await client.release.create({
        data: {
          appId,
          releaseNumber: i,
          port: 4180 + i,
          status: 'healthy',
          releasePath: relDir,
        },
      });
      releases.push(r);
    }

    // Set release 4 as active
    await client.app.update({
      where: { id: appId },
      data: { activeReleaseId: releases[3].id },
    });

    // Prune keeping 3
    await releaseManager.pruneOldReleases(appId, 3);

    // Release 1 folder should be pruned
    expect(fs.existsSync(releases[0].releasePath)).toBe(false);
    // Releases 2, 3, 4 should still exist
    expect(fs.existsSync(releases[1].releasePath)).toBe(true);
    expect(fs.existsSync(releases[2].releasePath)).toBe(true);
    expect(fs.existsSync(releases[3].releasePath)).toBe(true);
  });
});
