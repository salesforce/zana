// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { nextLivePluginTabIds, PluginTabDeck } from './PluginTabDeck.js';
import type { ClosableSecondaryTab } from './threadSecondaryPanelState.js';

const tab = (id: string, extra: Partial<ClosableSecondaryTab> = {}): ClosableSecondaryTab => ({
  id, kind: 'plugin', title: id, moduleId: 'm', actionId: 'a', ...extra
});

describe('nextLivePluginTabIds', () => {
  it('mounts only tabs that were active and puts the active one first', () => {
    expect(nextLivePluginTabIds([], ['a', 'b'], 'a')).toEqual(['a']);
    expect(nextLivePluginTabIds(['a'], ['a', 'b'], 'b')).toEqual(['b', 'a']);
  });
  it('keeps hidden tabs while a non-plugin tab is active and drops closed ones', () => {
    expect(nextLivePluginTabIds(['b', 'a'], ['a', 'b'], 'terminal:1')).toEqual(['b', 'a']);
    expect(nextLivePluginTabIds(['b', 'a'], ['a'], null)).toEqual(['a']);
  });
  it('evicts the least recently active hidden tabs past the cap', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    let live: string[] = [];
    for (const id of ids) live = nextLivePluginTabIds(live, ids, id, 2);
    expect(live).toEqual(['f', 'e', 'd']);
    expect(nextLivePluginTabIds(live, ids, 'x', 2)).toEqual(['f', 'e']);
  });
});

describe('PluginTabDeck', () => {
  afterEach(cleanup);
  const renderTab = (t: ClosableSecondaryTab, active: boolean) => <span data-testid={`body-${t.id}`}>{String(active)}</span>;

  it('hides inactive tabs but keeps them mounted across a switch', () => {
    const tabs = [tab('a'), tab('b')];
    const view = render(<PluginTabDeck tabs={tabs} activeId="a" ownerId="o" render={renderTab} />);
    const first = screen.getByTestId('body-a');
    view.rerender(<PluginTabDeck tabs={tabs} activeId="b" ownerId="o" render={renderTab} />);
    expect(screen.getByTestId('body-a')).toBe(first);
    expect(screen.getByTestId('body-a').textContent).toBe('false');
    expect(screen.getByTestId('body-a').parentElement!.hidden).toBe(true);
    expect(screen.getByTestId('body-b').parentElement!.hidden).toBe(false);
  });

  it('keeps hidden tabs mounted while a non-plugin tab is active, unmounts on close', () => {
    const tabs = [tab('a'), { id: 'terminal:1', kind: 'terminal' as const, title: 'T' }];
    const view = render(<PluginTabDeck tabs={tabs} activeId="a" ownerId="o" render={renderTab} />);
    view.rerender(<PluginTabDeck tabs={tabs} activeId="terminal:1" ownerId="o" render={renderTab} />);
    expect(screen.getByTestId('body-a').parentElement!.hidden).toBe(true);
    view.rerender(<PluginTabDeck tabs={[tabs[1]!]} activeId="terminal:1" ownerId="o" render={renderTab} />);
    expect(screen.queryByTestId('body-a')).toBeNull();
  });

  it('evicts past the cap and resets on a new owner', () => {
    const tabs = [tab('a'), tab('b'), tab('c')];
    const view = render(<PluginTabDeck tabs={tabs} activeId="a" ownerId="o" cap={1} render={renderTab} />);
    view.rerender(<PluginTabDeck tabs={tabs} activeId="b" ownerId="o" cap={1} render={renderTab} />);
    view.rerender(<PluginTabDeck tabs={tabs} activeId="c" ownerId="o" cap={1} render={renderTab} />);
    expect(screen.queryByTestId('body-a')).toBeNull();
    expect(screen.getByTestId('body-b')).toBeTruthy();
    view.rerender(<PluginTabDeck tabs={tabs} activeId="c" ownerId="other" cap={1} render={renderTab} />);
    expect(screen.queryByTestId('body-b')).toBeNull();
    expect(screen.getByTestId('body-c')).toBeTruthy();
  });

  it('skips tabs the layout does not accept or that lack a module', () => {
    const tabs = [tab('a', { moduleId: 'other' }), tab('b'), tab('c', { moduleId: undefined })];
    render(<PluginTabDeck tabs={tabs} activeId="b" ownerId="o" accepts={(t) => t.moduleId === 'm'} render={renderTab} />);
    expect(screen.queryByTestId('body-a')).toBeNull();
    expect(screen.queryByTestId('body-c')).toBeNull();
    expect(screen.getByTestId('body-b')).toBeTruthy();
  });
});
