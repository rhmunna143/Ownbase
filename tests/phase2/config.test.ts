import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigManager, ConfigSchema } from '../../src/daemon/core/config';

describe('Item 2.4: Configuration Manager with Zod Validation', () => {
  let tempConfigFile: string;

  beforeEach(() => {
    tempConfigFile = path.join(os.tmpdir(), `test-config-${Date.now()}-${Math.random().toString(36).substring(2, 6)}.json`);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempConfigFile)) {
        fs.unlinkSync(tempConfigFile);
      }
    } catch {}
  });

  it('generates valid default configuration when file does not exist', () => {
    const manager = new ConfigManager(tempConfigFile);
    const cfg = manager.getConfig();

    expect(fs.existsSync(tempConfigFile)).toBe(true);
    expect(cfg.ports.daemon).toBe(3001);
    expect(cfg.ports.postgres).toBe(5432);
    expect(cfg.bindAddress).toBe('127.0.0.1');
    expect(cfg.logLevel).toBe('info');
  });

  it('validates and loads valid custom configuration', () => {
    const custom = {
      ports: {
        daemon: 3005,
        postgres: 5433,
        caddyAdmin: 2020,
        caddyHttp: 8080,
        caddyHttps: 8443,
      },
      logLevel: 'debug',
      hostnames: {
        localDomain: 'myhost.localhost',
      },
    };

    fs.writeFileSync(tempConfigFile, JSON.stringify(custom, null, 2), 'utf-8');

    const manager = new ConfigManager(tempConfigFile);
    const cfg = manager.getConfig();

    expect(cfg.ports.daemon).toBe(3005);
    expect(cfg.ports.postgres).toBe(5433);
    expect(cfg.logLevel).toBe('debug');
    expect(cfg.hostnames.localDomain).toBe('myhost.localhost');
  });

  it('rejects invalid ports schema and falls back safely to defaults', () => {
    const invalid = {
      ports: {
        daemon: 9999999, // out of range
      },
      logLevel: 'non-existent-level',
    };

    fs.writeFileSync(tempConfigFile, JSON.stringify(invalid), 'utf-8');

    const manager = new ConfigManager(tempConfigFile);
    const cfg = manager.getConfig();

    // Should safely fallback to valid defaults
    expect(cfg.ports.daemon).toBe(3001);
    expect(cfg.logLevel).toBe('info');
  });
});
