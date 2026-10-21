import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';

export type SupportedRuntime = 'node' | 'python' | 'go' | 'static' | 'custom';

export interface RepoConfig {
  runtime?: SupportedRuntime;
  runtimeVersion?: string;
  buildCommand?: string;
  startCommand?: string;
  port?: number;
  healthPath?: string;
  env?: Record<string, string>;
}

export interface DetectedProject {
  runtime: SupportedRuntime;
  runtimeVersion?: string;
  buildCommand: string;
  startCommand: string;
  defaultPort: number;
  healthPath: string;
  detectedFramework?: string;
  hasBuildStep: boolean;
  configSource: 'repo-config' | 'package.json' | 'python' | 'go' | 'static' | 'fallback';
}

export class ProjectDetector {
  /**
   * Auto-detect project structure, framework, runtime, and start commands
   */
  public async detect(projectDir: string, overrides?: Partial<RepoConfig>): Promise<DetectedProject> {
    const canonicalDir = path.resolve(projectDir);

    // 1. Check for explicit ownbase.json in repo root (highest priority)
    const repoConfig = this.readRepoConfigFile(canonicalDir);
    const effectiveConfig = { ...repoConfig, ...overrides };

    if (effectiveConfig.runtime) {
      return this.resolveExplicitConfig(effectiveConfig, canonicalDir);
    }

    // 2. Node.js detection (package.json)
    const packageJsonPath = path.join(canonicalDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return this.detectNodeProject(canonicalDir, packageJsonPath, effectiveConfig);
    }

    // 3. Python detection (requirements.txt, pyproject.toml, Pipfile, main.py, app.py)
    const hasPythonFiles =
      fs.existsSync(path.join(canonicalDir, 'requirements.txt')) ||
      fs.existsSync(path.join(canonicalDir, 'pyproject.toml')) ||
      fs.existsSync(path.join(canonicalDir, 'Pipfile')) ||
      fs.existsSync(path.join(canonicalDir, 'main.py')) ||
      fs.existsSync(path.join(canonicalDir, 'app.py'));

    if (hasPythonFiles) {
      return this.detectPythonProject(canonicalDir, effectiveConfig);
    }

    // 4. Go detection (go.mod, main.go)
    const hasGoFiles =
      fs.existsSync(path.join(canonicalDir, 'go.mod')) ||
      fs.existsSync(path.join(canonicalDir, 'main.go'));

    if (hasGoFiles) {
      return this.detectGoProject(canonicalDir, effectiveConfig);
    }

    // 5. Static site detection (index.html)
    if (fs.existsSync(path.join(canonicalDir, 'index.html'))) {
      return this.detectStaticProject(canonicalDir, effectiveConfig);
    }

    // Fallback: Default to Node with sensible defaults
    logger.info('project-detector', `No recognized project manifest in ${projectDir}, using fallback`);
    return {
      runtime: 'node',
      buildCommand: effectiveConfig.buildCommand || '',
      startCommand: effectiveConfig.startCommand || 'node index.js',
      defaultPort: effectiveConfig.port || 3000,
      healthPath: effectiveConfig.healthPath || '/',
      hasBuildStep: Boolean(effectiveConfig.buildCommand),
      configSource: 'fallback',
    };
  }

