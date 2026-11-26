import { expect, it } from 'vitest';
import { API_ERROR_RESUME_DEFAULTS as D } from '@zana-ai/zcc-domain/product';
import { entries } from '../entries/agents';

it('reports the resume cap, falling back to the shared defaults', () => {
  const value = entries.find((e) => e.id === 'agents.api-error-resume-cap')!.value as (s: any) => string;
  expect(value({ config: { apiErrorResume: { maxPerWindow: 5, windowMinutes: 30 } } })).toBe('5 in 30 min');
  expect(value({ config: {} })).toBe(`${D.maxPerWindow} in ${D.windowMinutes} min`);
});

// #649 REQ-8: the search entry repeats the section's help sentence, with no harness name in it.
const NEUTRAL_HELP = "When an agent's turn stops on an API error that matches a rule below, Zana sends it a message so it carries on. Off by default.";

it('uses the harness-neutral help sentence for the intro entry', () => {
  const intro = entries.find((e) => e.id === 'agents.api-error-resume.intro')!;
  expect(intro.help).toBe(NEUTRAL_HELP);
  expect(intro.help).not.toMatch(/Claude Code/);
});
