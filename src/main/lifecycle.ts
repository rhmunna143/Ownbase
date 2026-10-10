import type { BrowserWindow, NativeImage, Tray as TrayType } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';
import { PrismaManager } from './prisma';
import { LifecycleStatus } from '../shared/types';

const FALLBACK_TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPElEQVR4nGNgoBZITvv4nxSM1QB+cS2iMF4DLPb+wIpBckpH4wgbQJEL3EMzicKjYTC8w4BiAyjKTOQCAG07TdVhsDsMAAAAAElFTkSuQmCC';

function getElectron(): any {
  try {
    const mod = require('electron');
    if (mod && typeof mod !== 'string' && mod.app) {
      return mod;
    }
  } catch {
    // plain Node.js environment
  }
  return null;
}

export class LifecycleManager {
  private prismaManager: PrismaManager;
  private window: BrowserWindow | null = null;
  private tray: TrayType | null = null;
  private powerBlockerId: number | null = null;
  private isQuitting: boolean = false;
  private mockAutoStart = { openAtLogin: false, openAsHidden: false };

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
  }

  public setWindow(window: BrowserWindow) {
    this.window = window;
    this.interceptWindowClose();
    this.createTray();
  }

  public getIsQuitting(): boolean {
    return this.isQuitting;
  }

  public setIsQuitting(val: boolean) {
    this.isQuitting = val;
  }

  /**
   * Initializes 24/7 power save blocker & boot auto-start preferences from database.
   */
  public async bootstrap(): Promise<void> {
    logger.info('system', 'Initializing 24/7 Server Lifecycle & Power overrides...');

    // 1. Enable 24/7 power suspension blocker by default (or from DB setting)
    try {
      const client = this.prismaManager.getClient();
      const cfg = await client.systemConfig.findUnique({
        where: { key: 'prevent_app_suspension' },
      });

      // Default to true for 24/7 server behavior unless explicitly disabled
      const shouldBlock = cfg ? cfg.value === 'true' : true;
      if (shouldBlock) {
        this.enablePowerSaveBlocker();
      }
    } catch {
      // Fallback: start blocker anyway for 24/7 server integrity
      this.enablePowerSaveBlocker();
    }

    // 2. Check startup registry settings
    const autoStart = this.getAutoStart();
    logger.info(
      'system',
      `Windows Auto-Launch at Boot: ${autoStart.openAtLogin ? 'ENABLED (Silent)' : 'DISABLED'}`
    );
  }

  /**
   * Intercept standard window close event to hide to tray instead of quitting.
   */
  private interceptWindowClose() {
    if (!this.window) return;

    this.window.on('close', (event: any) => {
      if (!this.isQuitting) {
        event.preventDefault();
        logger.info('system', 'Window close intercepted. Minimizing to Windows system tray.');
        this.window?.hide();
        this.updateTrayMenu();

        const electron = getElectron();
        if (this.tray && process.platform === 'win32' && electron) {
          try {
            (this.tray as any).displayBalloon({
              title: 'Native Windows Server Hub',
              content: 'The server is still actively running in the background.',
              iconType: 'info',
            });
          } catch {}
        }
      }
    });
  }

  /**
   * Builds the native system tray icon and context menu.
   */
  private createTray() {
    if (this.tray) return;

    const electron = getElectron();
    if (!electron || !electron.Tray) {
      logger.info('system', 'System tray initialized in headless/testing mode.');
      return;
    }

    let icon: NativeImage | null = null;
    const candidatePaths = [
      path.join(process.cwd(), 'assets', 'tray-icon.png'),
      path.join(__dirname, '..', '..', 'assets', 'tray-icon.png'),
      path.join((process as any).resourcesPath || '', 'assets', 'tray-icon.png'),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        icon = electron.nativeImage.createFromPath(p);
        break;
      }
    }

    if (!icon || icon.isEmpty()) {
      icon = electron.nativeImage.createFromDataURL(FALLBACK_TRAY_ICON_DATA_URL);
    }

    const trayInstance = new electron.Tray(icon);
    trayInstance.setToolTip('Native Windows Server Hub (24/7 Persistent Server)');

    // Toggle window on tray click
    trayInstance.on('click', () => {
      this.toggleWindow();
    });

    trayInstance.on('double-click', () => {
      this.restoreWindow();
    });

    this.tray = trayInstance;
    this.updateTrayMenu();
    logger.info('system', 'System tray icon registered in Windows notification area.');
  }

  public updateTrayMenu() {
    if (!this.tray) return;

    const electron = getElectron();
    if (!electron || !electron.Menu) return;

    const isWindowVisible = this.window ? this.window.isVisible() : false;
    const isPowerBlocked = this.isPowerBlockerActive();
    const isAutoStart = this.getAutoStart().openAtLogin;

    const contextMenu = electron.Menu.buildFromTemplate([
      {
        label: 'Native Windows Server Hub',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: isWindowVisible ? 'Hide to System Tray' : 'Open Dashboard',
        click: () => this.toggleWindow(),
      },
      { type: 'separator' },
      {
        label: `Power Suspension Blocker: ${isPowerBlocked ? 'Active (24/7)' : 'Disabled'}`,
        type: 'checkbox',
        checked: isPowerBlocked,
        click: async () => {
          await this.setPowerSaveBlocker(!isPowerBlocked);
          this.updateTrayMenu();
        },
      },
      {
        label: `Launch on Windows Boot: ${isAutoStart ? 'Enabled' : 'Disabled'}`,
        type: 'checkbox',
        checked: isAutoStart,
        click: async () => {
          await this.setAutoStart(!isAutoStart, true);
          this.updateTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Server Hub',
        click: () => this.quitApp(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public toggleWindow() {
    if (!this.window) return;
    if (this.window.isVisible()) {
      this.window.hide();
    } else {
      this.restoreWindow();
    }
    this.updateTrayMenu();
  }

  public restoreWindow() {
    if (!this.window) return;
    this.window.show();
    if (this.window.isMinimized()) {
      this.window.restore();
    }
    this.window.focus();
    this.updateTrayMenu();
  }

  public minimizeToTray() {
    if (!this.window) return;
    this.window.hide();
    this.updateTrayMenu();
  }

  public quitApp() {
    logger.info('system', 'Explicit quit requested via lifecycle manager.');
    this.isQuitting = true;
    const electron = getElectron();
    if (electron && electron.app?.quit) {
      electron.app.quit();
    }
  }

  // --- Windows Startup Registry (app.setLoginItemSettings) ---

  public getAutoStart(): { openAtLogin: boolean; openAsHidden: boolean } {
    try {
      const electron = getElectron();
      if (electron && electron.app?.getLoginItemSettings) {
        const settings = electron.app.getLoginItemSettings();
        return {
          openAtLogin: settings.openAtLogin,
          openAsHidden: settings.openAsHidden,
        };
      }
      return this.mockAutoStart;
    } catch {
      return this.mockAutoStart;
    }
  }

  public async setAutoStart(
    enabled: boolean,
    openAsHidden = true
  ): Promise<{ success: boolean; autoStart: { enabled: boolean; openAsHidden: boolean } }> {
    try {
      logger.info(
        'system',
        `Configuring Windows Login Item Settings: openAtLogin=${enabled}, openAsHidden=${openAsHidden}`
      );

      this.mockAutoStart = { openAtLogin: enabled, openAsHidden };

      const electron = getElectron();
      if (electron && electron.app?.setLoginItemSettings) {
        electron.app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: openAsHidden,
          path: process.execPath,
          args: openAsHidden ? ['--hidden'] : [],
        });
      }

      // Persist to PostgreSQL system_configs
      try {
        const client = this.prismaManager.getClient();
        await client.systemConfig.upsert({
          where: { key: 'auto_start_at_boot' },
          create: {
            key: 'auto_start_at_boot',
            value: enabled ? 'true' : 'false',
            category: 'lifecycle',
          },
          update: { value: enabled ? 'true' : 'false' },
        });
      } catch (dbErr: any) {
        logger.warn('system', `Notice updating DB auto_start_at_boot: ${dbErr.message}`);
      }

      const current = this.getAutoStart();
      this.updateTrayMenu();
      return {
        success: true,
        autoStart: { enabled: current.openAtLogin, openAsHidden: current.openAsHidden },
      };
    } catch (err: any) {
      logger.error('system', `Failed to set login item settings: ${err.message}`);
      return {
        success: false,
        autoStart: { enabled: false, openAsHidden: false },
      };
    }
  }

  // --- Power State Overrides (powerSaveBlocker) ---

  public isPowerBlockerActive(): boolean {
    if (this.powerBlockerId === null) return false;
    const electron = getElectron();
    if (electron && electron.powerSaveBlocker) {
      return electron.powerSaveBlocker.isStarted(this.powerBlockerId);
    }
    return true;
  }

  public enablePowerSaveBlocker(): number {
    if (this.isPowerBlockerActive()) {
      return this.powerBlockerId!;
    }

    const electron = getElectron();
    if (electron && electron.powerSaveBlocker) {
      this.powerBlockerId = electron.powerSaveBlocker.start('prevent-app-suspension');
    } else {
      this.powerBlockerId = (this.powerBlockerId || 100) + 1;
    }

    logger.success(
      'system',
      `PowerSaveBlocker started (ID: ${this.powerBlockerId}, type: 'prevent-app-suspension') for 24/7 server uptime.`
    );
    this.updateTrayMenu();
    return this.powerBlockerId!;
  }

  public disablePowerSaveBlocker(): boolean {
    if (this.powerBlockerId !== null) {
      const electron = getElectron();
      if (electron && electron.powerSaveBlocker && electron.powerSaveBlocker.isStarted(this.powerBlockerId)) {
        electron.powerSaveBlocker.stop(this.powerBlockerId);
      }
      logger.info('system', `PowerSaveBlocker stopped (ID: ${this.powerBlockerId}).`);
      this.powerBlockerId = null;
      this.updateTrayMenu();
      return true;
    }
    return false;
  }

  public async setPowerSaveBlocker(
    enabled: boolean
  ): Promise<{
    success: boolean;
    powerBlocker: { active: boolean; blockerId: number | null; type: 'prevent-app-suspension' };
  }> {
    try {
      if (enabled) {
        this.enablePowerSaveBlocker();
      } else {
        this.disablePowerSaveBlocker();
      }

      // Persist to PostgreSQL system_configs
      try {
        const client = this.prismaManager.getClient();
        await client.systemConfig.upsert({
          where: { key: 'prevent_app_suspension' },
          create: {
            key: 'prevent_app_suspension',
            value: enabled ? 'true' : 'false',
            category: 'lifecycle',
          },
          update: { value: enabled ? 'true' : 'false' },
        });
      } catch (dbErr: any) {
        logger.warn('system', `Notice updating DB prevent_app_suspension: ${dbErr.message}`);
      }

      return {
        success: true,
        powerBlocker: {
          active: this.isPowerBlockerActive(),
          blockerId: this.powerBlockerId,
          type: 'prevent-app-suspension',
        },
      };
    } catch (err: any) {
      logger.error('system', `Failed to toggle power save blocker: ${err.message}`);
      return {
        success: false,
        powerBlocker: {
          active: this.isPowerBlockerActive(),
          blockerId: this.powerBlockerId,
          type: 'prevent-app-suspension',
        },
      };
    }
  }

  public getStatus(): LifecycleStatus {
    const isWindowVisible = this.window ? this.window.isVisible() : false;
    const auto = this.getAutoStart();
    return {
      trayActive: !!this.tray,
      isMinimizedToTray: !isWindowVisible,
      powerBlocker: {
        active: this.isPowerBlockerActive(),
        blockerId: this.powerBlockerId,
        type: 'prevent-app-suspension',
      },
      autoStart: {
        enabled: auto.openAtLogin,
        openAsHidden: auto.openAsHidden,
      },
    };
  }

  public destroy() {
    if (this.tray) {
      try {
        this.tray.destroy();
      } catch {}
      this.tray = null;
    }
    if (this.powerBlockerId !== null) {
      const electron = getElectron();
      if (electron && electron.powerSaveBlocker && electron.powerSaveBlocker.isStarted(this.powerBlockerId)) {
        electron.powerSaveBlocker.stop(this.powerBlockerId);
      }
      this.powerBlockerId = null;
    }
  }
}