  private readRepoConfigFile(dir: string): RepoConfig {
    const candidateFiles = ['ownbase.json', '.ownbase.json'];
    for (const cand of candidateFiles) {
      const fullPath = path.join(dir, cand);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(content);
          logger.info('project-detector', `Loaded repo config from ${cand}`);
          return parsed;
        } catch (err: any) {
          logger.warn('project-detector', `Failed to parse ${cand}: ${err.message}`);
        }
      }
    }
    return {};
  }

  private resolveExplicitConfig(config: RepoConfig, dir: string): DetectedProject {
    const runtime = config.runtime || 'node';
    let defaultStart = 'node index.js';
    let defaultPort = 3000;

    if (runtime === 'python') {
      defaultStart = 'python main.py';
      defaultPort = 8000;
    } else if (runtime === 'go') {
      defaultStart = 'app.exe';
      defaultPort = 8080;
    } else if (runtime === 'static') {
      defaultStart = '';
      defaultPort = 8080;
    }

    return {
      runtime,
      runtimeVersion: config.runtimeVersion,
      buildCommand: config.buildCommand || '',
      startCommand: config.startCommand || defaultStart,
      defaultPort: config.port || defaultPort,
      healthPath: config.healthPath || '/',
      hasBuildStep: Boolean(config.buildCommand),
      configSource: 'repo-config',
    };
  }

  private detectNodeProject(dir: string, pkgPath: string, config: RepoConfig): DetectedProject {
    let pkg: any = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (e: any) {
      logger.warn('project-detector', `Could not parse package.json: ${e.message}`);
    }

    const scripts = pkg.scripts || {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    let framework = 'node';
    let defaultPort = 3000;
    let buildCommand = '';
    let startCommand = '';

    if (deps['next']) {
      framework = 'next';
      buildCommand = 'npm run build';
      startCommand = 'npm run start';
      defaultPort = 3000;
    } else if (deps['@nestjs/core']) {
      framework = 'nest';
      buildCommand = 'npm run build';
      startCommand = 'npm run start:prod';
      defaultPort = 3000;
    } else if (deps['express']) {
      framework = 'express';
      buildCommand = scripts.build ? 'npm run build' : '';
      startCommand = scripts.start ? 'npm start' : (pkg.main ? `node ${pkg.main}` : 'node index.js');
      defaultPort = 3000;
    } else if (deps['fastify']) {
      framework = 'fastify';
      buildCommand = scripts.build ? 'npm run build' : '';
      startCommand = scripts.start ? 'npm start' : (pkg.main ? `node ${pkg.main}` : 'node index.js');
      defaultPort = 3000;
    } else {
      if (scripts.build) buildCommand = 'npm run build';
      if (scripts.start) {
        startCommand = 'npm start';
      } else if (pkg.main && fs.existsSync(path.join(dir, pkg.main))) {
        startCommand = `node ${pkg.main}`;
      } else if (fs.existsSync(path.join(dir, 'server.js'))) {
        startCommand = 'node server.js';
      } else if (fs.existsSync(path.join(dir, 'app.js'))) {
        startCommand = 'node app.js';
      } else {
        startCommand = 'node index.js';
      }
    }

    return {
      runtime: 'node',
      buildCommand: config.buildCommand ?? buildCommand,
      startCommand: config.startCommand ?? startCommand,
      defaultPort: config.port ?? defaultPort,
      healthPath: config.healthPath ?? '/',
      detectedFramework: framework,
      hasBuildStep: Boolean(config.buildCommand ?? buildCommand),
      configSource: 'package.json',
    };
  }

  private detectPythonProject(dir: string, config: RepoConfig): DetectedProject {
    let framework = 'python';
    let defaultPort = 8000;
    let buildCommand = '';
    let startCommand = 'python main.py';

    if (fs.existsSync(path.join(dir, 'requirements.txt'))) {
      buildCommand = 'pip install -r requirements.txt';
    } else if (fs.existsSync(path.join(dir, 'pyproject.toml'))) {
      buildCommand = 'pip install .';
    }

    // Inspect main python files for hints (FastAPI vs Flask)
    const mainPyPath = path.join(dir, 'main.py');
    const appPyPath = path.join(dir, 'app.py');

    let codeSample = '';
    if (fs.existsSync(mainPyPath)) {
      codeSample += fs.readFileSync(mainPyPath, { encoding: 'utf-8', flag: 'r' }).slice(0, 4096);
    }
    if (fs.existsSync(appPyPath)) {
      codeSample += fs.readFileSync(appPyPath, { encoding: 'utf-8', flag: 'r' }).slice(0, 4096);
    }

    if (codeSample.includes('fastapi') || codeSample.includes('FastAPI')) {
      framework = 'fastapi';
      defaultPort = 8000;
      const targetModule = fs.existsSync(mainPyPath) ? 'main:app' : 'app:app';
      startCommand = `uvicorn ${targetModule} --host 127.0.0.1 --port $PORT`;
    } else if (codeSample.includes('flask') || codeSample.includes('Flask')) {
      framework = 'flask';
      defaultPort = 5000;
      startCommand = fs.existsSync(appPyPath) ? 'python app.py' : 'python main.py';
    }

    return {
      runtime: 'python',
      buildCommand: config.buildCommand ?? buildCommand,
      startCommand: config.startCommand ?? startCommand,
      defaultPort: config.port ?? defaultPort,
      healthPath: config.healthPath ?? '/',
      detectedFramework: framework,
      hasBuildStep: Boolean(config.buildCommand ?? buildCommand),
      configSource: 'python',
    };
  }

  private detectGoProject(dir: string, config: RepoConfig): DetectedProject {
    return {
      runtime: 'go',
      buildCommand: config.buildCommand ?? 'go build -o app.exe .',
      startCommand: config.startCommand ?? 'app.exe',
      defaultPort: config.port ?? 8080,
      healthPath: config.healthPath ?? '/',
      detectedFramework: 'go',
      hasBuildStep: true,
      configSource: 'go',
    };
  }

  private detectStaticProject(dir: string, config: RepoConfig): DetectedProject {
    return {
      runtime: 'static',
      buildCommand: config.buildCommand ?? '',
      startCommand: config.startCommand ?? '',
      defaultPort: config.port ?? 8080,
      healthPath: config.healthPath ?? '/',
      detectedFramework: 'static-html',
      hasBuildStep: false,
      configSource: 'static',
    };
  }
}

export const projectDetector = new ProjectDetector();
