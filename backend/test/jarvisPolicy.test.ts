import { expect } from 'chai';
import { decideJarvisPolicy } from '../src/services/jarvisPolicy.js';

describe('JARVIS policy gateway', () => {
  it('allows non-privileged chat without approval', () => {
    expect(decideJarvisPolicy({ capability: 'chat', approved: false }).allowed).to.equal(true);
  });

  it('denies privileged capabilities by default', () => {
    const decision = decideJarvisPolicy({ capability: 'files.read', approved: false });
    expect(decision.allowed).to.equal(false);
    expect(decision.reason).to.contain('approval');
  });

  it('requires an approval id, not just a boolean', () => {
    expect(decideJarvisPolicy({ capability: 'process.run', approved: true }).allowed).to.equal(false);
  });

  it('requires an active capture session for screen access', () => {
    const decision = decideJarvisPolicy({
      capability: 'screen.read',
      approved: true,
      approvalId: 'approval-1',
      sessionActive: false,
    });
    expect(decision.allowed).to.equal(false);
  });

  it('keeps external sending disabled and requires approval for memory', () => {
    expect(decideJarvisPolicy({ capability: 'external.send', approved: true, approvalId: 'approval-1' }).allowed).to.equal(false);
    expect(decideJarvisPolicy({ capability: 'memory.write', approved: false }).allowed).to.equal(false);
    expect(decideJarvisPolicy({ capability: 'memory.write', approved: true, approvalId: 'approval-1' }).allowed).to.equal(true);
  });

  it('allows an approved, non-disabled capability', () => {
    expect(decideJarvisPolicy({
      capability: 'files.read',
      approved: true,
      approvalId: 'approval-1',
    }).allowed).to.equal(true);
  });
});

