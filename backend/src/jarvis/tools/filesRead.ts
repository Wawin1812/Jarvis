import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { JarvisToolHandler } from '../toolGateway.js';

const MAX_FILE_BYTES = 200_000;
const MAX_LISTING = 200;
const SENSITIVE_NAME = /^(\.env.*|\.git|\.ssh|\.aws|\.gnupg|\.npmrc|id_(rsa|dsa|ecdsa|ed25519).*|.*\.(pem|key|p12|pfx|keystore))$/i;

function isSensitive(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

/** Read-only access to one directory tree; symlinks that leave the root are rejected. */
export function createFilesReadHandler(rootDir: string): JarvisToolHandler {
  return async (input) => {
    const requested = (input as { path?: unknown } | null)?.path;
    if (typeof requested !== 'string' || requested.length > 500 || requested.includes('\0')) {
      throw new Error('path must be a string of at most 500 characters.');
    }
    const root = await realpath(rootDir);
    const relativeRequest = requested.replace(/^\/+/, '');

    let target: string;
    try {
      target = await realpath(resolve(root, relativeRequest || '.'));
    } catch {
      throw new Error('Path does not exist. Use a path relative to the allowed folder, or "." to list it.');
    }
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('Path is outside the allowed folder.');
    }
    if (rel.split(sep).some(isSensitive)) throw new Error('Access to this file is blocked by policy.');

    const info = await stat(target);
    if (info.isDirectory()) {
      const entries = await readdir(target, { withFileTypes: true });
      const names = entries
        .filter((entry) => !isSensitive(entry.name))
        .slice(0, MAX_LISTING)
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
      return names.length ? names.join('\n') : '(empty directory)';
    }
    if (!info.isFile()) throw new Error('Only regular files and directories can be read.');
    if (info.size > MAX_FILE_BYTES) throw new Error(`File is larger than ${MAX_FILE_BYTES} bytes.`);
    const content = await readFile(join(root, rel));
    if (content.includes(0)) throw new Error('Binary files cannot be read.');
    return content.toString('utf8');
  };
}
