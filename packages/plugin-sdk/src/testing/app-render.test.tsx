// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { definePluginApp, useRpc, useWindowTitle, useZccContext, useZccDeepLinks, useZccNavigate } from '../app.js';
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

function ToolPanel() {
  const navigate = useZccNavigate();
  const context = useZccContext();
  const [shown, setShown] = useState<boolean | null>(null);
  return (
    <>
      <button type="button" onClick={() => setShown(navigate.openPanelTool?.({ actionId: 'graph' }) ?? null)}>
        Open tool
      </button>
      <output>{`${String(context.sidePanel)}:${shown === null ? '' : String(shown)}`}</output>
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

  it('reports whether the page has a side panel for its tools', async () => {
    const app = await loadPluginApp(() =>
      Promise.resolve(
        definePluginApp((pluginApp) => {
          pluginApp.slots.navPanel({ id: 'main', title: 'Notes', icon: 'FileText', component: ToolPanel });
        })
      )
    );
    for (const [options, expected] of [
      [{}, 'undefined:false'],
      [{ panelTools: true }, 'true:true'],
      [{ context: { projectId: null, threadId: null, sidePanel: false } }, 'false:false']
    ] as const) {
      const slot = renderSlot(app.navPanels[0]!, { pluginId: 'notes', subPath: '' }, options);
      act(() => slot.getByRole('button', { name: 'Open tool' }).click());
      expect(slot.getByRole('status').textContent).toBe(expected);
      expect(slot.inspection.navigateCalls).toEqual([{ method: 'openPanelTool', options: { actionId: 'graph' } }]);
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

function LinkPanel() {
  const links = useZccDeepLinks();
  const [seen, setSeen] = useState<string>('none');
  const [opened, setOpened] = useState('');
  useEffect(() => links.on('join', (payload) => setSeen(String(payload))), [links]);
  return (
    <>
      <output data-testid="base">{String(links.base())}</output>
      <output data-testid="seen">{seen}</output>
      <button type="button" onClick={() => void links.open('x://plugin/a/b').then((r) => setOpened(JSON.stringify(r)))}>
        open
      </button>
      <output data-testid="opened">{opened}</output>
    </>
  );
}

describe('deep links in the test harness', () => {
  it('reports the base, delivers emitted links to handlers, and records open calls', async () => {
    const view = renderSlot({ component: LinkPanel }, {}, { deepLinkOpenResult: { ok: true, pluginId: 'a', route: 'b' } });
    expect(view.getByTestId('base').textContent).toBe('zana-test://');
    act(() => view.emitDeepLink('join', 'tok'));
    expect(view.getByTestId('seen').textContent).toBe('tok');
    act(() => view.emitDeepLink('join'));
    expect(view.getByTestId('seen').textContent).toBe('null');
    await act(async () => view.getByText('open').click());
    expect(view.inspection.deepLinkOpenCalls).toEqual(['x://plugin/a/b']);
    expect(view.getByTestId('opened').textContent).toBe('{"ok":true,"pluginId":"a","route":"b"}');
  });

  it('stops delivering after unmount and honours a null base', () => {
    const view = renderSlot({ component: LinkPanel }, {}, { deepLinkBase: null });
    expect(view.getByTestId('base').textContent).toBe('null');
    view.lifecycle.unmount();
    expect(() => view.emitDeepLink('join', 'late')).not.toThrow();
  });

  it('defaults open to unavailable', async () => {
    const view = renderSlot({ component: LinkPanel }, {});
    await act(async () => view.getByText('open').click());
    expect(view.getByTestId('opened').textContent).toBe('{"ok":false,"reason":"unavailable"}');
  });
});

describe('useZccDeepLinks without a host runtime', () => {
  it('is inert so plugins can call it on older hosts', async () => {
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
    const links = useZccDeepLinks();
    expect(links.base()).toBeNull();
    expect(links.on('join', () => undefined)()).toBeUndefined();
    await expect(links.open('x')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});
