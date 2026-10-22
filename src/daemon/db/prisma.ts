import { PrismaClient } from '@prisma/client';
import { logger } from '../core/logger';
import { secretsManager } from '../core/secrets';
import { migrationRunner, MigrationRunner } from './migrate';
import { MigrationStatus, ServiceRecord, RouteRecord } from '../../shared/types';

export class PrismaManager {
  private client: PrismaClient | null = null;
  private databaseUrl: string;
  private runner: MigrationRunner;

  constructor(port = 5432, dbName = 'postgres', runner: MigrationRunner = migrationRunner) {
    this.runner = runner;
    const password = secretsManager.getOrCreatePostgresPassword();
    // Support authenticated postgresql URL with fallback if not yet set
    this.databaseUrl = password
      ? `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/${dbName}?schema=public`
      : `postgresql://postgres@127.0.0.1:${port}/${dbName}?schema=public`;
    process.env.DATABASE_URL = this.databaseUrl;
  }

  public getDatabaseUrl(): string {
    return this.databaseUrl;
  }

  public setDatabaseUrl(url: string) {
    this.databaseUrl = url;
    process.env.DATABASE_URL = url;
    if (this.client) {
      this.client.$disconnect().catch(() => {});
      this.client = null;
    }
  }

  public getStatus(): MigrationStatus {
    return this.runner.getStatus();
  }

  public getClient(): PrismaClient {
    if (!this.client) {
      this.client = new PrismaClient({
        datasources: {
          db: {
            url: this.databaseUrl,
          },
        },
      });
    }
    return this.client;
  }

  /**
   * Deploys database migrations strictly without `db push` fallback (P11).
   */
  public async runMigrations(): Promise<boolean> {
    const result = await this.runner.runMigrations(this.databaseUrl);

    if (result.success) {
      try {
        await this.seedInitialServices();
      } catch (seedErr: any) {
        logger.warn('prisma', `Seeding notice: ${seedErr.message}`);
      }
      return true;
    }

    // If connection with password failed on existing cluster, test with default local postgres
    if (this.databaseUrl.includes(':')) {
      logger.warn('prisma', 'Migration with generated password failed. Attempting with local default connection...');
      const fallbackUrl = `postgresql://postgres@127.0.0.1:5432/postgres?schema=public`;
      const fallbackRes = await this.runner.runMigrations(fallbackUrl);
      if (fallbackRes.success) {
        this.setDatabaseUrl(fallbackUrl);
        try {
          await this.seedInitialServices();
        } catch {}
        return true;
      }
    }

    return false;
  }

