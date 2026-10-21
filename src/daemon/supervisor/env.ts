import { secretsManager } from '../core/secrets';
import { logger } from '../core/logger';

export const SAFE_SYSTEM_ENV_ALLOWLIST = [
  'SYSTEMROOT',
  'WINDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'TEMP',
  'TMP',
  'COMSPEC',
  'USERPROFILE',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'HOMEDRIVE',
  'HOMEPATH',
];

export interface BuildEnvironmentOptions {
  serviceEnv?: Record<string, string>;
  encryptedEnvJson?: string | null;
  allowlist?: string[];
  extraEnv?: Record<string, string>;
}

/**
 * Builds an isolated environment for a child process by copying only allowlisted
 * system variables, merging service variables, and decrypting sensitive variables.
 */
export async function buildIsolatedEnvironment(
  options: BuildEnvironmentOptions = {}
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const allowlist = options.allowlist || SAFE_SYSTEM_ENV_ALLOWLIST;

  // 1. Copy allowlisted system variables (case-insensitively on Windows)
  const allowlistUpper = new Set(allowlist.map((k) => k.toUpperCase()));
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined && allowlistUpper.has(key.toUpperCase())) {
      env[key] = val;
    }
  }

  // 2. Decrypt encrypted variables if present
  if (options.encryptedEnvJson) {
    try {
      const decryptedString = secretsManager.decrypt(options.encryptedEnvJson);
      const parsed = JSON.parse(decryptedString);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') {
            env[k] = v;
          }
        }
      }
    } catch (err: any) {
      logger.warn('supervisor', `Failed to decrypt service encrypted environment: ${err.message}`);
    }
  }

  // 3. Merge explicit service environment variables
  if (options.serviceEnv) {
    for (const [k, v] of Object.entries(options.serviceEnv)) {
      if (v !== undefined) {
        env[k] = v;
      }
    }
  }

  // 4. Merge extra overrides
  if (options.extraEnv) {
    for (const [k, v] of Object.entries(options.extraEnv)) {
      if (v !== undefined) {
        env[k] = v;
      }
    }
  }

  return env;
}
