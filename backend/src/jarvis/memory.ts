import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JarvisToolHandler } from './toolGateway.js';

const MAX_NOTES = 50;
const MAX_NOTE_CHARS = 200;

/** Small plain-JSON list of facts the user asked JARVIS to remember; the file is local and user-editable. */
export class JarvisMemory {
  private notes: string[] = [];

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        if (Array.isArray(parsed)) this.notes = parsed.filter((n): n is string => typeof n === 'string').slice(-MAX_NOTES);
      } catch {
        this.notes = [];
      }
    }
  }

  list(): string[] {
    return [...this.notes];
  }

  remember(note: string): string {
    const text = note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS);
    if (!text) throw new Error('Nothing to remember.');
    if (!this.notes.includes(text)) this.notes = [...this.notes, text].slice(-MAX_NOTES);
    this.save();
    return `Remembered: ${text}`;
  }

  forget(fragment: string): string {
    const needle = fragment.trim().toLowerCase();
    if (!needle) throw new Error('Say what to forget.');
    const before = this.notes.length;
    this.notes = this.notes.filter((note) => !note.toLowerCase().includes(needle));
    this.save();
    return `Forgot ${before - this.notes.length} note(s).`;
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.notes, null, 2), { mode: 0o600 });
  }
}

export function createMemoryHandler(memory: JarvisMemory): JarvisToolHandler {
  return async (input) => {
    const { remember, forget } = (input ?? {}) as { remember?: unknown; forget?: unknown };
    if (typeof remember === 'string') return memory.remember(remember);
    if (typeof forget === 'string') return memory.forget(forget);
    throw new Error('Provide "remember" or "forget" as a string.');
  };
}