  public async ping(): Promise<{ success: boolean; latencyMs: number; time?: string; error?: string }> {
    const start = Date.now();
    try {
      const client = this.getClient();
      const result = await client.$queryRaw<{ current_time: Date }[]>`SELECT NOW() as current_time`;
      const latencyMs = Date.now() - start;
      const time = result[0]?.current_time?.toISOString() || new Date().toISOString();
      return { success: true, latencyMs, time };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  public async seedInitialServices() {
    const client = this.getClient();
    const count = await client.service.count();
    if (count === 0) {
      logger.info('prisma', 'Seeding default services (Ownbase, Caddy, FileBrowser, Ollama)...');

      // Seed Ownbase Web Hub
      try {
        await client.service.create({
          data: {
            name: 'Ownbase Web Hub',
            type: 'ownbase',
            executable: 'node.exe',
            port: 3001,
            status: 'running',
            autoStart: true,
            description: 'Central server management portal and web dashboard',
            routes: {
              create: {
                subdomain: 'hub',
                targetPort: 3001,
                tlsEnabled: true,
              },
            },
          },
        });
      } catch {}

      // Seed Caddy
      try {
        await client.service.create({
          data: {
            name: 'Caddy Reverse Proxy',
            type: 'caddy',
            executable: 'caddy.exe',
            port: 2019,
            status: 'stopped',
            autoStart: true,
            description: 'Dynamic reverse proxy & automatic TLS termination gateway',
            config: { adminApi: '127.0.0.1:2019', httpPort: 80, httpsPort: 443 },
          },
        });
      } catch {}

      // Seed FileBrowser
      try {
        await client.service.create({
          data: {
            name: 'FileBrowser Storage',
            type: 'filebrowser',
            executable: 'filebrowser.exe',
            port: 8080,
            status: 'stopped',
            autoStart: true,
            description: 'High-performance native file manager & cloud drive',
            config: { root: 'C:\\ServerStorage', address: '127.0.0.1' },
            routes: {
              create: {
                subdomain: 'files',
                targetPort: 8080,
                tlsEnabled: true,
              },
            },
          },
        });
      } catch {}

      // Seed Ollama
      try {
        await client.service.create({
          data: {
            name: 'Ollama AI Engine',
            type: 'ollama',
            executable: 'ollama.exe',
            port: 11434,
            status: 'stopped',
            autoStart: false,
            description: 'Local LLM inference server (Hermes & Llama3 models)',
            config: { modelsDir: 'C:\\OllamaModels' },
            routes: {
              create: {
                subdomain: 'ai',
                targetPort: 11434,
                tlsEnabled: true,
              },
            },
          },
        });
      } catch {}

      logger.success('prisma', 'Initial services and routes seeded into PostgreSQL.');
    }

    // Ensure core services and routes exist even if database was initialized previously
    const defaultServices = [
      {
        name: 'Ownbase Web Hub',
        type: 'ownbase',
        executable: 'node.exe',
        port: 3001,
        autoStart: true,
        description: 'Central server management portal and web dashboard',
        subdomain: 'hub',
      },
      {
        name: 'Web Terminal',
        type: 'terminal',
        executable: 'terminal.exe',
        port: 7681,
        autoStart: true,
        description: 'Interactive browser terminal with PowerShell & CMD access',
        subdomain: 'terminal',
      },
      {
        name: 'S3-Compatible Object Storage',
        type: 'minio',
        executable: 'minio.exe',
        port: 9000,
        autoStart: true,
        description: 'High-performance S3-compatible object storage server with Web Console',
        subdomain: 's3',
      },
      {
        name: 'Syncthing Device Sync',
        type: 'syncthing',
        executable: 'syncthing.exe',
        port: 8384,
        autoStart: false,
        description: 'Continuous peer-to-peer file synchronization and backup between devices',
        subdomain: 'syncthing',
      },
    ];

    for (const def of defaultServices) {
      const existing = await client.service.findFirst({ where: { type: def.type } });
      if (!existing) {
        await client.service.create({
          data: {
            name: def.name,
            type: def.type,
            executable: def.executable,
            port: def.port,
            status: 'stopped',
            autoStart: def.autoStart,
            description: def.description,
            routes: {
              create: {
                subdomain: def.subdomain,
                targetPort: def.port,
                tlsEnabled: true,
              },
            },
          },
        });
      } else {
        const existingRoute = await client.route.findFirst({ where: { subdomain: def.subdomain } });
        if (!existingRoute) {
          await client.route.create({
            data: {
              serviceId: existing.id,
              subdomain: def.subdomain,
              targetPort: def.port,
              tlsEnabled: true,
            },
          });
        }
      }
    }
  }

  public async getServices(): Promise<ServiceRecord[]> {
    const client = this.getClient();
    let services = await client.service.findMany({
      include: { routes: true },
      orderBy: { createdAt: 'asc' },
    });
    if (services.length === 0) {
      try {
        await this.seedInitialServices();
        services = await client.service.findMany({
          include: { routes: true },
          orderBy: { createdAt: 'asc' },
        });
      } catch {}
    }
    return services.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      routes: s.routes.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    }));
  }

  public async createService(data: {
    name: string;
    type: string;
    executable: string;
    port?: number;
    description?: string;
    autoStart?: boolean;
  }): Promise<ServiceRecord> {
    const client = this.getClient();
    const service = await client.service.create({
      data: {
        name: data.name,
        type: data.type,
        executable: data.executable,
        port: data.port,
        description: data.description,
        autoStart: data.autoStart ?? true,
        status: 'stopped',
      },
      include: { routes: true },
    });
    return {
      ...service,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
      routes: [],
    };
  }

  public async deleteService(id: string): Promise<boolean> {
    const client = this.getClient();
    await client.route.deleteMany({ where: { serviceId: id } }).catch(() => {});
    await client.service.delete({ where: { id } });
    return true;
  }

  public async getRoutes(): Promise<RouteRecord[]> {
    const client = this.getClient();
    const routes = await client.route.findMany({
      include: {
        service: {
          select: { name: true, type: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return routes.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  public async createRoute(data: {
    serviceId: string;
    subdomain: string;
    targetPort: number;
    tlsEnabled?: boolean;
    customDomain?: string;
  }): Promise<RouteRecord> {
    const client = this.getClient();
    const route = await client.route.create({
      data: {
        serviceId: data.serviceId,
        subdomain: data.subdomain,
        targetPort: data.targetPort,
        tlsEnabled: data.tlsEnabled ?? true,
        customDomain: data.customDomain,
      },
      include: {
        service: {
          select: { name: true, type: true },
        },
      },
    });
    return {
      ...route,
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString(),
    };
  }

  public async deleteRoute(routeId: string): Promise<boolean> {
    const client = this.getClient();
    await client.route.delete({
      where: { id: routeId },
    });
    return true;
  }

  public async disconnect() {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
      logger.info('prisma', 'Prisma client disconnected.');
    }
  }
}

export const prismaManager = new PrismaManager();
