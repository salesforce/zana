import { describe, expect, it } from 'vitest';
import { registrationFor } from '../harness/registry.js';

describe('OpenCode restore prompt guard', () => {
  it('strips the original OpenCode prompt in the owning registration projection', () => {
    expect(registrationFor('opencode')?.restoreProjection?.({
      session: { profile: 'opencode', openCodeSessionId: 'ses_exact' },
      extraArgs: ['--prompt', 'original task', '--model', 'aisuite/gpt-5.6-terra']
    })).toEqual({
      profile: 'opencode-resume',
      extraArgs: ['--model', 'aisuite/gpt-5.6-terra'],
      resumeSessionId: 'ses_exact'
    });
  });
});
