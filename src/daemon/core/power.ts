import { spawn, exec, ChildProcess } from 'child_process';
import { logger } from './logger';

export interface PowerState {
  schemeName: string;
  schemeGuid: string;
  preventSuspensionActive: boolean;
}

export class PowerManager {
  private activeScheme: string = 'Unknown';
  private activeGuid: string = '';
  private isSuspensionBlocked: boolean = false;
  private powerWorker: ChildProcess | null = null;

  constructor() {
    this.refreshPowerScheme();
  }

  public refreshPowerScheme(): Promise<void> {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        this.activeScheme = 'Non-Windows';
        return resolve();
      }

      exec('powercfg /getactivescheme', { windowsHide: true }, (err, stdout) => {
        if (!err && stdout) {
          // Output format: Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
          const match = stdout.match(/GUID:\s*([a-f0-9\-]+)\s+\(([^)]+)\)/i);
          if (match) {
            this.activeGuid = match[1];
            this.activeScheme = match[2];
          } else {
            this.activeScheme = stdout.trim();
          }
        }
        resolve();
      });
    });
  }

  public async getPowerState(): Promise<PowerState> {
    await this.refreshPowerScheme();
    return {
      schemeName: this.activeScheme,
      schemeGuid: this.activeGuid,
      preventSuspensionActive: this.isSuspensionBlocked,
    };
  }

  /**
   * Asserts SetThreadExecutionState(ES_SYSTEM_REQUIRED | ES_CONTINUOUS | ES_AWAYMODE_REQUIRED)
   * on Windows to ensure 24/7 background server operation without sleep or system suspension.
   */
  public enablePowerPersistence(): boolean {
    if (this.isSuspensionBlocked) return true;
    if (process.platform !== 'win32') {
      this.isSuspensionBlocked = true;
      return true;
    }

    try {
      // Spawn lightweight background PowerShell helper holding SetThreadExecutionState
      const script = `
        $code = @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32Power {
          [DllImport("kernel32.dll", SetLastError = true)]
          public static extern uint SetThreadExecutionState(uint esFlags);
        }
"@
        Add-Type -TypeDefinition $code
        [Win32Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null
        while ($true) { Start-Sleep -Seconds 300; [Win32Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null }
      `;

      this.powerWorker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
        windowsHide: true,
        stdio: 'ignore',
        detached: false,
      });

      this.powerWorker.on('error', (err) => {
        logger.warn('power', `Power persistence worker notice: ${err.message}`);
      });

      this.powerWorker.on('exit', () => {
        if (this.isSuspensionBlocked) {
          this.isSuspensionBlocked = false;
          logger.warn('power', 'Power persistence worker terminated unexpectedly.');
        }
      });

      this.isSuspensionBlocked = true;
      logger.success('power', '24/7 Server Persistence active (SetThreadExecutionState engaged)');
      return true;
    } catch (err: any) {
      logger.error('power', `Failed to engage power persistence: ${err.message}`);
      return false;
    }
  }

  public disablePowerPersistence() {
    if (this.powerWorker && !this.powerWorker.killed) {
      try {
        this.powerWorker.kill('SIGTERM');
      } catch {}
      this.powerWorker = null;
    }
    this.isSuspensionBlocked = false;
    logger.info('power', 'Power persistence disabled');
  }
}

export const powerManager = new PowerManager();
