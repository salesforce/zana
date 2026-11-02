import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTIONS,
  TEMPLATE_COMMENTS_RULE,
  buildAgentPrompt,
  MAX_AGENT_PROMPT_LENGTH
} from './agent-actions.js';

describe('TEMPLATE_COMMENTS_RULE', () => {
  it('is defined', () => {
    expect(TEMPLATE_COMMENTS_RULE).toBeDefined();
    expect(TEMPLATE_COMMENTS_RULE).toContain('AI Instructions');
    expect(TEMPLATE_COMMENTS_RULE).toContain('AI Post Template Instructions');
  });

  it('appears in draftingPrompt', async () => {
    const { draftingPrompt } = await import('../app/Workbench.js');
    const brief = 'Test brief';
    const prompt = draftingPrompt(brief);
    expect(prompt).toContain(TEMPLATE_COMMENTS_RULE);
  });

  it('appears in buildAgentPrompt for every action', () => {
    const doc = { id: 'test-id', title: 'Test Doc' };

    AGENT_ACTIONS.forEach((action) => {
      const prompt = buildAgentPrompt({ doc, action });
      expect(prompt).toContain(TEMPLATE_COMMENTS_RULE, `Action "${action.id}" missing TEMPLATE_COMMENTS_RULE`);
    });
  });

  it('appears in buildAgentPrompt without action', () => {
    const doc = { id: 'test-id', title: 'Test Doc' };
    const prompt = buildAgentPrompt({ doc });
    expect(prompt).toContain(TEMPLATE_COMMENTS_RULE);
  });

  it('does not exceed MAX_AGENT_PROMPT_LENGTH when added to longest action', () => {
    const doc = { id: 'test-id', title: 'Test Doc' };
    const longestAction = AGENT_ACTIONS.reduce((a, b) =>
      a.instruction.length > b.instruction.length ? a : b
    );
    const prompt = buildAgentPrompt({ doc, action: longestAction });
    expect(prompt.length).toBeLessThanOrEqual(MAX_AGENT_PROMPT_LENGTH);
  });
});
