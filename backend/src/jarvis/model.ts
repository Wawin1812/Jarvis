export interface JarvisModelRequest {
  instruction: string;
  userInput: string;
  timeoutMs?: number;
  images?: string[];
  json?: boolean;
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
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: Boolean(request.onToken),
          keep_alive: '30m',
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
