import { expect } from 'chai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJarvisRuntime } from '../src/jarvis/runtime.js';

describe('JARVIS runtime configuration', () => {
  it('fails closed in production without encrypted audit persistence', () => {
    expect(() => createJarvisRuntime({ NODE_ENV: 'production' })).to.throw(/JARVIS_AUDIT_KEY/);
  });

  it('wires encrypted audit and Ollama configuration when provided', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-runtime-'));
    try {
      const runtime = createJarvisRuntime({
        NODE_ENV: 'production',
        JARVIS_AUDIT_KEY: 'b'.repeat(64),
        JARVIS_DATA_DIR: directory,
        OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
        OLLAMA_MODEL: 'test-model',
      });
      expect(runtime.persistentAudit).to.equal(true);
      expect(runtime.model).to.deep.include({ provider: 'ollama', model: 'test-model' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

