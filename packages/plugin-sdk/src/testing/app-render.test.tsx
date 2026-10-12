// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { definePluginApp, useRpc, useZccNavigate } from '../app.js';
import { loadPluginApp, renderSlot } from './app-render.js';

afterEach(() => {
  cleanup();
});

function ListPanel() {
  const rpc = useRpc();
  const [label, setLabel] = useState('loading');
  useEffect(() => {
    void rpc
      .call('list')
      .then((value) => setLabel(JSON.stringify(value)))
      .catch((err: unknown) => setLabel(err instanceof Error ? err.message : String(err)));
  }, [rpc]);
  return <div>{label}</div>;
}

function NavPanel() {
  const navigate = useZccNavigate();
  const [shown, setShown] = useState<boolean | null>(null);
  return (
    <>
      <button type="button" onClick={() => navigate.toThread('t1')}>
        Open thread
      </button>
      <button type="button" onClick={() => setShown(navigate.openPanelAgent({ threadId: 't2' }))}>
        Open agent
      </button>
      <output>{shown === null ? '' : String(shown)}</output>
    </>
  );
}

describe('loadPluginApp + renderSlot', () => {
  it('installs the runtime before the app module evaluates', async () => {
    const app = await loadPluginApp(
      () =>
        Promise.resolve(
          definePluginApp((pluginApp) => {
            pluginApp.slots.navPanel({
              id: 'main',
              title: 'Notes',
              icon: 'FileText',
              component: ListPanel
            });
          })
        ),
      'notes'
    );
    expect(app.navPanels[0]?.title).toBe('Notes');
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' }, {
      rpc: { list: () => [{ title: 'Milk' }] }
    });
    await slot.findByText('[{"title":"Milk"}]');
    expect(slot.inspection.rpcCalls).toEqual([{ method: 'list', input: null }]);
  });

  it('throws a named error when rpc is missing', async () => {
    const app = await loadPluginApp(() =>
      Promise.resolve(
        definePluginApp((pluginApp) => {
          pluginApp.slots.navPanel({
            id: 'main',
            title: 'Notes',
            icon: 'FileText',
            component: ListPanel
          });
        })
      )
    );
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' });
    await slot.findByText('no rpc handler for "list" — add it to renderSlot options.rpc');
  });

  it('records navigate calls', async () => {
    const app = await loadPluginApp(() =>
      Promise.resolve(
        definePluginApp((pluginApp) => {
          pluginApp.slots.navPanel({
            id: 'main',
            title: 'Notes',
            icon: 'FileText',
            component: NavPanel
          });
        })
      )
    );
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' });
    slot.getByRole('button', { name: 'Open thread' }).click();
    expect(slot.inspection.navigateCalls).toEqual([{ method: 'toThread', threadId: 't1' }]);
    slot.lifecycle.unmount();
  });

  it('reports whether the page has a side panel for agents', async () => {
    const app = await loadPluginApp(() =>
      Promise.resolve(
        definePluginApp((pluginApp) => {
          pluginApp.slots.navPanel({ id: 'main', title: 'Notes', icon: 'FileText', component: NavPanel });
        })
      )
    );
    for (const panelAgent of [undefined, true]) {
      const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' }, { panelAgent });
      act(() => slot.getByRole('button', { name: 'Open agent' }).click());
      expect(slot.getByRole('status').textContent).toBe(String(panelAgent === true));
      expect(slot.inspection.navigateCalls).toEqual([{ method: 'openPanelAgent', options: { threadId: 't2' } }]);
      slot.lifecycle.unmount();
      cleanup();
    }
  });
});
