import { lstat, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { JarvisToolHandler } from '../toolGateway.js';

const MAX_WRITE_BYTES = 100_000;
const SENSITIVE_NAME = /^(\.env.*|\.git|\.ssh|\.aws|\.gnupg|\.npmrc|id_(rsa|dsa|ecdsa|ed25519).*|.*\.(pem|key|p12|pfx|keystore))$/i;

/** Creates or overwrites one text file inside the allowed root; the parent folder must already exist. */
export function createFilesWriteHandler(rootDir: string): JarvisToolHandler {
  return async (input) => {
    const { path, content, overwrite } = (input ?? {}) as { path?: unknown; content?: unknown; overwrite?: unknown };
    if (typeof path !== 'string' || !path || path.length > 500 || path.includes('\0')) {
      throw new Error('path must be a non-empty string of at most 500 characters.');
    }
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_WRITE_BYTES) {
      throw new Error(`content must be a string of at most ${MAX_WRITE_BYTES} bytes.`);
    }
    const root = await realpath(rootDir);
    const requested = resolve(root, path.replace(/^\/+/, ''));
    let parent: string;
    try {
      parent = await realpath(dirname(requested));
    } catch {
      throw new Error('The parent folder does not exist.');
    }
    const target = resolve(parent, basename(requested));
    const rel = relative(root, target);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path is outside the allowed folder.');
    if (rel.split(sep).some((part) => SENSITIVE_NAME.test(part))) throw new Error('Writing to this file is blocked by policy.');

    const existing = await lstat(target).catch(() => null);
    if (existing && !existing.isFile()) throw new Error('Only regular files can be written.');
    if (existing && overwrite !== true) throw new Error('File already exists. Set "overwrite": true to replace it.');
    await writeFile(target, content, { encoding: 'utf8', flag: existing ? 'w' : 'wx' });
    return `Wrote ${Buffer.byteLength(content)} bytes to ${rel}.`;
  };
}
