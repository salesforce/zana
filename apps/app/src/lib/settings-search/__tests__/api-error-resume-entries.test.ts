import { expect, it } from 'vitest';
import { API_ERROR_RESUME_DEFAULTS as D } from '@zana-ai/zcc-domain/product';
import { entries } from '../entries/agents';

it('reports the resume cap, falling back to the shared defaults', () => {
  const value = entries.find((e) => e.id === 'agents.api-error-resume-cap')!.value as (s: any) => string;
  expect(value({ config: { apiErrorResume: { maxPerWindow: 5, windowMinutes: 30 } } })).toBe('5 in 30 min');
  expect(value({ config: {} })).toBe(`${D.maxPerWindow} in ${D.windowMinutes} min`);
});
