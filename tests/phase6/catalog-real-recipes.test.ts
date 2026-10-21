import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { catalogManager, CatalogRecipeSchema } from '../../src/daemon/deploy/catalog';
import { BUILTIN_RECIPES } from '../../src/daemon/supervisor/spec';
import { SecretsManager } from '../../src/daemon/core/secrets';

describe('Phase 6: Real Service Recipes & Credentials (PRD §6.1, 6.2, 6.3)', () => {
  let tempSecretsDir: string;
  let secretsManager: SecretsManager;

  beforeEach(() => {
    tempSecretsDir = path.join(process.cwd(), '.data', `test-secrets-${Date.now()}`);
    fs.mkdirSync(tempSecretsDir, { recursive: true });
    secretsManager = new SecretsManager(tempSecretsDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempSecretsDir)) {
      try { fs.rmSync(tempSecretsDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('validates FileBrowser recipe with pinned SHA-256 and loopback binding (Item 6.1 & D12)', () => {
    const filebrowser = catalogManager.getRecipe('filebrowser');
    expect(filebrowser).toBeDefined();

    // Strict schema check
    const parsed = CatalogRecipeSchema.safeParse(filebrowser);
    expect(parsed.success).toBe(true);

    // Pinned SHA-256 integrity
    expect(filebrowser?.source).toBeDefined();
    expect(filebrowser?.source?.sha256).toBeDefined();
    expect(filebrowser?.source?.sha256).toHaveLength(64);
    expect(filebrowser?.source?.url).toContain('filebrowser');

    // Bound to loopback behind Caddy (never 0.0.0.0)
    expect(filebrowser?.spec.args).toContain('-a');
    const bindIndex = filebrowser?.spec.args.indexOf('-a') ?? -1;
    expect(filebrowser?.spec.args[bindIndex + 1]).toBe('127.0.0.1');

    // Default subdomain
    expect(filebrowser?.defaultSubdomain).toBe('files');
    expect(filebrowser?.defaultPort).toBe(8080);
  });

  it('generates random FileBrowser setup credentials (no hardcoded admin12345678)', () => {
    const creds1 = secretsManager.getOrCreateFileBrowserCredentials();
    expect(creds1.username).toBe('admin');
    expect(creds1.password).toBeDefined();
    expect(creds1.password.length).toBeGreaterThanOrEqual(16);
    expect(creds1.password).not.toBe('admin12345678');

    // Re-reading persists same encrypted credentials
    const creds2 = secretsManager.getOrCreateFileBrowserCredentials();
    expect(creds2.password).toBe(creds1.password);
  });

  it('validates Ollama recipe with pinned SHA-256, loopback binding, and bulk volume models dir (Item 6.2)', () => {
    const ollama = catalogManager.getRecipe('ollama');
    expect(ollama).toBeDefined();

    // Pinned SHA-256 integrity
    expect(ollama?.source?.sha256).toBeDefined();
    expect(ollama?.source?.sha256).toHaveLength(64);

    // Loopback binding
    expect(ollama?.env['OLLAMA_HOST']).toBe('127.0.0.1:11434');

    // Builtin spec inspection
    const spec = BUILTIN_RECIPES.ollama({ id: 'ollama', name: 'Ollama', port: 11434 } as any);
    expect(spec.env?.['OLLAMA_HOST']).toBe('127.0.0.1:11434');
    expect(spec.env?.['OLLAMA_MODELS']).toBeDefined();
    expect(spec.env?.['OLLAMA_MODELS']).toContain('models');
  });

  it('validates MinIO / S3 recipe with pinned SHA-256 and encrypted root secrets (Item 6.3 & D13)', () => {
    const minio = catalogManager.getRecipe('minio');
    const s3 = catalogManager.getRecipe('s3');
    expect(minio).toBeDefined();
    expect(s3).toBeDefined();

    // Pinned SHA-256 integrity
    expect(minio?.source?.sha256).toBeDefined();
    expect(minio?.source?.sha256).toHaveLength(64);

    // S3 credentials encrypted in secrets
    const s3Creds = secretsManager.getOrCreateS3Credentials();
    expect(s3Creds.accessKey).toBeDefined();
    expect(s3Creds.accessKey.startsWith('ownbase_')).toBe(true);
    expect(s3Creds.secretKey).toBeDefined();
    expect(s3Creds.secretKey.length).toBeGreaterThanOrEqual(24);

    // Supervisor spec binds loopback and injects credentials
    const spec = BUILTIN_RECIPES.minio({ id: 'minio', name: 'MinIO', port: 9000 } as any);
    expect(spec.args).toContain('--address');
    const addrIdx = spec.args.indexOf('--address');
    expect(spec.args[addrIdx + 1]).toBe('127.0.0.1:9000');
    expect(spec.env?.['MINIO_ROOT_USER']).toBeDefined();
    expect(spec.env?.['MINIO_ROOT_PASSWORD']).toBeDefined();
  });
});
