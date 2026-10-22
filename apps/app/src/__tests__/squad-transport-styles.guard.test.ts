import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

function ruleBody(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', start), css.indexOf('}', start));
}

describe('Modern squad member styling', () => {
  it('draws a dotted edge on bordered squad surfaces and an inset dotted outline on borderless rows', () => {
    expect(ruleBody('.agent-card.has-cohort.is-modern')).toContain('border-style: dotted');
    expect(ruleBody('.teams-agent-item.is-modern {')).toBeTruthy();
    const rows = ruleBody('.agents-row.is-modern,\n.project-terminal-row.is-modern');
    expect(rows).toContain('outline: 1px dotted');
    expect(rows).toContain('outline-offset: -1px');
  });

  it('keeps CLI squad cohort styling solid', () => {
    expect(ruleBody('.agent-card.has-cohort {')).toContain('2px solid');
  });
});
