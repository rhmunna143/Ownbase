import crypto from 'crypto';
import argon2 from 'argon2';
import * as jose from 'jose';
import { PrismaManager } from '../db/prisma';
import { secretsManager } from '../core/secrets';
import { Role, AuthenticatedUser } from '../../shared/contract/types';
import { logger } from '../core/logger';

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
      if (!payload.sub || !payload.role) return null;
      return {
        id: payload.sub as string,
        username: (payload.username as string) || 'unknown',
        role: payload.role as Role,
      };
    } catch {
      return null;
    }
  }

  /**
   * Generates a rotating refresh token (random 32 bytes hex, 30 days expiry).
   */
  public async generateRefreshToken(userId: string): Promise<{ token: string }> {
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

    return { token: rawToken };
  }

  /**
   * Rotates a refresh token with reuse detection.
   * If a revoked or already used token is presented, all user refresh tokens are revoked.
   */
  public async rotateRefreshToken(rawToken: string): Promise<{ user: AuthenticatedUser; accessToken: string; newRefreshToken: string } | null> {
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
      logger.warn('auth', `Refresh token reuse detected for user ${record.userId}! Invalidating all refresh sessions.`);
      await (client as any).refreshToken.updateMany({
        where: { userId: record.userId },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    // Check expiry
    if (new Date() > new Date(record.expiresAt)) {
      await (client as any).refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    // Revoke old token
    await (client as any).refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    // Check if user is still active
    if (!record.user.isActive) {
      return null;
    }

    const authUser: AuthenticatedUser = {
      id: record.user.id,
      username: record.user.username,
      role: record.user.role as Role,
    };

    // Issue new access and refresh tokens
    const accessToken = await this.generateAccessToken(authUser);
    const { token: newRefreshToken } = await this.generateRefreshToken(record.userId);

    return {
      user: authUser,
      accessToken,
      newRefreshToken,
    };
  }

  /**
   * Generates a new API Key with a name and given role.
   * Format: ownbase_api_<hex32>
   */
  public async createApiKey(
    userId: string,
    name: string,
    role: Role,
    expiresInDays?: number
  ): Promise<{ apiKey: string; keyRecord: any }> {
    const rawEntropy = crypto.randomBytes(32).toString('hex');
    const rawKey = `ownbase_api_${rawEntropy}`;
    const keyHash = secretsManager.hashToken(rawKey);
    const prefix = rawKey.substring(0, 16);

    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    const client = this.prismaManager.getClient();
    const keyRecord = await (client as any).apiKey.create({
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
      apiKey: rawKey,
      keyRecord: {
        id: keyRecord.id,
        name: keyRecord.name,
        prefix: keyRecord.prefix,
        role: keyRecord.role,
        createdAt: keyRecord.createdAt,
        expiresAt: keyRecord.expiresAt,
      },
    };
  }

  /**
   * Verifies an incoming API Key.
   */
  public async verifyApiKey(rawKey: string): Promise<AuthenticatedUser | null> {
    if (!rawKey || !rawKey.startsWith('ownbase_')) return null;

    const keyHash = secretsManager.hashToken(rawKey);
    const client = this.prismaManager.getClient();
    if (!client || !(client as any).apiKey) return null;

    const record = await (client as any).apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!record || !record.user || !record.user.isActive) return null;

    if (record.expiresAt && new Date() > new Date(record.expiresAt)) {
      return null;
    }

    // Touch lastUsedAt asynchronously
    (client as any).apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    return {
      id: record.user.id,
      username: record.user.username,
      role: record.role as Role,
    };
  }

  /**
   * Revokes all refresh tokens for a user (e.g. on logout or password change).
   */
  public async revokeAllUserTokens(userId: string): Promise<void> {
    const client = this.prismaManager.getClient();
    await (client as any).refreshToken.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });
  }
}
