import { describe, expect, it, vi } from 'vitest';
import type { PluginAgentConfigureContext } from '@zana-ai/zcc-plugin-sdk/server';
import type { DocActor } from '../shared/contract.js';
import { panelDocId, registerPanelThreadLinks } from './panel-threads.js';
import { DesignDocStore } from './store.js';
import { TOOL_NAMES } from './tools.js';
import { createTestDatabase } from './test-db.js';

const user: DocActor = { kind: 'user', label: 'You', threadId: null };

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const changed = vi.fn();
  let configure: ((ctx: PluginAgentConfigureContext) => unknown) | undefined;
  registerPanelThreadLinks({ agents: { configure: (provider: typeof configure) => (configure = provider) } } as never, store, changed);
  const doc = store.create({ title: 'Offline sync', projectId: 'p1', template: 'blank' }, user);
  return { store, changed, doc, configure: configure! };
}

describe('panel thread links', () => {
  it('reads the doc id from the panel view', () => {
    expect(panelDocId({ panelAgent: { panel: 'design-docs', view: 'doc-1/api.md' } })).toBe('doc-1');
    expect(panelDocId({ panelAgent: { panel: 'design-docs', view: 'doc-1' } })).toBe('doc-1');
    expect(panelDocId({ panelAgent: { panel: 'design-docs' } })).toBeNull();
    expect(panelDocId({ panelAgent: ['doc-1'] })).toBeNull();
    expect(panelDocId({ panelAgent: { view: '' } })).toBeNull();
    expect(panelDocId({})).toBeNull();
    expect(panelDocId(undefined)).toBeNull();
  });

  it('links a conversation started beside a doc once, so an unlink sticks', () => {
    const { store, changed, doc, configure } = setup();
    const ctx = {
      threadId: 't1',
      thread: { id: 't1', title: ' Review the API ' },
      pluginMetadata: { panelAgent: { panel: 'design-docs', view: `${doc.id}/README.md` } }
    } as unknown as PluginAgentConfigureContext;
    expect(configure(ctx)).toEqual({ tools: [...TOOL_NAMES] });
    expect(store.get(doc.id).threads).toMatchObject([{ threadId: 't1', title: 'Review the API', role: 'assistant' }]);
    expect(changed).toHaveBeenCalledWith(doc.id);

    store.unlinkThread(doc.id, 't1');
    configure(ctx);
    expect(store.get(doc.id).threads).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('ignores threads without a doc binding or bound to a missing doc, still offering every tool', () => {
    const { store, changed, doc, configure } = setup();
    const all = { tools: [...TOOL_NAMES] };
    expect(configure({ threadId: 't1', pluginMetadata: {} } as PluginAgentConfigureContext)).toEqual(all);
    expect(configure({ pluginMetadata: { panelAgent: { view: doc.id } } } as unknown as PluginAgentConfigureContext)).toEqual(all);
    expect(configure({ threadId: 't2', pluginMetadata: { panelAgent: { view: 'gone' } } } as unknown as PluginAgentConfigureContext)).toEqual(all);
    expect(store.get(doc.id).threads).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });

  it('falls back to the agent label for an untitled thread', () => {
    const { store, doc, configure } = setup();
    configure({ threadId: 't3', pluginMetadata: { panelAgent: { view: doc.id } } } as unknown as PluginAgentConfigureContext);
    expect(store.get(doc.id).threads[0]).toMatchObject({ threadId: 't3', role: 'assistant' });
  });
});
