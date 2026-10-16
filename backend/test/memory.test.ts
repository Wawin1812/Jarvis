import { expect } from 'chai';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JarvisMemory } from '../src/jarvis/memory.js';

describe('JARVIS memory', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jarvis-mem-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists notes, dedupes, and forgets by fragment', () => {
    const file = join(dir, 'sub', 'memory.json');
    const memory = new JarvisMemory(file);
    memory.remember('The user is called Wawin');
    memory.remember('The user is called Wawin');
    memory.remember('Prefers short answers');
    expect(new JarvisMemory(file).list()).to.deep.equal(['The user is called Wawin', 'Prefers short answers']);
    expect(memory.forget('SHORT')).to.equal('Forgot 1 note(s).');
    expect(JSON.parse(readFileSync(file, 'utf8'))).to.deep.equal(['The user is called Wawin']);
  });

  it('caps note length and rejects empty notes', () => {
    const memory = new JarvisMemory();
    memory.remember('x'.repeat(500));
    expect(memory.list()[0]).to.have.length(200);
    expect(() => memory.remember('   ')).to.throw();
  });
});
