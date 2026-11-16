export interface Chunk {
  text: string;
}

/** Splits text into overlapping windows, preferring paragraph, line, then sentence boundaries. */
export function chunkText(input: string, size = 900, overlap = 150): Chunk[] {
  const text = input.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  if (text.length <= size) return [{ text }];

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const floor = start + Math.floor(size / 2);
      const window = text.slice(floor, end);
      const breaks = ['\n\n', '\n', '. '].map((mark) => window.lastIndexOf(mark) < 0 ? -1 : floor + window.lastIndexOf(mark) + mark.length);
      const best = breaks.find((index) => index > 0);
      if (best) end = best;
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push({ text: piece });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
