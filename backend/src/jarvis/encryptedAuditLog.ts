import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import type { JarvisAuditEvent } from './contracts.js';
import type { JarvisAuditSink } from './auditLog.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/** Encrypted append-only audit storage for a single local user. */
export class EncryptedJarvisAuditLog implements JarvisAuditSink {
  private readonly events: JarvisAuditEvent[];

  constructor(private readonly filePath: string, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('JARVIS_AUDIT_KEY must be exactly 32 bytes.');
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    if (!existsSync(filePath)) {
      const fd = openSync(filePath, 'a', 0o600);
      closeSync(fd);
    }
    chmodSync(filePath, 0o600);
    this.events = this.load();
  }

  append(event: JarvisAuditEvent): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(event), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const line = [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.') + '\n';
    appendFileSync(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    this.events.push({ ...event });
  }

  list(): JarvisAuditEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  private load(): JarvisAuditEvent[] {
    const contents = readFileSync(this.filePath, 'utf8').trim();
    if (!contents) return [];
    return contents.split('\n').map((line, index) => {
      try {
        const [version, ivText, tagText, ciphertextText] = line.split('.');
        if (version !== VERSION || !ivText || !tagText || !ciphertextText) throw new Error('Invalid record format.');
        const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivText, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(ciphertextText, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
        return JSON.parse(plaintext) as JarvisAuditEvent;
      } catch {
        throw new Error(`Unable to decrypt JARVIS audit record ${index + 1}.`);
      }
    });
  }
}

export function parseAuditKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('JARVIS_AUDIT_KEY must be 64 hexadecimal characters.');
  return Buffer.from(value, 'hex');
}

