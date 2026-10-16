import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { JarvisToolHandler } from '../toolGateway.js';

const MAX_BYTES = 500_000;
const MAX_TEXT_CHARS = 8_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; JARVIS-local-assistant)';

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = ip.toLowerCase();
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('url must be a valid http(s) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only http(s) URLs without embedded credentials are allowed.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);
  if (!addresses.length) throw new Error('Host could not be resolved.');
  if (addresses.some(isBlockedAddress)) throw new Error('Access to local or private network addresses is blocked.');
  return url;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchResult { title: string; url: string; snippet: string }

export function parseSearchResults(html: string, limit = 5): SearchResult[] {
  const results: SearchResult[] = [];
  const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    let url = match[1].replace(/&amp;/g, '&');
    if (url.startsWith('//')) url = `https:${url}`;
    const redirected = new URL(url, 'https://duckduckgo.com').searchParams.get('uddg');
    if (redirected) url = redirected;
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({ title: htmlToText(match[2]), url, snippet: htmlToText(match[3]) });
    if (results.length >= limit) break;
  }
  return results;
}

async function fetchBody(start: URL, cancel?: AbortSignal): Promise<{ body: string; type: string }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(url.href);
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/json;q=0.9' },
      signal: cancel ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), cancel]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = new URL(response.headers.get('location') as string, url);
      continue;
    }
    if (!response.ok) throw new Error(`The site responded with HTTP ${response.status}.`);
    const type = response.headers.get('content-type') ?? '';
    if (!/^(text\/|application\/(json|xhtml))/i.test(type)) throw new Error('Only text pages can be read.');
    const reader = response.body?.getReader();
    if (!reader) return { body: '', type };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => undefined);
    return { body: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8'), type };
  }
  throw new Error('Too many redirects.');
}

/** Read-only web access: `{query}` searches, `{url}` fetches one public page as plain text. */
export function createWebReadHandler(): JarvisToolHandler {
  return async (input, signal) => {
    const { query, url } = (input ?? {}) as { query?: unknown; url?: unknown };
    if (typeof query === 'string' && query.trim()) {
      const search = new URL('https://html.duckduckgo.com/html/');
      search.searchParams.set('q', query.trim().slice(0, 300));
      const { body } = await fetchBody(search, signal);
      const results = parseSearchResults(body, 4);
      if (!results.length) return 'No results found.';
      return results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet.slice(0, 220)}\n(${new URL(r.url).hostname})\n${r.url}`).join('\n\n');
    }
    if (typeof url === 'string' && url.length <= 2_000) {
      const { body, type } = await fetchBody(await assertPublicUrl(url), signal);
      const text = /html/i.test(type) ? htmlToText(body) : body;
      return text.slice(0, MAX_TEXT_CHARS) || '(empty page)';
    }
    throw new Error('Provide either a "query" string or a "url" string.');
  };
}
