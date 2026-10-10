import { exec } from 'child_process';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { MigrationStatus, ServiceRecord, RouteRecord } from '../shared/types';

export class PrismaManager {
  private client: PrismaClient | null = null;
  private databaseUrl: string;
  private status: MigrationStatus = { state: 'idle' };

  constructor(port = 5432, dbName = 'postgres') {
    this.databaseUrl = `postgresql://postgres@127.0.0.1:${port}/${dbName}?schema=public`;
    process.env.DATABASE_URL = this.databaseUrl;
  }

  public getStatus(): MigrationStatus {
    return { ...this.status };
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

  public async runMigrations(): Promise<boolean> {
    this.status = { state: 'running' };
    logger.info('prisma', `Initiating database migrations with URL: ${this.databaseUrl}`);

    const projectRoot = process.cwd();
    const isWindows = process.platform === 'win32';
    // Use npx prisma migrate deploy as required in PRD
    const cmd = isWindows ? 'npx.cmd prisma migrate deploy' : 'npx prisma migrate deploy';

    return new Promise((resolve, reject) => {
      logger.info('prisma', `Executing: ${cmd}`);
      
      const child = exec(cmd, {
        cwd: projectRoot,
        env: {
          ...process.env,
          DATABASE_URL: this.databaseUrl,
        },
      });

      let stdoutData = '';
      let stderrData = '';

      child.stdout?.on('data', (data) => {
        const text = data.toString();
        stdoutData += text;
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          logger.info('prisma', line);
        }
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString();
        stderrData += text;
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          logger.warn('prisma', line);
        }
      });

      child.on('exit', async (code) => {
        if (code === 0) {
          logger.success('prisma', 'All Prisma database migrations deployed successfully.');
          this.status = {
            state: 'applied',
            appliedAt: new Date().toISOString(),
          };

          // Initialize client and seed defaults if empty
          try {
            await this.seedInitialServices();
          } catch (seedErr: any) {
            logger.warn('prisma', `Seeding notice: ${seedErr.message}`);
          }

          resolve(true);
        } else {
          // If migrate deploy reported no migrations or fallback is needed, fallback to db push
          logger.warn('prisma', `migrate deploy exited with code ${code}. Trying programmatic db push fallback...`);
          const pushCmd = isWindows ? 'npx.cmd prisma db push --skip-generate' : 'npx prisma db push --skip-generate';
          exec(pushCmd, { cwd: projectRoot, env: { ...process.env, DATABASE_URL: this.databaseUrl } }, async (pushErr) => {
            if (pushErr) {
              const errMsg = `Migration failed: ${stderrData || pushErr.message}`;
              logger.error('prisma', errMsg);
              this.status = { state: 'error', error: errMsg };
              return reject(new Error(errMsg));
            }
            logger.success('prisma', 'Prisma schema synchronized with database.');
            this.status = { state: 'applied', appliedAt: new Date().toISOString() };
            try {
              await this.seedInitialServices();
            } catch (seedErr: any) {
              logger.warn('prisma', `Seeding notice: ${seedErr.message}`);
            }
            resolve(true);
          });
        }
      });

      child.on('error', (err) => {
        logger.error('prisma', `Failed to execute migration command: ${err.message}`);
        this.status = { state: 'error', error: err.message };
        reject(err);
      });
    });
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

  private async seedInitialServices() {
    const client = this.getClient();
    const count = await client.service.count();
    if (count === 0) {
      logger.info('prisma', 'Seeding default services (Caddy, FileBrowser, Ollama)...');

      // Seed Caddy
      const caddy = await client.service.create({
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

      // Seed FileBrowser
      const filebrowser = await client.service.create({
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

      // Seed Ollama
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

      logger.success('prisma', 'Initial services and routes seeded into PostgreSQL.');
    }
  }

  public async getServices(): Promise<ServiceRecord[]> {
    const client = this.getClient();
    const services = await client.service.findMany({
      include: { routes: true },
      orderBy: { createdAt: 'asc' },
    });
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

  public async disconnect() {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
      logger.info('prisma', 'Prisma client disconnected.');
    }
  }
}
