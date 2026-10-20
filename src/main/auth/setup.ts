import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { PrismaManager } from '../prisma';
import { AuthService } from './authService';
import { AuditService } from './audit';
import { logger } from '../logger';

export class SetupService {
  private prismaManager: PrismaManager;
  private authService: AuthService;
  private auditService: AuditService;
  private setupTokenFile: string;

  constructor(prismaManager: PrismaManager, authService: AuthService, auditService: AuditService) {
    this.prismaManager = prismaManager;
    this.authService = authService;
    this.auditService = auditService;

    let appData: string;
    try {
      appData = (app && typeof app.getPath === 'function')
        ? app.getPath('userData')
        : path.join(process.env.APPDATA || process.env.USERPROFILE || '.', 'NativeWindowsServerHub');
    } catch {
      appData = path.join(process.env.APPDATA || process.env.USERPROFILE || '.', 'NativeWindowsServerHub');
    }

    const secretsDir = path.join(appData, 'secrets');
    if (!fs.existsSync(secretsDir)) {
      try {
        fs.mkdirSync(secretsDir, { recursive: true });
      } catch { }
    }
    this.setupTokenFile = path.join(secretsDir, 'setup-token.txt');
  }

  public getOrCreateSetupToken(): string {
    if (fs.existsSync(this.setupTokenFile)) {
      try {
        const token = fs.readFileSync(this.setupTokenFile, 'utf-8').trim();
        if (token.length >= 32) return token;
      } catch { }
    }

    const token = crypto.randomBytes(24).toString('hex');
    try {
      fs.writeFileSync(this.setupTokenFile, token, { encoding: 'utf-8', mode: 0o600 });
      logger.info('setup', `Generated initial setup token in ${this.setupTokenFile}`);
    } catch (e: any) {
      logger.warn('setup', `Failed to write setup token file: ${e.message}`);
    }
    return token;
  }

  public async hasRootUser(): Promise<boolean> {
    try {
      const client = this.prismaManager.getClient();
      const count = await (client as any).user.count({
        where: { role: 'ROOT' },
      });
      return count > 0;
    } catch {
      return false;
    }
  }

  public async getStatus(): Promise<{ hasRootUser: boolean }> {
    const hasRoot = await this.hasRootUser();
    return { hasRootUser: hasRoot };
  }

  public async executeSetup(params: {
    username: string;
    password: string;
    isLoopback: boolean;
    setupToken?: string;
    ipAddress?: string;
  }): Promise<{ success: boolean; user?: any; error?: string }> {
    const hasRoot = await this.hasRootUser();
    if (hasRoot) {
      return { success: false, error: 'Initial setup has already been completed. A ROOT user exists.' };
    }

    // Must be either from loopback OR have valid setup token (Decision D8)
    const validToken = this.getOrCreateSetupToken();
    const tokenMatches = params.setupToken && params.setupToken.trim() === validToken.trim();

    if (!params.isLoopback && !tokenMatches) {
      await this.auditService.record({
        action: 'auth.setup',
        status: 'failure',
        ipAddress: params.ipAddress,
        details: { reason: 'Setup rejected: Non-loopback request without valid setup token' },
      });
      return { success: false, error: 'First-run setup is permitted only from loopback (127.0.0.1) or with a valid administrative setup token.' };
    }

    try {
      const passwordHash = await this.authService.hashPassword(params.password);
      const client = this.prismaManager.getClient();

      const user = await (client as any).user.create({
        data: {
          username: params.username,
          passwordHash,
          role: 'ROOT',
          isActive: true,
        },
      });

      // Remove setup token file once root is created
      if (fs.existsSync(this.setupTokenFile)) {
        try {
          fs.unlinkSync(this.setupTokenFile);
        } catch { }
      }

      await this.auditService.record({
        actorId: user.id,
        actorName: user.username,
        action: 'auth.setup',
        entity: 'user',
        entityId: user.id,
        ipAddress: params.ipAddress,
        status: 'success',
        details: { message: 'Initial ROOT administrator provisioned successfully' },
      });

      logger.success('setup', `Initial ROOT administrator '${user.username}' provisioned.`);
      return { success: true, user: { id: user.id, username: user.username, role: user.role } };
    } catch (err: any) {
      return { success: false, error: `Setup failed: ${err.message}` };
    }
  }
}
