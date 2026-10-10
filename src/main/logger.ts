import { BrowserWindow } from 'electron';
import { LogEntry } from '../shared/types';

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs: number = 500;
  private mainWindow: BrowserWindow | null = null;

  setWindow(window: BrowserWindow | null) {
    this.mainWindow = window;
  }

  private log(level: LogEntry['level'], source: LogEntry['source'], message: string) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      level,
      source,
      message,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : level === 'success' ? '\x1b[32m' : '\x1b[36m';
    console.log(`${color}[${entry.timestamp}] [${source.toUpperCase()}] [${level.toUpperCase()}]\x1b[0m ${message}`);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('log-added', entry);
    }
  }

  info(source: LogEntry['source'], message: string) {
    this.log('info', source, message);
  }

  warn(source: LogEntry['source'], message: string) {
    this.log('warn', source, message);
  }

  error(source: LogEntry['source'], message: string) {
    this.log('error', source, message);
  }

  success(source: LogEntry['source'], message: string) {
    this.log('success', source, message);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }
}

export const logger = new Logger();
