import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { paths } from './paths';
import { logger } from './logger';

export const ConfigSchema = z.object({
  version: z.number().default(1),
  bindAddress: z.string().default('127.0.0.1'),
  ports: z.object({
    daemon: z.number().int().min(1024).max(65535).default(3001),
    postgres: z.number().int().min(1024).max(65535).default(5432),
    caddyAdmin: z.number().int().min(1024).max(65535).default(2019),
    caddyHttp: z.number().int().min(1).max(65535).default(80),
    caddyHttps: z.number().int().min(1).max(65535).default(443),
  }).default({
    daemon: 3001,
    postgres: 5432,
    caddyAdmin: 2019,
    caddyHttp: 80,
    caddyHttps: 443,
  }),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  hostnames: z.object({
    localDomain: z.string().default('localhost'),
    lanIp: z.string().optional(),
    meshDomain: z.string().optional(),
  }).default({
    localDomain: 'localhost',
  }),
  corsOrigins: z.array(z.string()).default([
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
  ]),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export class ConfigManager {
  private config: AppConfig;
  private configFilePath: string;

  constructor(customPath?: string) {
    this.configFilePath = customPath || paths.configPath;
    this.config = this.loadConfig();
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public loadConfig(): AppConfig {
    const defaults = ConfigSchema.parse({});

    if (!fs.existsSync(this.configFilePath)) {
      try {
        const dir = path.dirname(this.configFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.configFilePath, JSON.stringify(defaults, null, 2), 'utf-8');
        logger.info('config', `Generated default configuration at ${this.configFilePath}`);
      } catch (err: any) {
        logger.warn('config', `Failed to write default config file: ${err.message}`);
      }
      return defaults;
    }

    try {
      const content = fs.readFileSync(this.configFilePath, 'utf-8');
      const json = JSON.parse(content);
      const parsed = ConfigSchema.safeParse(json);

      if (!parsed.success) {
        logger.error('config', `Configuration validation error: ${parsed.error.message}`);
        return defaults;
      }

      this.config = parsed.data;
      return this.config;
    } catch (err: any) {
      logger.error('config', `Failed to read configuration: ${err.message}. Using defaults.`);
      return defaults;
    }
  }

  public updateConfig(partial: Partial<AppConfig>): AppConfig {
    const updated = ConfigSchema.parse({ ...this.config, ...partial });
    try {
      fs.writeFileSync(this.configFilePath, JSON.stringify(updated, null, 2), 'utf-8');
      this.config = updated;
      logger.info('config', 'Configuration updated successfully');
    } catch (err: any) {
      logger.error('config', `Failed to persist configuration update: ${err.message}`);
    }
    return this.config;
  }
}

export const configManager = new ConfigManager();
export const config = configManager.getConfig();
