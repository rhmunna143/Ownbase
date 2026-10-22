import path from 'path';
import fs from 'fs';
import { paths } from '../core/paths';
import { secretsManager } from '../core/secrets';
import { ServiceRecord } from '../../shared/types';

export type RestartPolicy = 'always' | 'on-failure' | 'never';

export interface HealthProbeSpec {
  type: 'http' | 'tcp';
  port?: number;
  path?: string;
  intervalMs?: number;
  timeoutMs?: number;
  startPeriodMs?: number;
  failureThreshold?: number;
}

export interface ResourceLimitsSpec {
  maxMemoryMb?: number;
  cpuLimitPct?: number; // 1 - 100
}

export interface StopBehaviorSpec {
  timeoutMs?: number;
  signal?: 'ctrl-break' | 'kill';
}

export interface ServiceSpec {
  id: string;
  name: string;
  templateId?: string;
  appType: string;
  executable: string;
  args: string[];
  cwd: string;
  port: number | null;
  envAllowlist?: string[];
  env?: Record<string, string>;
  limits?: ResourceLimitsSpec;
  restartPolicy: RestartPolicy;
  healthProbe?: HealthProbeSpec;
  stopBehavior?: StopBehaviorSpec;
  description?: string | null;
}

/**
 * Builtin service recipes providing standard arguments, directories, ports, and health probes.
 */
export const BUILTIN_RECIPES: Record<string, (service: ServiceRecord) => Partial<ServiceSpec>> = {
  caddy: (service) => ({
    templateId: 'caddy',
    appType: 'native',
    executable: 'caddy.exe',
    args: ['run'],
    cwd: paths.rootDir,
    port: service.port || 80,
    restartPolicy: 'always',
    healthProbe: {
      type: 'tcp',
      port: 2019,
      intervalMs: 10000,
      timeoutMs: 3000,
      startPeriodMs: 5000,
      failureThreshold: 3,
    },
    limits: {
      maxMemoryMb: 512,
      cpuLimitPct: 50,
    },
  }),

  filebrowser: (service) => {
    const storageDir = paths.storageDir;
    const dbPath = path.join(paths.dataDir, 'filebrowser.db');
    if (!fs.existsSync(storageDir)) {
      try { fs.mkdirSync(storageDir, { recursive: true }); } catch {}
    }

    const creds = secretsManager.getOrCreateFileBrowserCredentials();
    const port = service.port || 8080;
    return {
      templateId: 'filebrowser',
      appType: 'native',
      executable: 'filebrowser.exe',
      args: ['-p', port.toString(), '-a', '127.0.0.1', '-r', storageDir, '-d', dbPath],
      cwd: paths.rootDir,
      port,
      restartPolicy: 'always',
      healthProbe: {
        type: 'http',
        port,
        path: '/login',
        intervalMs: 15000,
        timeoutMs: 4000,
        startPeriodMs: 5000,
        failureThreshold: 3,
      },
      env: {
        FILEBROWSER_USERNAME: creds.username,
      },
      limits: {
        maxMemoryMb: 512,
        cpuLimitPct: 50,
      },
    };
  },

  ollama: (service) => {
    const port = service.port || 11434;
    const modelsDir = path.join(paths.storageDir, 'models');
    if (!fs.existsSync(modelsDir)) {
      try { fs.mkdirSync(modelsDir, { recursive: true }); } catch {}
    }

    return {
      templateId: 'ollama',
      appType: 'native',
      executable: 'ollama.exe',
      args: ['serve'],
      cwd: paths.rootDir,
      port,
      restartPolicy: 'always',
      healthProbe: {
        type: 'http',
        port,
        path: '/',
        intervalMs: 20000,
        timeoutMs: 5000,
        startPeriodMs: 8000,
        failureThreshold: 3,
      },
      env: {
        OLLAMA_HOST: '127.0.0.1:11434',
        OLLAMA_MODELS: modelsDir,
      },
      limits: {
        maxMemoryMb: 4096,
        cpuLimitPct: 90,
      },
    };
  },

  minio: (service) => {
    const storageDir = path.join(paths.dataDir, 'minio-data');
    if (!fs.existsSync(storageDir)) {
      try { fs.mkdirSync(storageDir, { recursive: true }); } catch {}
    }

    const port = service.port || 9000;
    const creds = secretsManager.getOrCreateS3Credentials();

    return {
      templateId: 'minio',
      appType: 'native',
      executable: 'minio.exe',
      args: ['server', storageDir, '--address', `127.0.0.1:${port}`, '--console-address', `127.0.0.1:${port + 1}`],
      cwd: paths.rootDir,
      port,
      restartPolicy: 'always',
      healthProbe: {
        type: 'http',
        port,
        path: '/minio/health/live',
        intervalMs: 15000,
        timeoutMs: 4000,
        startPeriodMs: 5000,
        failureThreshold: 3,
      },
      env: {
        MINIO_ROOT_USER: creds.accessKey,
        MINIO_ROOT_PASSWORD: creds.secretKey,
      },
      limits: {
        maxMemoryMb: 1024,
        cpuLimitPct: 50,
      },
    };
  },

  s3: (service) => {
    return BUILTIN_RECIPES.minio(service);
  },

  postgres: (service) => {
    const port = service.port || 5432;
    return {
      templateId: 'postgres',
      appType: 'native',
      executable: 'postgres.exe',
      args: ['-D', paths.postgresDir, '-p', port.toString(), '-h', '127.0.0.1'],
      cwd: paths.rootDir,
      port,
      restartPolicy: 'always',
      healthProbe: {
        type: 'tcp',
        port,
        intervalMs: 10000,
        timeoutMs: 3000,
        startPeriodMs: 5000,
        failureThreshold: 3,
      },
      limits: {
        maxMemoryMb: 1024,
        cpuLimitPct: 80,
      },
    };
  },

  syncthing: (service) => {
    const dataDir = path.join(paths.dataDir, 'syncthing');
    if (!fs.existsSync(dataDir)) {
      try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
    }
    const port = service.port || 8384;
    return {
      templateId: 'syncthing',
      appType: 'native',
      executable: 'syncthing.exe',
      args: ['-home', dataDir, '-gui-address', `127.0.0.1:${port}`, '-no-browser', '-no-restart'],
      cwd: paths.rootDir,
      port,
      restartPolicy: 'always',
      healthProbe: {
        type: 'http',
        port,
        path: '/',
        intervalMs: 15000,
        timeoutMs: 4000,
        startPeriodMs: 5000,
        failureThreshold: 3,
      },
      limits: {
        maxMemoryMb: 512,
        cpuLimitPct: 50,
      },
    };
  },
};

