/**
 * C3 — `SprintsList` sub-tab tests.
 *
 * Same zero-DOM strategy as the C5 `ProfilesView.test.tsx`: `renderToStaticMarkup`
 * for rendered OUTPUT, and a recursive element walker (`flatten`) to find the
 * sprint row's `onClick` and invoke it directly (asserting `onOpenSprint` fires
 * with the row's id) — no jsdom / @testing-library added.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ZanaSprint } from '@shared/zana-types';
import { SprintsList } from '../SprintsList';

function mkSprint(over: Partial<ZanaSprint> = {}): ZanaSprint {
  return { id: 's1', ...over };
}

const markup = (el: ReactElement) => renderToStaticMarkup(el);

/** Recursively expand a function-component tree into a flat element list. */
function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (!isValidElement(n)) return;
    out.push(n);
    const el = n as ReactElement<{ children?: ReactNode }>;
    const type = el.type;
    if (typeof type === 'function') {
      // Render the function component one level and recurse into its output.
      const rendered = (type as (p: unknown) => ReactNode)(el.props);
      visit(rendered);
    } else {
      visit(el.props?.children);
    }
  };
  visit(node);
  return out;
}

describe('SprintsList', () => {
  it('renders N open / N total counts and a gus-chip status per sprint', () => {
    const sprints = [
      mkSprint({ id: 'a', name: 'Alpha', status: 'active', openCount: 3, ticketCount: 7 })
    ];
    const html = markup(createElement(SprintsList, { sprints, onOpenSprint: () => {} }));
    expect(html).toContain('Alpha');
    expect(html).toContain('3 open');
    expect(html).toContain('7 total');
    expect(html).toContain('gus-chip');
    expect(html).toContain('active');
  });

  it('defaults missing counts to 0 (openCount ?? 0 / ticketCount ?? 0)', () => {
    const sprints = [mkSprint({ id: 'a', name: 'Bare' })];
    const html = markup(createElement(SprintsList, { sprints, onOpenSprint: () => {} }));
    expect(html).toContain('0 open');
    expect(html).toContain('0 total');
  });

  it('shows the RAW synthetic name (resolveSprintName is NOT applied here)', () => {
    // A synthetic `Sprint <hash>` name must render verbatim — the Sprints list
    // deliberately does not suppress it (that is a ticket-card concern).
    const sprints = [mkSprint({ id: 'abcdef1234', name: 'Sprint abcdef12' })];
    const html = markup(createElement(SprintsList, { sprints, onOpenSprint: () => {} }));
    expect(html).toContain('Sprint abcdef12');
  });

  it('falls back to shortId(s.id) when a sprint has no name', () => {
    const sprints = [mkSprint({ id: 'abcdefghij' })]; // > 8 chars ⇒ clipped
    const html = markup(createElement(SprintsList, { sprints, onOpenSprint: () => {} }));
    expect(html).toContain('abcdefgh');
  });

  it('renders the No sprints. empty state when there are none', () => {
    const html = markup(createElement(SprintsList, { sprints: [], onOpenSprint: () => {} }));
    expect(html).toContain('gus-column-empty');
    expect(html).toContain('No sprints.');
  });

  it('clicking a sprint row calls onOpenSprint with the sprint id', () => {
    const onOpenSprint = vi.fn();
    const sprints = [mkSprint({ id: 'sprint-42', name: 'Forty-two' })];
    const els = flatten(createElement(SprintsList, { sprints, onOpenSprint }));
    const row = els.find(
      (e) => typeof e.type === 'string' && (e.props as { className?: string }).className === 'zana-sprint-row'
    );
    expect(row).toBeTruthy();
    (row!.props as { onClick: () => void }).onClick();
    expect(onOpenSprint).toHaveBeenCalledTimes(1);
    expect(onOpenSprint).toHaveBeenCalledWith('sprint-42');
  });
});
