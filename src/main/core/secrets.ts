import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { logger } from '../logger';

export class SecretsManager {
  private keyFilePath: string;
  private dataKey: Buffer | null = null;

  constructor() {
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
      } catch (e: any) {
        logger.warn('secrets', `Failed to create secrets directory: ${e.message}`);
      }
    }
    this.keyFilePath = path.join(secretsDir, 'master.key');
  }

  public getOrCreateDataKey(): Buffer {
    if (this.dataKey) return this.dataKey;

    if (fs.existsSync(this.keyFilePath)) {
      try {
        const hex = fs.readFileSync(this.keyFilePath, 'utf-8').trim();
        if (hex.length === 64) {
          this.dataKey = Buffer.from(hex, 'hex');
          return this.dataKey;
        }
      } catch (err: any) {
        logger.warn('secrets', `Failed to read existing key file: ${err.message}`);
      }
    }

    // Generate fresh 256-bit cryptographically secure key
    const newKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(this.keyFilePath, newKey.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
      this.dataKey = newKey;
      logger.success('secrets', 'Generated fresh 256-bit master encryption key.');
    } catch (err: any) {
      logger.error('secrets', `Failed to persist master key: ${err.message}`);
      this.dataKey = newKey;
    }

    return this.dataKey;
  }

  public encrypt(plainText: string): string {
    const key = this.getOrCreateDataKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:authTag:cipherHex
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  public decrypt(cipherText: string): string {
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted ciphertext format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const key = this.getOrCreateDataKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  public hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}

export const secretsManager = new SecretsManager();
