import { describe, expect, it } from 'vitest';
import { availableAgentHarnesses, PROFILE_BY_FAMILY } from '../legacy-agent-home.js';

describe('availableAgentHarnesses', () => {
  it('keeps only enabled, installed, agent-eligible adapters', () => {
    expect(availableAgentHarnesses([
      { id: 'claude', agentDefaultEligible: true, availability: { enabled: true, installed: true } },
      { id: 'cursor', agentDefaultEligible: false, availability: { enabled: true, installed: true } },
      { id: 'codex', agentDefaultEligible: true, availability: { enabled: false, installed: true } },
      { id: 'pi', agentDefaultEligible: true, availability: { enabled: true, installed: false } }
    ]).map((row) => row.id)).toEqual(['claude']);
  });
});

describe('PROFILE_BY_FAMILY', () => {
  it('maps every harness family to its default launch profile', () => {
    expect(PROFILE_BY_FAMILY).toEqual({
      claude: 'claude',
      cursor: 'cursor',
      codex: 'codex',
      pi: 'pi',
      opencode: 'opencode'
    });
  });
});
