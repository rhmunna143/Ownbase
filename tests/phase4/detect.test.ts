import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProjectDetector } from '../../src/daemon/deploy/detect';

describe('Phase 4 - Item 4.3 & A1: Project Detector & Recipe Resolver', () => {
  let detector: ProjectDetector;
  let tempDir: string;

  beforeEach(() => {
    detector = new ProjectDetector();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownbase-detect-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('detects a Node Express app from package.json', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'express-sample',
        dependencies: { express: '^4.19.0' },
        scripts: { start: 'node server.js' },
      })
    );

    const detected = await detector.detect(tempDir);
    expect(detected.runtime).toBe('node');
    expect(detected.detectedFramework).toBe('express');
    expect(detected.startCommand).toBe('npm start');
    expect(detected.defaultPort).toBe(3000);
    expect(detected.configSource).toBe('package.json');
  });

  it('detects a Next.js app with build and start commands', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'next-sample',
        dependencies: { next: '14.2.15', react: '18.3.1' },
      })
    );

    const detected = await detector.detect(tempDir);
    expect(detected.runtime).toBe('node');
    expect(detected.detectedFramework).toBe('next');
    expect(detected.buildCommand).toBe('npm run build');
    expect(detected.startCommand).toBe('npm run start');
    expect(detected.hasBuildStep).toBe(true);
  });

  it('detects a Python FastAPI app from main.py and requirements.txt', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'requirements.txt'),
      'fastapi>=0.110.0\nuvicorn>=0.28.0\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'main.py'),
      'from fastapi import FastAPI\napp = FastAPI()\n'
    );

    const detected = await detector.detect(tempDir);
    expect(detected.runtime).toBe('python');
    expect(detected.detectedFramework).toBe('fastapi');
    expect(detected.buildCommand).toBe('pip install -r requirements.txt');
    expect(detected.startCommand).toContain('uvicorn main:app');
    expect(detected.defaultPort).toBe(8000);
  });

  it('detects a Go project from go.mod and main.go', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'go.mod'),
      'module example.com/my-service\n\ngo 1.22\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'main.go'),
      'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("Hello") }\n'
    );

    const detected = await detector.detect(tempDir);
    expect(detected.runtime).toBe('go');
    expect(detected.detectedFramework).toBe('go');
    expect(detected.buildCommand).toBe('go build -o app.exe .');
    expect(detected.startCommand).toBe('app.exe');
    expect(detected.defaultPort).toBe(8080);
  });

  it('detects a static website from index.html', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'index.html'),
      '<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>'
    );

    const detected = await detector.detect(tempDir);
    expect(detected.runtime).toBe('static');
    expect(detected.detectedFramework).toBe('static-html');
    expect(detected.hasBuildStep).toBe(false);
  });

  it('prioritizes ownbase.json configuration over automatic detection', async () => {
    // Add conflicting package.json
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'should-be-overridden' })
    );

    // Add explicit ownbase.json override
    fs.writeFileSync(
      path.join(tempDir, 'ownbase.json'),
      JSON.stringify({
        runtime: 'go',
        buildCommand: 'go build -tags prod -o custom.exe',
        startCommand: 'custom.exe --prod',
        port: 9090,
        healthPath: '/api/v1/health',
      })
    );

    const detected = await detector.detect(tempDir);
    expect(detected.runtime).toBe('go');
    expect(detected.buildCommand).toBe('go build -tags prod -o custom.exe');
    expect(detected.startCommand).toBe('custom.exe --prod');
    expect(detected.defaultPort).toBe(9090);
    expect(detected.healthPath).toBe('/api/v1/health');
    expect(detected.configSource).toBe('repo-config');
  });
});
