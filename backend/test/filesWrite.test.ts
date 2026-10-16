import { expect } from 'chai';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFilesWriteHandler } from '../src/jarvis/tools/filesWrite.js';

describe('JARVIS files.write handler', () => {
  let root: string;
  let outside: string;
  let write: ReturnType<typeof createFilesWriteHandler>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-w-'));
    outside = mkdtempSync(join(tmpdir(), 'jarvis-out-'));
    mkdirSync(join(root, 'sub'));
    write = createFilesWriteHandler(root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('creates a new file and refuses to overwrite without the flag', async () => {
    await write({ path: 'sub/a.txt', content: 'hello' });
    expect(readFileSync(join(root, 'sub/a.txt'), 'utf8')).to.equal('hello');
    let message = '';
    await write({ path: 'sub/a.txt', content: 'x' }).catch((error: Error) => { message = error.message; });
    expect(message).to.contain('already exists');
    await write({ path: 'sub/a.txt', content: 'x', overwrite: true });
    expect(readFileSync(join(root, 'sub/a.txt'), 'utf8')).to.equal('x');
  });

  it('blocks traversal, symlink escapes, sensitive names and missing parents', async () => {
    symlinkSync(outside, join(root, 'link'));
    writeFileSync(join(outside, 'target.txt'), 'safe');
    for (const path of ['../evil.txt', 'link/evil.txt', '.env', 'sub/id_rsa', 'nope/a.txt']) {
      let failed = false;
      await write({ path, content: 'x' }).catch(() => { failed = true; });
      expect(failed, path).to.equal(true);
    }
    expect(readFileSync(join(outside, 'target.txt'), 'utf8')).to.equal('safe');
  });

  it('rejects oversized content', async () => {
    let failed = false;
    await write({ path: 'big.txt', content: 'x'.repeat(100_001) }).catch(() => { failed = true; });
    expect(failed).to.equal(true);
  });
});
