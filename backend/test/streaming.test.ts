import { expect } from 'chai';
import { extractAnswerPrefix } from '../src/jarvis/agentLoop.js';

describe('streamed answer extraction', () => {
  it('returns nothing until the answer field starts', () => {
    expect(extractAnswerPrefix('{"action":"fin')).to.equal(null);
    expect(extractAnswerPrefix('{"action":"final","answer":"')).to.equal('');
  });

  it('grows as chunks arrive and stops at the closing quote', () => {
    const full = '{"action":"final","answer":"Hi \\"there\\"\\nok \\u00e9"}';
    expect(extractAnswerPrefix(full.slice(0, 30))).to.equal('Hi');
    expect(extractAnswerPrefix(full)).to.equal('Hi "there"\nok \u00e9');
  });

  it('does not emit a half-received escape sequence', () => {
    expect(extractAnswerPrefix('{"answer":"a\\')).to.equal('a');
    expect(extractAnswerPrefix('{"answer":"a\\u00')).to.equal('a');
  });
});