/**
 * Resolves a ServiceRecord database entity into a complete, executable ServiceSpec.
 */
export function resolveServiceSpec(
  service: ServiceRecord,
  overrides?: Partial<ServiceSpec>
): ServiceSpec {
  const typeKey = (service.type || '').toLowerCase();
  const recipeGenerator = BUILTIN_RECIPES[typeKey];
  const recipe = recipeGenerator ? recipeGenerator(service) : {};

  // Extract config if stored in DB record
  const config = typeof service.config === 'object' && service.config !== null ? service.config : {};

  const limits: ResourceLimitsSpec = {
    maxMemoryMb: (service as any).maxMemoryMb ?? config.maxMemoryMb ?? recipe.limits?.maxMemoryMb,
    cpuLimitPct: (service as any).cpuLimitPct ?? config.cpuLimitPct ?? recipe.limits?.cpuLimitPct,
  };

  const restartPolicy: RestartPolicy =
    (service as any).restartPolicy || config.restartPolicy || recipe.restartPolicy || 'always';

  const healthProbe: HealthProbeSpec | undefined =
    (service as any).healthProbe || config.healthProbe || recipe.healthProbe;

  const spec: ServiceSpec = {
    id: service.id,
    name: service.name,
    templateId: recipe.templateId || typeKey,
    appType: recipe.appType || 'custom',
    executable: recipe.executable || service.executable,
    args: overrides?.args || recipe.args || [],
    cwd: overrides?.cwd || recipe.cwd || paths.rootDir,
    port: service.port ?? recipe.port ?? null,
    envAllowlist: recipe.envAllowlist,
    env: { ...(recipe.env || {}), ...(overrides?.env || {}) },
    limits,
    restartPolicy,
    healthProbe,
    stopBehavior: overrides?.stopBehavior || recipe.stopBehavior || { timeoutMs: 3000, signal: 'ctrl-break' },
    description: service.description,
    ...overrides,
  };

  return spec;
}
