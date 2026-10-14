import { expect } from 'chai';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedJarvisAuditLog, parseAuditKey } from '../src/jarvis/encryptedAuditLog.js';

describe('encrypted JARVIS audit log', () => {
  it('persists and reloads encrypted events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-audit-'));
    const file = join(directory, 'audit.log');
    const key = Buffer.alloc(32, 7);
    const event = { id: 'event-1', at: new Date().toISOString(), type: 'task.created' as const, detail: 'private detail' };

    try {
      new EncryptedJarvisAuditLog(file, key).append(event);
      const raw = readFileSync(file, 'utf8');
      expect(raw).to.not.contain('private detail');
      expect(new EncryptedJarvisAuditLog(file, key).list()).to.deep.equal([event]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires an exact 32-byte hexadecimal key', () => {
    expect(parseAuditKey(undefined)).to.equal(null);
    expect(() => parseAuditKey('short')).to.throw(/64 hexadecimal/);
    expect(parseAuditKey('a'.repeat(64))).to.have.length(32);
  });
});

