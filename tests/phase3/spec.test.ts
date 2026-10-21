import { describe, it, expect } from 'vitest';
import { resolveServiceSpec, BUILTIN_RECIPES } from '../../src/daemon/supervisor/spec';
import { ServiceRecord } from '../../src/shared/types';

describe('Phase 3 - Item 3.1: ServiceSpec & Builtin Recipes', () => {
  it('resolves caddy recipe with standard args, port 80, and tcp health check', () => {
    const record: ServiceRecord = {
      id: 'svc-caddy',
      name: 'Caddy Reverse Proxy',
      type: 'caddy',
      executable: 'caddy.exe',
      port: 80,
      status: 'stopped',
      autoStart: true,
      pid: null,
      description: 'Edge reverse proxy',
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const spec = resolveServiceSpec(record);
    expect(spec.templateId).toBe('caddy');
    expect(spec.executable).toBe('caddy.exe');
    expect(spec.args).toEqual(['run']);
    expect(spec.port).toBe(80);
    expect(spec.healthProbe).toBeDefined();
    expect(spec.healthProbe?.type).toBe('tcp');
    expect(spec.healthProbe?.port).toBe(2019);
    expect(spec.limits?.maxMemoryMb).toBe(512);
    expect(spec.restartPolicy).toBe('always');
  });

  it('resolves filebrowser recipe with storage dir, db file, and http health probe', () => {
    const record: ServiceRecord = {
      id: 'svc-filebrowser',
      name: 'File Manager',
      type: 'filebrowser',
      executable: 'filebrowser.exe',
      port: 8080,
      status: 'stopped',
      autoStart: true,
      pid: null,
      description: 'Web file browser',
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const spec = resolveServiceSpec(record);
    expect(spec.templateId).toBe('filebrowser');
    expect(spec.port).toBe(8080);
    expect(spec.args).toContain('-p');
    expect(spec.args).toContain('8080');
    expect(spec.args).toContain('-a');
    expect(spec.args).toContain('0.0.0.0');
    expect(spec.healthProbe?.type).toBe('http');
    expect(spec.healthProbe?.path).toBe('/login');
  });

  it('resolves ollama recipe with 4GB memory limit and isolated OLLAMA_HOST env', () => {
    const record: ServiceRecord = {
      id: 'svc-ollama',
      name: 'Ollama AI',
      type: 'ollama',
      executable: 'ollama.exe',
      port: 11434,
      status: 'stopped',
      autoStart: true,
      pid: null,
      description: 'Local AI LLM host',
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const spec = resolveServiceSpec(record);
    expect(spec.templateId).toBe('ollama');
    expect(spec.limits?.maxMemoryMb).toBe(4096);
    expect(spec.env?.OLLAMA_HOST).toBe('0.0.0.0:11434');
    expect(spec.healthProbe?.type).toBe('http');
  });

  it('resolves minio recipe with s3 data dir and live health check', () => {
    const record: ServiceRecord = {
      id: 'svc-minio',
      name: 'MinIO S3',
      type: 'minio',
      executable: 'minio.exe',
      port: 9000,
      status: 'stopped',
      autoStart: true,
      pid: null,
      description: 'S3 Object Storage',
      config: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const spec = resolveServiceSpec(record);
    expect(spec.templateId).toBe('minio');
    expect(spec.args).toContain('server');
    expect(spec.healthProbe?.type).toBe('http');
    expect(spec.healthProbe?.path).toBe('/minio/health/live');
  });

  it('allows overriding args, limits, and restart policy', () => {
    const record: ServiceRecord = {
      id: 'svc-custom',
      name: 'Custom Service',
      type: 'custom',
      executable: 'custom.exe',
      port: 5000,
      status: 'stopped',
      autoStart: false,
      pid: null,
      description: 'Custom workload',
      config: {
        maxMemoryMb: 256,
        restartPolicy: 'on-failure',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const spec = resolveServiceSpec(record, {
      args: ['--custom-flag', 'value'],
      limits: { maxMemoryMb: 128, cpuLimitPct: 25 },
    });

    expect(spec.args).toEqual(['--custom-flag', 'value']);
    expect(spec.limits?.maxMemoryMb).toBe(128);
    expect(spec.limits?.cpuLimitPct).toBe(25);
    expect(spec.restartPolicy).toBe('on-failure');
  });
});
