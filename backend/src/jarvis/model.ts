export interface JarvisModelRequest {
  instruction: string;
  userInput: string;
  timeoutMs?: number;
  images?: string[];
  json?: boolean;
  /** Overrides the client's default model for this call (e.g. a smaller, faster one). */
  model?: string;
  /** Upper bound on generated tokens. */
  maxTokens?: number;
  priority?: 'foreground' | 'background';
  /** Aborts the call (used to pre-empt background work for a waiting user). */
  signal?: AbortSignal;
  /** When set, the response is streamed and each text chunk is passed here as it arrives. */
  onToken?: (chunk: string) => void;
}

export interface JarvisModelClient {
  readonly provider: 'ollama';
  readonly model: string;
  complete(request: JarvisModelRequest): Promise<string>;
}

export class OllamaModelClient implements JarvisModelClient {
  readonly provider = 'ollama' as const;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly defaultTimeoutMs = 180_000,
  ) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('OLLAMA_BASE_URL must be an http(s) URL without embedded credentials.');
    }
  }

  async complete(request: JarvisModelRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.defaultTimeoutMs);
    request.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model ?? this.model,
          stream: Boolean(request.onToken),
          keep_alive: '30m',
          options: { num_predict: request.maxTokens ?? 600 },
          ...(request.json ? { format: 'json' } : {}),
          messages: [
            { role: 'system', content: request.instruction },
            { role: 'user', content: request.userInput, ...(request.images ? { images: request.images } : {}) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Local model request failed with status ${response.status}.`);
      if (request.onToken && response.body) return await readStream(response.body, request.onToken);
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error('Local model response exceeded the size limit.');
      const parsed = JSON.parse(body) as { message?: { content?: unknown } };
      if (typeof parsed.message?.content !== 'string') throw new Error('Local model returned an invalid response.');
      return parsed.message.content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readStream(stream: ReadableStream<Uint8Array>, onToken: (chunk: string) => void): Promise<string> {
  const decoder = new TextDecoder();
  let pending = '';
  let full = '';
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content;
    if (typeof content !== 'string') return;
    full += content;
    if (full.length > 1_000_000) throw new Error('Local model response exceeded the size limit.');
    if (content) onToken(content);
  };
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  handleLine(pending);
  return full;
}

/**
 * Runs one model call at a time. Waiting foreground calls go first, and a foreground call
 * pre-empts a running background one (which is retried afterwards) so the user never waits on background work.
 */
export class PrioritizedModelClient implements JarvisModelClient {
  readonly provider: 'ollama';
  readonly model: string;
  private active = 0;
  private sequence = 0;
  private readonly queue: Array<{ rank: number; order: number; start: () => void }> = [];
  private readonly runningBackground = new Set<AbortController>();

  constructor(private readonly inner: JarvisModelClient, private readonly concurrency = 1) {
    this.provider = inner.provider;
    this.model = inner.model;
  }

  complete(request: JarvisModelRequest): Promise<string> {
    const background = request.priority === 'background';
    return new Promise((resolve, reject) => {
      const order = this.sequence++;
      const enqueue = () => {
        this.queue.push({ rank: background ? 1 : 0, order, start: run });
        this.queue.sort((a, b) => a.rank - b.rank || a.order - b.order);
        this.next();
      };
      const run = () => {
        const controller = new AbortController();
        // Background partial text is unused, and a retried call must not replay tokens.
        const call = background ? { ...request, onToken: undefined, signal: controller.signal } : request;
        if (background) this.runningBackground.add(controller);
        this.inner.complete(call).then(resolve, (error) => {
          if (controller.signal.aborted && background) enqueue();
          else reject(error);
        }).finally(() => {
          this.runningBackground.delete(controller);
          this.active -= 1;
          this.next();
        });
      };
      enqueue();
      if (!background && this.active >= this.concurrency && this.runningBackground.size) {
        (this.runningBackground.values().next().value as AbortController).abort();
      }
    });
  }

  private next(): void {
    while (this.active < this.concurrency && this.queue.length) {
      this.active += 1;
      (this.queue.shift() as { start: () => void }).start();
    }
  }
}
