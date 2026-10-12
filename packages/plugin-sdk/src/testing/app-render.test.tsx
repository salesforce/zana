// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { definePluginApp, useRpc, useWindowTitle, useZccContext, useZccNavigate } from '../app.js';
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

function WindowPanel() {
  const navigate = useZccNavigate();
  const context = useZccContext();
  return (
    <button type="button" onClick={() => void navigate.openInWindow?.('p1', { tabId: 'studio' })}>
      {context.surface ?? 'no surface'}
    </button>
  );
}

function TitledPanel() {
  const [agent, setAgent] = useState<string | null>('Help');
  useWindowTitle(agent ? { title: `Agentforce · ${agent}`, badge: 'Production', tone: 'danger' } : null);
  return (
    <button type="button" onClick={() => setAgent(null)}>
      Close agent
    </button>
  );
}

function StackedPanel() {
  const [agent, setAgent] = useState('Help');
  const [dialog, setDialog] = useState(false);
  useWindowTitle({ title: `Agentforce · ${agent}` });
  return (
    <>
      <button type="button" onClick={() => setAgent('Orders')}>
        Switch agent
      </button>
      <button type="button" onClick={() => setDialog((open) => !open)}>
        Toggle dialog
      </button>
      {dialog ? <DialogTitle /> : null}
    </>
  );
}

function DialogTitle() {
  useWindowTitle({ title: 'Review publish' });
  return null;
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

  it('records openInWindow and passes the surface through context', async () => {
    const app = await loadPluginApp(() =>
      Promise.resolve(
        definePluginApp((pluginApp) => {
          pluginApp.slots.navPanel({ id: 'main', title: 'Notes', icon: 'FileText', component: WindowPanel });
        })
      )
    );
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' }, { context: { surface: 'plugin-view' } });
    slot.getByRole('button', { name: 'plugin-view' }).click();
    expect(slot.inspection.navigateCalls).toEqual([{ method: 'openInWindow', projectId: 'p1', options: { tabId: 'studio' } }]);
    slot.lifecycle.unmount();
    const plain = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' });
    expect(plain.getByRole('button', { name: 'no surface' })).toBeTruthy();
  });

  it('records the window title while it is mounted', async () => {
    const app = await loadPluginApp(() =>
      Promise.resolve(
        definePluginApp((pluginApp) => {
          pluginApp.slots.navPanel({ id: 'main', title: 'Notes', icon: 'FileText', component: TitledPanel });
        })
      )
    );
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' });
    expect(slot.inspection.windowTitle).toEqual({ title: 'Agentforce · Help', badge: 'Production', tone: 'danger' });
    act(() => slot.getByRole('button', { name: 'Close agent' }).click());
    expect(slot.inspection.windowTitle).toBeNull();
    slot.lifecycle.unmount();
    expect(slot.inspection.windowTitle).toBeNull();
  });

  it('keeps a nested window title on top while the outer one changes', async () => {
    const app = await loadPluginApp(() =>
      Promise.resolve(
        definePluginApp((pluginApp) => {
          pluginApp.slots.navPanel({ id: 'main', title: 'Notes', icon: 'FileText', component: StackedPanel });
        })
      )
    );
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' });
    act(() => slot.getByRole('button', { name: 'Toggle dialog' }).click());
    expect(slot.inspection.windowTitle).toEqual({ title: 'Review publish' });
    act(() => slot.getByRole('button', { name: 'Switch agent' }).click());
    expect(slot.inspection.windowTitle).toEqual({ title: 'Review publish' });
    act(() => slot.getByRole('button', { name: 'Toggle dialog' }).click());
    expect(slot.inspection.windowTitle).toEqual({ title: 'Agentforce · Orders' });
  });
});
