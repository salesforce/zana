import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../styles/global.css', import.meta.url), 'utf8');

function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? null;
}

describe('past timeline row dimming', () => {
  it('dims a past work row only while it is collapsed', () => {
    const body = ruleBody('.thread-timeline-work.is-dim:not(.is-open),\n.thread-timeline-system.is-dim');
    expect(body).toMatch(/opacity:\s*0\.4/);
    // An unconditional dim on an opened row compounds into its children.
    expect(css).not.toMatch(/\.thread-timeline-work\.is-dim\s*,\s*\.thread-timeline-system\.is-dim\s*\{/);
  });

  it('never re-dims rows nested inside an opened group', () => {
    const body = ruleBody('.thread-timeline-nested .thread-timeline-work.is-dim,\n.thread-timeline-nested .thread-timeline-system.is-dim');
    expect(body).toMatch(/opacity:\s*1\b/);
    expect(css.indexOf('.thread-timeline-nested .thread-timeline-work.is-dim'))
      .toBeGreaterThan(css.indexOf('.thread-timeline-work.is-dim:not(.is-open)'));
  });
});
