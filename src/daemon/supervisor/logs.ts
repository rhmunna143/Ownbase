import fs from 'fs';
import path from 'path';
import { paths } from '../core/paths';
import { eventBus } from '../core/events';
import { LogEntry } from '../../shared/types';
import { logger } from '../core/logger';

export class ServiceLogManager {
  private serviceId: string;
  private serviceName: string;
  private maxRingBufferSize: number;
  private ringBuffer: LogEntry[] = [];
  private logFilePath: string;
  private maxFileSizeBytes: number = 5 * 1024 * 1024; // 5 MB

  constructor(serviceId: string, serviceName: string, maxRingBufferSize: number = 500) {
    this.serviceId = serviceId;
    this.serviceName = serviceName;
    this.maxRingBufferSize = maxRingBufferSize;

    const svcLogDir = path.join(paths.logsDir, 'services');
    if (!fs.existsSync(svcLogDir)) {
      try {
        fs.mkdirSync(svcLogDir, { recursive: true });
      } catch {}
    }
    this.logFilePath = path.join(svcLogDir, `${serviceId}.log`);
  }

  public appendLog(level: 'info' | 'warn' | 'error', message: string): LogEntry {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      level,
      source: this.serviceName,
      message,
      timestamp: new Date().toISOString(),
      serviceId: this.serviceId,
    };

    // Add to in-memory ring buffer
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxRingBufferSize) {
      this.ringBuffer.shift();
    }

    // Persist to service log file asynchronously
    this.persistToFile(entry);

    // Emit on event bus for UI and streaming subscribers
    eventBus.emitEvent({
      type: 'service-log',
      data: {
        serviceId: this.serviceId,
        log: entry,
      },
    });

    return entry;
  }

  public getRecentLogs(): LogEntry[] {
    return [...this.ringBuffer];
  }

  public clear(): void {
    this.ringBuffer = [];
  }

  private persistToFile(entry: LogEntry): void {
    try {
      // Check file size for rotation
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        if (stats.size >= this.maxFileSizeBytes) {
          this.rotateLogFile();
        }
      }

      const logLine = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}\n`;
      fs.appendFileSync(this.logFilePath, logLine, 'utf8');
    } catch (err: any) {
      logger.warn('supervisor', `Failed writing to service log file: ${err.message}`);
    }
  }

  private rotateLogFile(): void {
    try {
      const backupPath = `${this.logFilePath}.1`;
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      fs.renameSync(this.logFilePath, backupPath);
    } catch {}
  }
}
