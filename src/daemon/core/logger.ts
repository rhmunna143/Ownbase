import fs from 'fs';
import path from 'path';
import { paths } from './paths';
import { eventBus } from './events';
import { LogEntry } from '../../shared/types';

export interface StructuredLog {
  timestamp: string;
  level: LogEntry['level'];
  source: LogEntry['source'];
  message: string;
  metadata?: Record<string, any>;
}

export class Logger {
  private ringBuffer: LogEntry[] = [];
  private maxRingBufferSize = 200;
  private logFilePath: string;
  private maxFileSizeBytes = 10 * 1024 * 1024; // 10 MB
  private maxBackups = 5;

  constructor() {
    this.logFilePath = path.join(paths.logsDir, 'ownbase-daemon.log');
  }

  public redactSecrets(input: string): string {
    if (!input || typeof input !== 'string') return input;

    let redacted = input;

    // 1. Redact JWT tokens (header.payload.signature)
    redacted = redacted.replace(/eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, '[REDACTED_JWT]');

    // 2. Redact Bearer tokens
    redacted = redacted.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]');

    // 3. Redact PostgreSQL connection string passwords
    redacted = redacted.replace(/(postgresql:\/\/[^:]+:)(.*)(@[^/@]+(?::\d+)?(?:[/?]|$))/gi, '$1[REDACTED_DB_PASS]$3');

    // 4. Redact password/token/key JSON fields and key-values
    redacted = redacted.replace(
      /(["']?(?:password|token|secret|apiKey|setupToken|authKey)["']?\s*[:=]\s*["']?)(?!\[REDACTED)([^"',\s\}]+)(["']?)/gi,
      '$1[REDACTED]$3'
    );

    return redacted;
  }

  private writeToFile(line: string) {
    try {
      if (!fs.existsSync(paths.logsDir)) {
        fs.mkdirSync(paths.logsDir, { recursive: true });
      }

      // Check size for rotation
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        if (stats.size >= this.maxFileSizeBytes) {
          this.rotateFiles();
        }
      }

      fs.appendFileSync(this.logFilePath, line + '\n', 'utf-8');
    } catch {
      // Avoid crash on logging error
    }
  }

  private rotateFiles() {
    try {
      for (let i = this.maxBackups - 1; i >= 1; i--) {
        const oldFile = `${this.logFilePath}.${i}`;
        const newFile = `${this.logFilePath}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          if (i === this.maxBackups - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      if (fs.existsSync(this.logFilePath)) {
        fs.renameSync(this.logFilePath, `${this.logFilePath}.1`);
      }
    } catch {}
  }

  private log(level: LogEntry['level'], source: LogEntry['source'], rawMessage: string, metadata?: Record<string, any>) {
    const cleanMessage = this.redactSecrets(rawMessage);
    const timestamp = new Date().toISOString();

    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      level,
      source,
      message: cleanMessage,
      timestamp,
    };

    // Update ring buffer (capped)
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxRingBufferSize) {
      this.ringBuffer.shift();
    }

    // Structured JSON record
    const structured: StructuredLog = {
      timestamp,
      level,
      source,
      message: cleanMessage,
      ...(metadata ? { metadata } : {}),
    };

    // Append to rotating log file as JSON
    this.writeToFile(JSON.stringify(structured));

    // Console output with color formatting
    const color =
      level === 'error'
        ? '\x1b[31m'
        : level === 'warn'
        ? '\x1b[33m'
        : level === 'success'
        ? '\x1b[32m'
        : '\x1b[36m';
    console.log(`${color}[${timestamp}] [${source.toUpperCase()}] [${level.toUpperCase()}]\x1b[0m ${cleanMessage}`);

    // Emit event on event bus for UI and SSE subscribers
    eventBus.emitEvent({
      type: 'log',
      data: entry,
    });
  }

  public info(source: LogEntry['source'], message: string, metadata?: Record<string, any>) {
    this.log('info', source, message, metadata);
  }

  public warn(source: LogEntry['source'], message: string, metadata?: Record<string, any>) {
    this.log('warn', source, message, metadata);
  }

  public error(source: LogEntry['source'], message: string, metadata?: Record<string, any>) {
    this.log('error', source, message, metadata);
  }

  public success(source: LogEntry['source'], message: string, metadata?: Record<string, any>) {
    this.log('success', source, message, metadata);
  }

  public debug(source: LogEntry['source'], message: string, metadata?: Record<string, any>) {
    this.log('info', source, `[DEBUG] ${message}`, metadata);
  }

  public getLogs(): LogEntry[] {
    return [...this.ringBuffer];
  }
}

export const logger = new Logger();
