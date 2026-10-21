import { describe, expect, it } from 'vitest';
import { TEAM_NAMER_SOURCE_EXCERPT_CHARS, teamRunNamerInput } from './team-run-title.js';

describe('teamRunNamerInput', () => {
  it('sends the attached plan with a mention-only goal and falls back to its heading', () => {
    const plan = '# Normalize Squad Plan Ids\n\n## Work\n- [U1] alpha';
    expect(teamRunNamerInput('@plans/a-recoverable.md', [plan])).toEqual({
      prompt: `@plans/a-recoverable.md\n\nAttached plan:\n${plan}`,
      fallbackTitle: 'Normalize Squad Plan Ids'
    });
  });

  it('keeps the goal as the fallback when it has words of its own', () => {
    expect(teamRunNamerInput('Ship the export button @plan.md', ['# Other']).fallbackTitle).toBe('Ship the export button');
  });

  it('caps the excerpt and skips empty sources', () => {
    const long = `# Big\n${'x'.repeat(TEAM_NAMER_SOURCE_EXCERPT_CHARS * 2)}`;
    const { prompt } = teamRunNamerInput('@big.md', ['  ', long]);
    expect(prompt).toBe(`@big.md\n\nAttached plan:\n${long.slice(0, TEAM_NAMER_SOURCE_EXCERPT_CHARS)}`);
  });

  it('leaves a goal without sources unchanged and never puts a path in the fallback', () => {
    expect(teamRunNamerInput('Fix login redirect', [])).toEqual({ prompt: 'Fix login redirect', fallbackTitle: 'Fix login redirect' });
    expect(teamRunNamerInput('@/Users/alice/plan.md', ['no heading here']).fallbackTitle).toBe('Team run');
    expect(teamRunNamerInput('@x.md', ['# Read /Users/alice/secret.md']).fallbackTitle).toBe('Read');
  });
});
