export type EmbedKind = 'document' | 'query';

export interface Embedder {
  /** Identifies the embedding model; vectors from different models are not comparable. */
  readonly model: string;
  embed(texts: string[], kind: EmbedKind, signal?: AbortSignal): Promise<number[][]>;
}

const BATCH_SIZE = 16;

/** Embeddings from a local Ollama server (`/api/embed`). */
export class OllamaEmbedder implements Embedder {
  constructor(
    private readonly baseUrl: string,
    readonly model = 'nomic-embed-text',
    private readonly timeoutMs = 120_000,
  ) {}

  async embed(texts: string[], kind: EmbedKind, signal?: AbortSignal): Promise<number[][]> {
    // nomic-embed-text is trained with task prefixes; using them noticeably improves retrieval.
    const prefix = this.model.startsWith('nomic-embed-text') ? `${kind === 'query' ? 'search_query' : 'search_document'}: ` : '';
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE).map((text) => prefix + text);
      vectors.push(...await this.requestBatch(batch, signal));
    }
    return vectors;
  }

  private async requestBatch(input: string[], signal?: AbortSignal): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // A short keep_alive frees the embedding model's memory soon after indexing.
        body: JSON.stringify({ model: this.model, input, keep_alive: '2m' }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(response.status === 404
          ? `Embedding model "${this.model}" is not installed. Run: ollama pull ${this.model}`
          : `Embedding request failed with status ${response.status}.`);
      }
      const { embeddings } = await response.json() as { embeddings?: unknown };
      if (!Array.isArray(embeddings) || embeddings.length !== input.length
        || !embeddings.every((v) => Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))) {
        throw new Error('Embedding model returned an invalid response.');
      }
      return embeddings as number[][];
    } finally {
      clearTimeout(timeout);
    }
  }
}
