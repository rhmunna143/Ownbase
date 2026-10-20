import crypto from 'crypto';
import argon2 from 'argon2';
import * as jose from 'jose';
import { PrismaManager } from '../prisma';
import { secretsManager } from '../core/secrets';
import { Role, AuthenticatedUser } from '../../shared/contract/types';
import { logger } from '../logger';

export class AuthService {
  private prismaManager: PrismaManager;
  private jwtSecret: Uint8Array;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
    // Derive a dedicated JWT signing secret from master data key
    const rawKey = secretsManager.getOrCreateDataKey();
    this.jwtSecret = new Uint8Array(crypto.createHmac('sha256', rawKey).update('ownbase_jwt_signing_key_v1').digest());
  }

  /**
   * Hashes a password with Argon2id using recommended parameters (m=64MB, t=3, p=1).
   */
  public async hashPassword(password: string): Promise<string> {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MiB
      timeCost: 3,
      parallelism: 1,
    });
  }

  /**
   * Verifies a password against an Argon2id hash.
   */
  public async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Generates a 15-minute access JWT token.
   */
  public async generateAccessToken(user: { id: string; username: string; role: Role }): Promise<string> {
    return await new jose.SignJWT({
      sub: user.id,
      username: user.username,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(this.jwtSecret);
  }

  /**
   * Verifies and decodes an access JWT token.
   */
  public async verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecret);
      if (!payload.sub || typeof payload.username !== 'string' || typeof payload.role !== 'string') {
        return null;
      }
      return {
        id: payload.sub,
        username: payload.username,
        role: payload.role as Role,
      };
    } catch {
      return null;
    }
  }

  /**
   * Generates a rotating refresh token and saves its hash in the database.
   */
  public async generateRefreshToken(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = secretsManager.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const client = this.prismaManager.getClient();
    await (client as any).refreshToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });

    return rawToken;
  }

  /**
   * Rotates a refresh token with strict reuse detection.
   */
  public async rotateRefreshToken(rawToken: string): Promise<{ accessToken: string; newRefreshToken: string; user: AuthenticatedUser } | null> {
    const tokenHash = secretsManager.hashToken(rawToken);
    const client = this.prismaManager.getClient();

    const record = await (client as any).refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      return null;
    }

    // Reuse detection: If token was already revoked, a breach is suspected!
    if (record.revokedAt) {
      logger.error('auth', `Refresh token reuse detected for user ${record.user.username}! Invalidating all user refresh sessions.`);
      await (client as any).refreshToken.updateMany({
        where: { userId: record.userId },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    if (new Date() > record.expiresAt || !record.user.isActive) {
      return null;
    }

    // Revoke old token
    await (client as any).refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    // Generate new pair
    const user: AuthenticatedUser = {
      id: record.user.id,
      username: record.user.username,
      role: record.user.role as Role,
    };

    const newAccessToken = await this.generateAccessToken(user);
    const newRefreshToken = await this.generateRefreshToken(user.id);

    return {
      accessToken: newAccessToken,
      newRefreshToken,
      user,
    };
  }

  /**
   * Revokes a refresh token (logout).
   */
  public async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = secretsManager.hashToken(rawToken);
    const client = this.prismaManager.getClient();
    await (client as any).refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Generates a 32-byte random secret API key.
   */
  public async createApiKey(userId: string, name: string, role: Role, expiresInDays?: number): Promise<{ apiKey: string; id: string; name: string; prefix: string; role: Role }> {
    const rawSecret = `ownbase_${crypto.randomBytes(24).toString('hex')}`;
    const prefix = rawSecret.slice(0, 16);
    const keyHash = secretsManager.hashToken(rawSecret);

    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    const client = this.prismaManager.getClient();
    const created = await (client as any).apiKey.create({
      data: {
        name,
        keyHash,
        prefix,
        role,
        userId,
        expiresAt,
      },
    });

    return {
      apiKey: rawSecret,
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      role: created.role as Role,
    };
  }

  /**
   * Verifies an API key header.
   */
  public async verifyApiKey(apiKey: string): Promise<AuthenticatedUser | null> {
    if (!apiKey || !apiKey.startsWith('ownbase_')) {
      return null;
    }

    try {
      const client = this.prismaManager.getClient();
      if (!client || !(client as any).apiKey) return null;

      const keyHash = secretsManager.hashToken(apiKey);
      const record = await (client as any).apiKey.findUnique({
        where: { keyHash },
        include: { user: true },
      });

      if (!record || !record.user || !record.user.isActive) {
        return null;
      }

      if (record.expiresAt && new Date() > record.expiresAt) {
        return null;
      }

      // Update lastUsedAt asynchronously
      (client as any).apiKey.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {});

      return {
        id: record.user.id,
        username: record.user.username,
        role: record.role as Role,
        apiKeyId: record.id,
      };
    } catch {
      return null;
    }
  }
}
