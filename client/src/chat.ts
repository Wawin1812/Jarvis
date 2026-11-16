import type { ChatMessage } from './types';

const SPEAKER = /^([A-Za-z][\w -]{0,30}?)( error)?: ([\s\S]*)$/;

/** The panel logs plain strings ("You: …", "coordinator: …"); this turns them into typed chat messages. */
export function toChat(messages: string[]): ChatMessage[] {
  return messages.map((raw, id): ChatMessage => {
    if (raw.startsWith('You: ')) return { id, role: 'user', text: raw.slice(5) };
    const match = SPEAKER.exec(raw);
    if (!match) return { id, role: 'system', text: raw };
    const [, speaker, isError, text] = match;
    if (isError) return { id, role: 'error', speaker, text };
    // Status notes such as "JARVIS: stopped." read better as quiet system lines.
    if (speaker === 'JARVIS' && /^(stopped|hands-free mode off)\.?$/i.test(text.trim())) return { id, role: 'system', text };
    return { id, role: 'jarvis', speaker, text };
  });
}

export const CAPABILITY_LABELS: Record<string, string> = {
  'files.read': 'Read a file',
  'files.write': 'Write a file',
  'knowledge.read': 'Search your documents',
  'browser.read': 'Search the web',
  'browser.interact': 'Open an app or site',
  'memory.write': 'Change memory',
  'screen.read': 'Read the screen',
  chat: 'Chat',
};

export function capabilityLabel(capability: string | undefined): string {
  return capability ? CAPABILITY_LABELS[capability] ?? capability : '';
}
