import { describe, expect, it } from 'vitest';
import { compareCommitExecution } from '../launch-execution-commit.js';

const pin = (targetId: string) => ({ adapterId: 'opencode', level: 'low' as const, targetId });
const binding = { scope: 'local' as const, evidenceDigest: 'ev-1', consentReservation: undefined };

describe('compareCommitExecution', () => {
  it('accepts an unchanged binding and pin', () => {
    expect(compareCommitExecution(
      { decision: 'allowed', ...binding, modelPin: pin('fixture-provider/gpt-7-luna') },
      binding,
      { modelPin: pin('fixture-provider/gpt-7-luna') }
    )).toEqual({ ok: true });
    expect(compareCommitExecution({ decision: 'allowed', scope: 'local' }, { scope: 'local' }, {})).toEqual({ ok: true });
  });

  it('refuses changed evidence, consent, or scope', () => {
    const refused = { ok: false, reason: 'execution evidence or consent changed after preflight' };
    expect(compareCommitExecution({ decision: 'allowed', ...binding, evidenceDigest: 'ev-2' }, binding, {})).toEqual(refused);
    expect(compareCommitExecution({ decision: 'allowed', ...binding, scope: 'remote' }, binding, {})).toEqual(refused);
  });

  it.each([
    ['re-resolved to a different id', pin('fixture-provider/gpt-8-luna'), pin('fixture-provider/gpt-7-luna')],
    ['pin appeared', pin('fixture-provider/gpt-7-luna'), undefined],
    ['pin disappeared', undefined, pin('fixture-provider/gpt-7-luna')]
  ])('refuses a model pin that %s at commit', (_label, current, authorized) => {
    expect(compareCommitExecution(
      { decision: 'allowed', ...binding, modelPin: current },
      binding,
      { modelPin: authorized }
    )).toEqual({ ok: false, reason: 'model target changed after preflight' });
  });
});
