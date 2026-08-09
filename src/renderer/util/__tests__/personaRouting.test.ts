import { describe, expect, it } from 'vitest';
import { effectivePersonaRouting, personaRoutingSummary } from '../personaRouting.js';

describe('persona routing projection', () => {
  it('projects shipped legacy native values into concrete edit routing', () => {
    const persona = {
      id: 'builtin:reviewer',
      name: 'Code Reviewer',
      source: 'builtin' as const,
      baseProfile: 'claude' as const,
      model: 'opus',
      permissionMode: 'plan' as const
    };

    expect(effectivePersonaRouting(persona).claude).toMatchObject({
      modelTargetId: 'opus',
      executionState: 'plan'
    });
    expect(personaRoutingSummary(persona)).toEqual(['claude', 'opus', 'plan']);
  });

  it('uses structured values as source of truth for list and editor', () => {
    const persona = {
      id: 'native',
      name: 'Native',
      baseProfile: 'opencode' as const,
      model: 'stale-model',
      executionState: 'plan' as const,
      harnessRouting: {
        schemaVersion: 1 as const,
        byAdapter: {
          opencode: {
            providerTargetId: 'openai',
            modelTargetId: 'aisuite/gpt-5.6-sol',
            executionState: 'accept-edits' as const
          }
        }
      }
    };

    expect(effectivePersonaRouting(persona).opencode).toMatchObject({
      providerTargetId: 'openai',
      modelTargetId: 'aisuite/gpt-5.6-sol',
      executionState: 'accept-edits'
    });
    expect(personaRoutingSummary(persona)).toEqual([
      'opencode',
      'aisuite/gpt-5.6-sol',
      'accept-edits'
    ]);
  });
});
