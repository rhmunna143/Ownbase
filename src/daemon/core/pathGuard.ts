import path from 'path';
import fs from 'fs';

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSecurityError';
  }
}

// Windows reserved device names: CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9 (case-insensitive)
const WINDOWS_RESERVED_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export interface PathGuardOptions {
  allowNonExistent?: boolean;
}

/**
 * Validates and safely resolves an untrusted relative path against a designated root directory.
 * 
 * Security Controls (FR4 / Item 1.8 / Acceptance A3):
 * 1. Rejects null bytes (\0).
 * 2. Decodes URI components to block encoded traversals (%2e%2e).
 * 3. Rejects Windows Alternate Data Streams (contains ':').
 * 4. Rejects absolute paths (e.g. C:\..., /..., \\server\share).
 * 5. Rejects Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
 * 6. Normalizes and asserts path.relative(canonicalRoot, resolved) is strictly contained (no '..').
 * 7. Evaluates realpath where files/directories exist to defeat junction and symlink escape.
 */
export function safeResolvePath(rootDir: string, userInput: string, options: PathGuardOptions = {}): string {
  if (typeof userInput !== 'string') {
    throw new PathSecurityError('Path input must be a string');
  }

  // 1. Null byte check
  if (userInput.includes('\0')) {
    throw new PathSecurityError('Null bytes are forbidden in paths');
  }

  // 2. Decode percent-encoding to catch %2e%2e, %2f, etc.
  let decoded = userInput;
  try {
    decoded = decodeURIComponent(userInput);
  } catch {
    // Malformed URI sequence
    throw new PathSecurityError('Invalid URI encoding in path');
  }

  // 3. Reject Windows Alternate Data Streams (ADS) and drive colons
  if (decoded.includes(':')) {
    throw new PathSecurityError('Alternate data streams and drive specifiers are forbidden');
  }

  // 4. Reject absolute paths and UNC shares (\\server\share or //server/share)
  if (path.isAbsolute(decoded) || /^([\\\/]{2})|^([a-zA-Z]:)/.test(decoded)) {
    throw new PathSecurityError('Absolute paths and UNC shares are forbidden');
  }

  // Normalize slashes to platform separator
  const canonicalRoot = path.resolve(rootDir);
  const normalizedInput = decoded.replace(/[\/\\]+/g, path.sep);

  // 5. Check components for reserved Windows device names
  const segments = normalizedInput.split(path.sep).filter(Boolean);
  for (const segment of segments) {
    if (WINDOWS_RESERVED_DEVICE.test(segment)) {
      throw new PathSecurityError(`Reserved Windows device name '${segment}' is forbidden`);
    }
  }

  // 6. Strict resolution and containment check
  const resolved = path.resolve(canonicalRoot, normalizedInput);
  const rel = path.relative(canonicalRoot, resolved);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathSecurityError('Path traversal escape detected outside root directory');
  }

  // 7. Symlink / Junction Resolution Verification
  // Check if target or any existing ancestor escapes via symlink / junction
  let currentCheck = resolved;
  while (currentCheck && currentCheck !== canonicalRoot && currentCheck !== path.dirname(currentCheck)) {
    if (fs.existsSync(currentCheck)) {
      try {
        const real = fs.realpathSync(currentCheck);
        const realRoot = fs.existsSync(canonicalRoot) ? fs.realpathSync(canonicalRoot) : canonicalRoot;
        const realRel = path.relative(realRoot, real);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
          throw new PathSecurityError('Junction/Symlink escape detected outside canonical root');
        }
      } catch (err: any) {
        if (err instanceof PathSecurityError) throw err;
      }
      break; // Verified lowest existing ancestor
    }
    currentCheck = path.dirname(currentCheck);
  }

  return resolved;
}
