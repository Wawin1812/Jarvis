import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { JarvisToolHandler } from '../toolGateway.js';
import { isSensitive } from '../tools/filesRead.js';
import { chunkText } from './chunker.js';
import type { Embedder } from './embedder.js';
import type { KnowledgeStore, SearchHit } from './store.js';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.swift', '.html', '.css', '.csv', '.yml', '.yaml', '.toml', '.sql', '.sh']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.build']);
const MAX_FILE_BYTES = 200_000;
const MAX_DEPTH = 6;
const MAX_QUERY_CHARS = 300;
const MAX_OUTPUT_CHARS = 6_000;
const MIN_SCORE = 0.55;

export interface IndexStats {
  files: number;
  chunks: number;
  indexed: number;
  removed: number;
  skipped: number;
}

export interface KnowledgeOptions {
  rootDir: string;
  embedder: Embedder;
  store: KnowledgeStore;
  maxFiles?: number;
  maxChunks?: number;
  /** Minimum cosine similarity for a hit; real embeddings score unrelated text around 0.4-0.5. */
  minScore?: number;
  onIndexed?: (stats: IndexStats) => void;
}

/** Semantic search over the allowed folder: chunk, embed, store, and rank by cosine similarity. */
export class JarvisKnowledge {
  private running: Promise<IndexStats> | null = null;

  constructor(private readonly options: KnowledgeOptions) {}

  stats(): { files: number; chunks: number; updatedAt: string; embeddingModel: string } {
    return { ...this.options.store.stats(), embeddingModel: this.options.embedder.model };
  }

  /** Embeds new or changed files and drops deleted ones. Concurrent calls share one run. */
  index(signal?: AbortSignal): Promise<IndexStats> {
    this.running ??= this.runIndex(signal).finally(() => { this.running = null; });
    return this.running;
  }

  async search(query: string, k = 4, signal?: AbortSignal): Promise<SearchHit[]> {
    if (this.options.store.stats().chunks === 0) await this.index(signal);
    const [vector] = await this.options.embedder.embed([query], 'query', signal);
    return this.options.store.search(vector, k, this.options.minScore ?? MIN_SCORE);
  }

  private async runIndex(signal?: AbortSignal): Promise<IndexStats> {
    const { store, embedder } = this.options;
    const maxFiles = this.options.maxFiles ?? 500;
    const maxChunks = this.options.maxChunks ?? 4_000;
    const root = await realpath(this.options.rootDir);
    const found: Array<{ path: string; source: string }> = [];
    await this.walk(root, root, 0, found, maxFiles);

    const seen = new Set<string>();
    let indexed = 0;
    let skipped = 0;
    let total = store.stats().chunks;
    for (const file of found) {
      if (signal?.aborted) break;
      let meta: { mtimeMs: number; size: number };
      let chunks: ReturnType<typeof chunkText>;
      try {
        const info = await stat(file.path);
        meta = { mtimeMs: info.mtimeMs, size: info.size };
        seen.add(file.source);
        if (store.isFresh(file.source, meta)) continue;
        const content = await readFile(file.path);
        if (content.includes(0)) { skipped += 1; continue; }
        chunks = chunkText(content.toString('utf8'));
      } catch {
        skipped += 1;
        continue;
      }
      if (total + chunks.length > maxChunks) { skipped += 1; continue; }
      // Not wrapped: a missing model or stopped Ollama is a setup problem the caller should see.
      const vectors = await embedder.embed(chunks.map((chunk) => chunk.text), 'document', signal);
      store.replace(file.source, meta, chunks.map((chunk, i) => ({ text: chunk.text, vector: vectors[i] })));
      total += chunks.length;
      indexed += 1;
    }
    const removed = signal?.aborted ? 0 : store.retain(seen);
    if (indexed || removed) store.save();
    const stats = { ...store.stats(), indexed, removed, skipped };
    this.options.onIndexed?.(stats);
    return stats;
  }

  private async walk(root: string, dir: string, depth: number, out: Array<{ path: string; source: string }>, maxFiles: number): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.isSymbolicLink() || isSensitive(entry.name) || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await this.walk(root, full, depth + 1, out, maxFiles);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const info = await stat(full);
        if (info.size <= MAX_FILE_BYTES) out.push({ path: full, source: relative(root, full).split(sep).join('/') });
      }
    }
  }
}

export function formatHits(hits: SearchHit[]): string {
  if (!hits.length) return 'No relevant excerpts found in the indexed files.';
  let out = '';
  hits.forEach((hit, i) => {
    const block = `[${i + 1}] ${hit.source} (relevance ${hit.score.toFixed(2)})\n${hit.text}\n\n`;
    if (out.length + block.length <= MAX_OUTPUT_CHARS) out += block;
  });
  return out.trim();
}

export function createKnowledgeHandler(knowledge: JarvisKnowledge): JarvisToolHandler {
  return async (input, signal) => {
    const query = (input as { query?: unknown } | null)?.query;
    if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_CHARS) {
      throw new Error(`query must be a non-empty string of at most ${MAX_QUERY_CHARS} characters.`);
    }
    return formatHits(await knowledge.search(query.trim(), 4, signal));
  };
}
