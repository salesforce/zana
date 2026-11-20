// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThreadTodoChecklist } from './thread-todo-checklist.js';
import { ThreadTodoCard } from './timeline/ThreadBanners.js';
import { ThreadPlanPanel } from './secondary-panel/ThreadPlanPanel.js';

// The app chrome sets `user-select: none` on <body>. The to-do checklist shows
// in the composer dock (outside the timeline) and in the plan panel, so it must
// opt back in itself, or its text can't be selected or copied.
// Comments sit between rules and would otherwise be parsed as part of a selector.
const COMMENT = /\/\*[\s\S]*?\*\//g;
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../styles/global.css'), 'utf8').replace(COMMENT, '');
const items = [{ id: 'a', text: 'Start items 94 and 96', status: 'pending' }];

afterEach(cleanup);

function rulesFor(selector: string): { selectors: string[]; value: string | null }[] {
  const rules = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((part) => part.trim());
    const declaration = (match[2] ?? '').match(/(?:^|[;\s])user-select:\s*([a-z-]+)/);
    if (selectors.some((part) => part === selector || part.startsWith(`${selector} `))) {
      rules.push({ selectors, value: declaration?.[1] ?? null });
    }
  }
  return rules;
}

function lastValue(selector: string): string | null {
  const values = rulesFor(selector).map((rule) => rule.value).filter((value) => value !== null);
  return values.at(-1) ?? null;
}

describe('plan and to-do text selection', () => {
  it('opts the checklist list in, and the components render that class', () => {
    const view = render(<ThreadTodoChecklist items={items} />);
    expect(view.container.querySelector('ul.thread-todo-checklist')).not.toBeNull();
    expect(lastValue('.thread-todo-checklist')).toBe('text');
    expect(rulesFor('.thread-todo-checklist').filter((rule) => rule.value === 'none')).toEqual([]);
  });

  it('mounts the composer to-do card around the same selectable checklist', () => {
    const todos = { sourceSeq: 1, updatedAt: 1, items };
    const view = render(<ThreadTodoCard todos={todos} isExpanded onToggle={() => undefined} />);
    expect(screen.getByTestId('thread-todos').classList.contains('thread-todo-card')).toBe(true);
    expect(view.container.querySelector('.thread-todo-card ul.thread-todo-checklist')).not.toBeNull();
    expect(lastValue('.thread-todo-checklist')).toBe('text');
  });

  it('opts the plan panel in and keeps its buttons as chrome', () => {
    const doc = { markdown: '# Plan', prompt: null, filePath: null, source: 'durable' as const };
    render(<ThreadPlanPanel document={doc} durablePlan={null} onImplement={() => undefined} />);
    expect(screen.getByTestId('thread-plan-panel').classList.contains('thread-plan-panel')).toBe(true);
    expect(rulesFor('.thread-plan-panel').find((rule) => rule.selectors.includes('.thread-plan-panel'))?.value).toBe('text');
    expect(lastValue('.thread-plan-panel button')).toBe('none');
  });

  it('body stays non-selectable so the opt-in is what makes the difference', () => {
    expect(lastValue('body')).toBe('none');
  });
});
