import { execFile } from 'node:child_process';
import type { JarvisToolHandler } from '../toolGateway.js';

// Friendly name -> macOS application name. Terminals and script editors are deliberately absent.
const APPS: Record<string, string> = {
  firefox: 'Firefox',
  safari: 'Safari',
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  edge: 'Microsoft Edge',
  mail: 'Mail',
  calendar: 'Calendar',
  notes: 'Notes',
  music: 'Music',
  messages: 'Messages',
  finder: 'Finder',
  maps: 'Maps',
  photos: 'Photos',
  reminders: 'Reminders',
};

export function resolveOpenTarget(input: unknown): { app?: string; url?: string } {
  const { app, url } = (input ?? {}) as { app?: unknown; url?: unknown };
  const target: { app?: string; url?: string } = {};
  if (typeof app === 'string' && app.trim()) {
    const resolved = APPS[app.trim().toLowerCase()];
    if (!resolved) throw new Error(`I can only open: ${Object.values(APPS).filter((name, i, all) => all.indexOf(name) === i).join(', ')}.`);
    target.app = resolved;
  }
  if (typeof url === 'string' && url.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new Error('url must be a full http(s) address such as https://mail.google.com.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Only http(s) addresses without embedded credentials can be opened.');
    }
    target.url = parsed.href;
  }
  if (!target.app && !target.url) throw new Error('Provide an "app" and/or a "url" to open.');
  return target;
}

/** Opens a website and/or an allow-listed app on the user's Mac. It cannot sign in, read pages or click anything. */
export function createOpenHandler(platform: NodeJS.Platform = process.platform): JarvisToolHandler {
  return async (input, signal) => {
    if (platform !== 'darwin') throw new Error('Opening apps is only supported on macOS.');
    const target = resolveOpenTarget(input);
    // execFile with an argument list: no shell, so nothing in the url or app name can be interpreted as a command.
    const args = [...(target.app ? ['-a', target.app] : []), ...(target.url ? [target.url] : [])];
    await new Promise<void>((resolve, reject) => {
      execFile('open', args, { timeout: 10_000, signal }, (error, _stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || `Could not open ${target.app ?? target.url}.`));
        else resolve();
      });
    });
    const what = [target.app, target.url].filter(Boolean).join(' at ');
    return `Opened ${what}. I cannot see the page, sign in, or click anything for you, so the user continues from here.`;
  };
}
