import { expect } from 'chai';
import { createOpenHandler, resolveOpenTarget } from '../src/jarvis/tools/openTool.js';

describe('JARVIS open tool', () => {
  it('accepts allow-listed apps and plain http(s) addresses', () => {
    expect(resolveOpenTarget({ app: 'Firefox', url: 'https://mail.google.com' })).to.deep.equal({ app: 'Firefox', url: 'https://mail.google.com/' });
    expect(resolveOpenTarget({ app: 'chrome' })).to.deep.equal({ app: 'Google Chrome' });
    expect(resolveOpenTarget({ url: 'https://www.youtube.com/' })).to.deep.equal({ url: 'https://www.youtube.com/' });
  });

  it('rejects other apps, other schemes, embedded credentials and empty requests', () => {
    for (const input of [
      { app: 'Terminal' }, { app: 'Script Editor' }, { url: 'file:///etc/passwd' }, { url: 'javascript:alert(1)' },
      { url: 'ssh://host' }, { url: 'https://user:pw@example.com' }, { url: 'not a url' }, {}, null,
    ]) {
      expect(() => resolveOpenTarget(input), JSON.stringify(input)).to.throw();
    }
  });

  it('refuses to run off macOS', async () => {
    let message = '';
    await createOpenHandler('linux')({ url: 'https://example.com' }).catch((error: Error) => { message = error.message; });
    expect(message).to.contain('macOS');
  });
});
