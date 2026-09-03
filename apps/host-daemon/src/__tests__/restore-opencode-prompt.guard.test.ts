import { describe, expect, it } from 'vitest';
import { registrationFor } from '../harness/registry.js';

describe('OpenCode restore prompt guard', () => {
  it('strips the original OpenCode prompt in the owning registration projection', () => {
    expect(registrationFor('opencode')?.restoreProjection?.({
      session: { profile: 'opencode', openCodeSessionId: 'ses_exact' },
      extraArgs: ['--prompt', 'original task', '--model', 'llmgw/gpt-5.6-terra-1M']
    })).toEqual({
      profile: 'opencode-resume',
      extraArgs: ['--model', 'llmgw/gpt-5.6-terra-1M'],
      resumeSessionId: 'ses_exact'
    });
  });
});
