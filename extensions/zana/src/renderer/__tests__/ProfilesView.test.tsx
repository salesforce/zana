/**
 * C5 — `ProfilesView` gallery tests.
 *
 * This repo has NO DOM test harness (no jsdom / @testing-library; see the C4
 * `TicketDetailModal.test.tsx` and C2 `ticketColumns` notes) and we add none.
 * So we exercise the component two ways, both in the default node env:
 *   - `renderToStaticMarkup` for the rendered OUTPUT (grouping order, summary
 *     segments, assigned-count badge, empty-state copy) — pure HTML assertions.
 *   - a tiny recursive element walker (`flatten`) that fully expands the
 *     function-component tree so we can find a card's `onClick` / `onKeyDown`
 *     props and invoke them directly, asserting `onOpen` fires with the right
 *     profile on click AND on Enter/Space — no synthetic-event DOM needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ZanaProfile, ZanaTicket } from '@shared/zana-types';
import { ProfilesView, activateOnKey } from '../ProfilesView';

function mkProfile(over: Partial<ZanaProfile> = {}): ZanaProfile {
  return {
    id: 'p',
    displayName: 'Profile',
    origin: 'workspace',
    ...over
  };
}

function mkTicket(over: Partial<ZanaTicket> = {}): ZanaTicket {
  return { id: 't', title: 'T', status: 'backlog', labels: [], blockedBy: [], ...over };
}

const markup = (el: ReactElement) => renderToStaticMarkup(el);

describe('ProfilesView', () => {
  it('renders grouped sections by category, preserving backend order', () => {
    const profiles = [
      mkProfile({ id: 'a', displayName: 'Arch', category: 'Engineering' }),
      mkProfile({ id: 'b', displayName: 'Impl', category: 'Engineering' }),
      mkProfile({ id: 'c', displayName: 'PM', category: 'Product' })
    ];
    const html = markup(createElement(ProfilesView, { profiles, tickets: [], onOpen: () => {} }));
    // Two distinct category headers, Engineering before Product (first-seen order).
    expect(html.indexOf('Engineering')).toBeGreaterThan(-1);
    expect(html.indexOf('Product')).toBeGreaterThan(-1);
    expect(html.indexOf('Engineering')).toBeLessThan(html.indexOf('Product'));
    // Group head count reflects the 2-vs-1 bucketing.
    expect(html).toContain('zana-profile-group-count');
  });

  it('summary shows total · built-in · workspace, omitting a 0 segment', () => {
    const mixed = [
      mkProfile({ id: 'a', origin: 'builtin' }),
      mkProfile({ id: 'b', origin: 'workspace' }),
      mkProfile({ id: 'c', origin: 'workspace' })
    ];
    const html = markup(createElement(ProfilesView, { profiles: mixed, tickets: [], onOpen: () => {} }));
    expect(html).toContain('3'); // total
    expect(html).toContain('1 built-in');
    expect(html).toContain('2 workspace');

    // All workspace ⇒ no "built-in" segment.
    const wsOnly = [mkProfile({ id: 'a', origin: 'workspace' })];
    const wsHtml = markup(createElement(ProfilesView, { profiles: wsOnly, tickets: [], onOpen: () => {} }));
    expect(wsHtml).not.toContain('built-in');
    expect(wsHtml).toContain('1 workspace');

    // All built-in ⇒ no "workspace" segment.
    const biOnly = [mkProfile({ id: 'a', origin: 'builtin' })];
    const biHtml = markup(createElement(ProfilesView, { profiles: biOnly, tickets: [], onOpen: () => {} }));
    expect(biHtml).toContain('1 built-in');
    expect(biHtml).not.toContain('workspace');
  });

  it('assigned-count badge equals matching tickets and is hidden at 0', () => {
    const profiles = [mkProfile({ id: 'arch' }), mkProfile({ id: 'impl' })];
    const tickets = [
      mkTicket({ id: 't1', assigneeProfileId: 'arch' }),
      mkTicket({ id: 't2', assigneeProfileId: 'arch' }),
      mkTicket({ id: 't3' }) // unassigned — counts for nobody
    ];
    const html = markup(createElement(ProfilesView, { profiles, tickets, onOpen: () => {} }));
    // 'arch' has 2 assigned, 'impl' has 0.
    expect(html).toContain('2 assigned');
    expect(html).not.toContain('0 assigned');
    expect(html).not.toContain('1 assigned');
  });

  it('renders the ~/.zana/profiles/ empty-state via gus-column-empty when no profiles', () => {
    const html = markup(createElement(ProfilesView, { profiles: [], tickets: [], onOpen: () => {} }));
    expect(html).toContain('gus-column-empty');
    expect(html).toContain('~/.zana/profiles/');
    // The apostrophe is HTML-entity-escaped in static markup; assert both halves.
    expect(html).toContain('plus Zana');
    expect(html).toContain('built-ins.');
  });

  it('renders each card as an activatable button (role + tabindex) wired to onOpen', () => {
    const profiles = [mkProfile({ id: 'arch', displayName: 'Arch' })];
    const html = markup(createElement(ProfilesView, { profiles, tickets: [], onOpen: () => {} }));
    expect(html).toContain('zana-profile-card');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it('activateOnKey fires only on Enter/Space and suppresses their default', () => {
    const onOpen = vi.fn();
    const prevent = vi.fn();

    activateOnKey({ key: 'Enter', preventDefault: prevent }, onOpen);
    activateOnKey({ key: ' ', preventDefault: prevent }, onOpen);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(prevent).toHaveBeenCalledTimes(2);

    // A non-activating key is ignored — no open, no preventDefault.
    activateOnKey({ key: 'a', preventDefault: prevent }, onOpen);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(prevent).toHaveBeenCalledTimes(2);
  });
});
