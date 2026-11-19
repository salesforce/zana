import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The app chrome sets `user-select: none` on <body>. The to-do checklist shows
// in the composer dock (outside the timeline) and in the plan panel, so it must
// opt back in itself, or its text can't be selected or copied.
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

function userSelectFor(selector: string): string | null {
  let value: string | null = null;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((part) => part.trim());
    if (!selectors.includes(selector)) continue;
    const declaration = (match[2] ?? '').match(/(?:^|[;\s])user-select:\s*([a-z-]+)/);
    if (declaration) value = declaration[1] ?? null;
  }
  return value;
}

describe('plan and to-do text selection', () => {
  it('keeps the checklist selectable wherever it renders', () => {
    expect(userSelectFor('.thread-todo-checklist')).toBe('text');
  });

  it('keeps the plan panel selectable', () => {
    expect(userSelectFor('.thread-plan-panel')).toBe('text');
  });

  it('body stays non-selectable so the opt-in is what makes the difference', () => {
    expect(userSelectFor('body')).toBe('none');
  });
});
