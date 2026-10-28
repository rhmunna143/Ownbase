import crypto from 'crypto';
import { hash as argonHash, verify as argonVerify, Algorithm as ArgonAlgorithm } from '@node-rs/argon2';
import { PrismaManager } from '../prisma';
import { secretsManager } from '../core/secrets';
import { Role, AuthenticatedUser } from '../../shared/contract/types';
import { logger } from '../logger';

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) {
    s += '=';
  }
  return Buffer.from(s, 'base64').toString('utf8');
}

export class AuthService {
  private prismaManager: PrismaManager;
  private jwtSecret: Buffer;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
    // Derive a dedicated JWT signing secret from master data key
    const rawKey = secretsManager.getOrCreateDataKey();
    this.jwtSecret = crypto.createHmac('sha256', rawKey).update('ownbase_jwt_signing_key_v1').digest();
  }

  /**
   * Hashes a password with Argon2id using recommended parameters (m=64MB, t=3, p=1).
   */
  public async hashPassword(password: string): Promise<string> {
    return await argonHash(password, {
      algorithm: ArgonAlgorithm.Argon2id,
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
      return await argonVerify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Generates a 15-minute access JWT token using native HS256 HMAC.
   */
  public async generateAccessToken(user: { id: string; username: string; role: Role }): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: now,
      exp: now + 15 * 60, // 15 minutes
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(signatureInput)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${signatureInput}.${signature}`;
  }

  /**
   * Verifies and decodes an access JWT token using native HS256 HMAC with timingSafeEqual.
   */
  public async verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    try {
      if (!token || typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [encodedHeader, encodedPayload, signature] = parts;
      const signatureInput = `${encodedHeader}.${encodedPayload}`;

      const expectedSignature = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(signatureInput)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      if (signature.length !== expectedSignature.length) return null;
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);
      if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

      const payload = JSON.parse(base64UrlDecode(encodedPayload));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return null; // Expired
      }
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
