/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import app from '../app.js';

afterEach(() => {
  cleanup();
  delete (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__;
  delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
});

describe('memory settings', () => {
  const memories = [
    {
      id: 'mem_1',
      name: 'test-runner',
      scope: 'project',
      kind: 'procedure',
      summary: 'Run focused tests',
      details: 'pnpm exec vitest run plugins/memory',
      tags: ['tests'],
      importance: 80,
      pinned: true,
      version: 1
    }
  ];

  beforeEach(() => {
    (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__ = React;
  });

  function mount(overrides: {
    list?: () => unknown;
    update?: (input: unknown) => unknown;
    remove?: (input: unknown) => unknown;
  } = {}) {
    const rpcClient = {
      async call(method: string, input?: unknown) {
        if (method === 'listMemories') return overrides.list?.() ?? { memories };
        if (method === 'updateMemory') return overrides.update?.(input) ?? { memory: memories[0] };
        if (method === 'deleteMemory') return overrides.remove?.(input) ?? { deleted: { id: 'mem_1', version: 2 } };
        throw new Error(`unknown rpc ${method}`);
      }
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useRpc: () => rpcClient
    };
    const section = collectTestPluginApp(app, 'memory').settingsSections[0];
    if (!section) throw new Error('missing memory settings');
    return render(createElement(section.component, { pluginId: 'memory' }));
  }

  it('lists memories and edits a summary', async () => {
    const updates: unknown[] = [];
    const slot = mount({
      update: (input) => {
        updates.push(input);
        return { memory: { ...memories[0], summary: 'Updated' } };
      }
    });
    await slot.findByText('test-runner');
    fireEvent.click(slot.getByRole('button', { name: 'Edit' }));
    fireEvent.change(slot.getByLabelText('Memory summary'), { target: { value: 'Updated summary' } });
    fireEvent.click(slot.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updates[0]).toMatchObject({ id: 'mem_1', summary: 'Updated summary' }));
  });

  it('deletes a memory', async () => {
    const deleted: unknown[] = [];
    const slot = mount({
      list: () => ({ memories }),
      remove: (input) => {
        deleted.push(input);
        return { deleted: { id: 'mem_1', version: 2 } };
      }
    });
    await slot.findByText('test-runner');
    fireEvent.click(slot.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleted).toEqual([{ id: 'mem_1', expectedVersion: 1 }]));
  });

  it('shows load failures and an empty catalog', async () => {
    const failing = mount({
      list: () => {
        throw new Error('Could not load memories');
      }
    });
    await failing.findByRole('alert');
    expect(failing.getByRole('alert').textContent).toContain('Could not load memories');
    failing.unmount();
    const empty = mount({ list: () => ({ memories: [] }) });
    await empty.findByText('No memories stored yet.');
  });
});
