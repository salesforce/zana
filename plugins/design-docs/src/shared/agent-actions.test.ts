import { describe, expect, it } from 'vitest';
import { AGENT_ACTIONS, buildAgentPrompt, MAX_AGENT_PROMPT_LENGTH } from './agent-actions.js';

describe('agent prompts', () => {
  it('stay neutral: no workflow-specific template comment convention', async () => {
    const { draftingPrompt } = await import('../app/Workbench.js');
    const doc = { id: 'test-id', title: 'Test Doc' };
    const prompts = [draftingPrompt('Test brief'), buildAgentPrompt({ doc }), ...AGENT_ACTIONS.map((action) => buildAgentPrompt({ doc, action }))];
    for (const prompt of prompts) expect(prompt).not.toContain('AI Instructions');
  });

  it('does not exceed MAX_AGENT_PROMPT_LENGTH for the longest action', () => {
    const doc = { id: 'test-id', title: 'Test Doc' };
    const longestAction = AGENT_ACTIONS.reduce((a, b) => (a.instruction.length > b.instruction.length ? a : b));
    expect(buildAgentPrompt({ doc, action: longestAction }).length).toBeLessThanOrEqual(MAX_AGENT_PROMPT_LENGTH);
  });
});
