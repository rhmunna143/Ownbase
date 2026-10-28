import path from 'path';
import fs from 'fs';
import os from 'os';

export type OperationalMode = 'service' | 'portable' | 'dev';

export interface AppPaths {
  mode: OperationalMode;
  rootDir: string;
  dataDir: string;
  logsDir: string;
  runtimesDir: string;
  appsDir: string;
  releasesDir: string;
  backupsDir: string;
  postgresDir: string;
  storageDir: string;
  secretsDir: string;
  caddyDir: string;
  configPath: string;
  extraResourcesDir: string;
}

export class PathsManager {
  private mode: OperationalMode;
  private paths: AppPaths;

  constructor(forcedMode?: OperationalMode, customDataDir?: string, autoMigrate: boolean = false) {
    this.mode = forcedMode || this.detectMode();
    this.paths = this.computePaths(this.mode, customDataDir);
    this.ensureDirectories();
    if (autoMigrate) {
      this.migrateLegacyDataIfNeeded();
    }
  }

  public getPaths(): AppPaths {
    return { ...this.paths };
  }

  public getMode(): OperationalMode {
    return this.mode;
  }

  private detectMode(): OperationalMode {
    if (process.env.OWNBASE_MODE === 'service' || process.argv.includes('--service')) {
      return 'service';
    }
    if (process.env.OWNBASE_MODE === 'portable' || process.argv.includes('--portable')) {
      return 'portable';
    }
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.OWNBASE_MODE === 'dev' ||
      process.argv.includes('--dev')
    ) {
      return 'dev';
    }

    // Default to service mode on Windows production, or portable if running from a portable unpack directory
    if (process.platform === 'win32') {
      if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return 'portable';
      }
      return 'service';
    }

    return 'dev';
  }

  private computePaths(mode: OperationalMode, customDataDir?: string): AppPaths {
    let dataDir: string;

    if (customDataDir) {
      dataDir = path.resolve(customDataDir);
    } else {
      switch (mode) {
        case 'service': {
          const programData = process.env.ProgramData || 'C:\\ProgramData';
          dataDir = path.join(programData, 'Ownbase');
          break;
        }
        case 'portable': {
          const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
          dataDir = path.join(exeDir, 'data');
          break;
        }
        case 'dev':
        default: {
          dataDir = path.resolve(process.cwd(), '.data');
          break;
        }
      }
    }

    // Resolve extraResources directory (for bundled binaries like pgsql, caddy, etc.)
    const resourcesPath =
      (process as any).resourcesPath ||
      process.env.RESOURCES_PATH ||
      (process.env.PORTABLE_EXECUTABLE_DIR ? path.join(path.dirname(process.execPath), 'resources') : '') ||
      process.cwd();
    const candidateResources = [
      path.join(resourcesPath, 'extraResources'),
      path.join(__dirname, '..', '..', '..', '..', 'extraResources'),
      path.join(__dirname, '..', '..', '..', 'extraResources'),
      path.join(process.cwd(), 'extraResources'),
    ];

    let extraResourcesDir = path.join(process.cwd(), 'extraResources');
    for (const cand of candidateResources) {
      if (cand && fs.existsSync(cand)) {
        extraResourcesDir = cand;
        break;
      }
    }

    return {
      mode,
      rootDir: dataDir,
      dataDir,
      logsDir: path.join(dataDir, 'logs'),
      runtimesDir: path.join(dataDir, 'runtimes'),
      appsDir: path.join(dataDir, 'apps'),
      releasesDir: path.join(dataDir, 'releases'),
      backupsDir: path.join(dataDir, 'backups'),
      postgresDir: path.join(dataDir, 'postgres'),
      storageDir: path.join(dataDir, 'storage'),
      secretsDir: path.join(dataDir, 'secrets'),
      caddyDir: path.join(dataDir, 'caddy'),
      configPath: path.join(dataDir, 'config.json'),
      extraResourcesDir,
    };
  }

  private ensureDirectories() {
    const dirs = [
      this.paths.dataDir,
      this.paths.logsDir,
      this.paths.runtimesDir,
      this.paths.appsDir,
      this.paths.releasesDir,
      this.paths.backupsDir,
      this.paths.postgresDir,
      this.paths.storageDir,
      this.paths.secretsDir,
      this.paths.caddyDir,
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {
          // ignore directory creation error if handled later or permission restricted
        }
      }
    }
  }

  public migrateLegacyDataIfNeeded(): { migrated: boolean; source?: string } {
    const migrationMarker = path.join(this.paths.dataDir, 'legacy-migration.json');
    if (fs.existsSync(migrationMarker)) {
      return { migrated: false };
    }

    const appData = process.env.APPDATA || (os.homedir() ? path.join(os.homedir(), 'AppData', 'Roaming') : null);
    if (!appData) {
      return { migrated: false };
    }

    const legacyDirs = [
      path.join(appData, 'native-windows-server-hub'),
      path.join(appData, 'NativeWindowsServerHub'),
    ];

    let sourceFound: string | null = null;
    for (const cand of legacyDirs) {
      if (fs.existsSync(cand)) {
        sourceFound = cand;
        break;
      }
    }

    if (!sourceFound) {
      return { migrated: false };
    }

    // Check if target postgres directory is already populated
    const targetPgVersion = path.join(this.paths.postgresDir, 'PG_VERSION');
    if (fs.existsSync(targetPgVersion)) {
      // Already has data; mark as resolved without overwriting
      try {
        fs.writeFileSync(
          migrationMarker,
          JSON.stringify({ migratedAt: new Date().toISOString(), skipped: true, source: sourceFound }, null, 2),
          'utf-8'
        );
      } catch {}
      return { migrated: false, source: sourceFound };
    }

    try {
      this.copyDirectoryRecursive(sourceFound, this.paths.dataDir);
      fs.writeFileSync(
        migrationMarker,
        JSON.stringify({ migratedAt: new Date().toISOString(), source: sourceFound, success: true }, null, 2),
        'utf-8'
      );
      return { migrated: true, source: sourceFound };
    } catch (err: any) {
      return { migrated: false, source: sourceFound };
    }
  }

  private copyDirectoryRecursive(src: string, dest: string) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  }
}

export const pathsManager = new PathsManager();
export const paths = pathsManager.getPaths();
