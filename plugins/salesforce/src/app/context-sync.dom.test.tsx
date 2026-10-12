/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CONTEXT_CHANGED_CHANNEL } from '../../lib/studio-contract.js';
import { CONTEXT_CHANGED_EVENT, CONTEXT_ORIGIN, announceContextChanged, relayContextChange, useContextChangeRelay } from './context-sync.js';

const heard = vi.fn();
const listen = (event: Event) => heard((event as CustomEvent<{ projectId: string | null }>).detail.projectId);
beforeEach(() => { heard.mockReset(); window.addEventListener(CONTEXT_CHANGED_EVENT, listen); });
afterEach(() => { cleanup(); window.removeEventListener(CONTEXT_CHANGED_EVENT, listen); delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });

it('names this window with an origin the server accepts', () => {
  expect(CONTEXT_ORIGIN).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
});

it('announces a change in this window', () => {
  announceContextChanged('p1');
  announceContextChanged(null);
  expect(heard.mock.calls).toEqual([['p1'], [null]]);
});

it("relays another window's change once and skips this window's own echo", () => {
  expect(relayContextChange({ projectId: 'p1', changeId: 'c1', origin: 'other' })).toBe(true);
  expect(relayContextChange({ projectId: 'p1', changeId: 'c1', origin: 'other' })).toBe(false);
  expect(relayContextChange({ projectId: 'p1', changeId: 'c2', origin: CONTEXT_ORIGIN })).toBe(false);
  expect(relayContextChange({ projectId: 7, changeId: 'c3' })).toBe(true);
  expect(relayContextChange({ projectId: 'p2' })).toBe(true);
  for (const bad of [null, 'p1', 3]) expect(relayContextChange(bad)).toBe(false);
  expect(heard.mock.calls).toEqual([['p1'], [null], ['p2']]);
});

it('remembers a bounded number of relayed changes', () => {
  for (let i = 0; i < 40; i += 1) relayContextChange({ projectId: 'p', changeId: `cap-${i}` });
  heard.mockReset();
  // The oldest ids fell out of the window; recent ones still dedupe.
  expect(relayContextChange({ projectId: 'p', changeId: 'cap-0' })).toBe(true);
  expect(relayContextChange({ projectId: 'p', changeId: 'cap-39' })).toBe(false);
});

it('subscribes to the context channel', () => {
  const channels: string[] = [];
  let handler: ((payload: unknown) => void) | undefined;
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = { useRealtime: (channel: string, next: (payload: unknown) => void) => { channels.push(channel); handler = next; } };
  function Surface() { useContextChangeRelay(); return null; }
  render(<Surface />);
  expect(channels[0]).toBe(CONTEXT_CHANGED_CHANNEL);
  handler!({ projectId: 'p9', changeId: 'hook-1', origin: 'main' });
  expect(heard).toHaveBeenCalledWith('p9');
});
