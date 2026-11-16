import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface KnowledgeChunk {
  source: string;
  text: string;
  /** Unit-length, so cosine similarity is a plain dot product. */
  vector: number[];
}

export interface SourceMeta {
  mtimeMs: number;
  size: number;
}

export interface SearchHit {
  source: string;
  text: string;
  score: number;
}

interface StoreFile {
  model: string;
  sources: Record<string, SourceMeta>;
  chunks: KnowledgeChunk[];
  updatedAt: string;
}

export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  // Rounding keeps the JSON file small; five decimals is far finer than ranking needs.
  return norm === 0 ? vector.map(() => 0) : vector.map((value) => Math.round((value / norm) * 1e5) / 1e5);
}

/** In-memory vector index persisted as one local JSON file. Plenty for thousands of chunks. */
export class KnowledgeStore {
  private sources: Record<string, SourceMeta> = {};
  private chunks: KnowledgeChunk[] = [];
  private updatedAt = '';

  constructor(private readonly file: string | undefined, private readonly model: string) {
    if (file && existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as StoreFile;
        // Vectors from a different embedding model live in a different space, so they must be rebuilt.
        if (data.model === model && Array.isArray(data.chunks)) {
          this.sources = data.sources ?? {};
          this.chunks = data.chunks;
          this.updatedAt = data.updatedAt ?? '';
        }
      } catch {
        this.chunks = [];
        this.sources = {};
      }
    }
  }

  isFresh(source: string, meta: SourceMeta): boolean {
    const known = this.sources[source];
    return Boolean(known && known.mtimeMs === meta.mtimeMs && known.size === meta.size);
  }

  replace(source: string, meta: SourceMeta, entries: Array<{ text: string; vector: number[] }>): void {
    this.chunks = this.chunks.filter((chunk) => chunk.source !== source);
    this.chunks.push(...entries.map((entry) => ({ source, text: entry.text, vector: normalize(entry.vector) })));
    this.sources[source] = meta;
  }

  /** Drops every source that is not in `keep` (deleted or newly ignored files). Returns how many were removed. */
  retain(keep: ReadonlySet<string>): number {
    const gone = Object.keys(this.sources).filter((source) => !keep.has(source));
    for (const source of gone) delete this.sources[source];
    if (gone.length) this.chunks = this.chunks.filter((chunk) => keep.has(chunk.source));
    return gone.length;
  }

  search(query: number[], k: number, minScore = 0): SearchHit[] {
    const q = normalize(query);
    return this.chunks
      .map((chunk) => ({ source: chunk.source, text: chunk.text, score: dot(q, chunk.vector) }))
      .filter((hit) => hit.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  stats(): { files: number; chunks: number; updatedAt: string } {
    return { files: Object.keys(this.sources).length, chunks: this.chunks.length, updatedAt: this.updatedAt };
  }

  save(): void {
    this.updatedAt = new Date().toISOString();
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const data: StoreFile = { model: this.model, sources: this.sources, chunks: this.chunks, updatedAt: this.updatedAt };
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}

function dot(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += a[i] * b[i];
  return sum;
}
