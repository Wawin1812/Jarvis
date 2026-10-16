import { expect } from 'chai';
import { assertPublicUrl, htmlToText, isBlockedAddress, parseSearchResults } from '../src/jarvis/tools/webRead.js';

describe('JARVIS web.read helpers', () => {
  it('blocks private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).to.equal(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).to.equal(false);
  });

  it('rejects bad schemes, credentials and local hosts before any request', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'http://user:pw@example.com', 'http://127.0.0.1:3002/api', 'http://[::1]/', 'http://169.254.169.254/latest', 'not a url']) {
      let failed = false;
      await assertPublicUrl(url).catch(() => { failed = true; });
      expect(failed, url).to.equal(true);
    }
  });

  it('strips scripts and tags from pages', () => {
    expect(htmlToText('<head><title>x</title></head><body><script>evil()</script><p>Hello&nbsp;<b>world</b> &amp; co</p></body>')).to.equal('Hello world & co');
  });

  it('parses search results and unwraps redirect links', () => {
    const html = '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">Example <b>A</b></a><a class="result__snippet" href="x">First &amp; best</a>';
    expect(parseSearchResults(html)).to.deep.equal([{ title: 'Example A', url: 'https://example.com/a', snippet: 'First & best' }]);
  });
});
