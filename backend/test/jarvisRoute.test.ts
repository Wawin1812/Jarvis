import { expect } from 'chai';
import { authorizeJarvisRequest, extractBearerToken } from '../src/routes/jarvis.js';

function requestWithAuthorization(value?: string) {
  return { header: (name: string) => name === 'authorization' ? value : undefined };
}

describe('JARVIS API authorization', () => {
  it('disables the API when no server token is configured', () => {
    expect(authorizeJarvisRequest(requestWithAuthorization('Bearer anything'), undefined)).to.deep.equal({
      allowed: false,
      status: 503,
      error: 'JARVIS API is disabled until JARVIS_API_TOKEN is configured.',
    });
  });

  it('requires a bearer token', () => {
    expect(authorizeJarvisRequest(requestWithAuthorization(), 'secret').allowed).to.equal(false);
    expect(authorizeJarvisRequest(requestWithAuthorization('Basic secret'), 'secret').allowed).to.equal(false);
  });

  it('accepts the configured token and rejects a wrong token', () => {
    expect(authorizeJarvisRequest(requestWithAuthorization('Bearer secret'), 'secret')).to.deep.equal({ allowed: true });
    expect(authorizeJarvisRequest(requestWithAuthorization('Bearer wrong'), 'secret').allowed).to.equal(false);
  });

  it('extracts only a non-empty bearer token', () => {
    expect(extractBearerToken(requestWithAuthorization('Bearer abc'))).to.equal('abc');
    expect(extractBearerToken(requestWithAuthorization('Bearer '))).to.equal(null);
  });
});

