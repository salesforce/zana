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

describe('custom instructions settings', () => {
  const rpcCalls: Array<{ method: string; input?: unknown }> = [];

  beforeEach(() => {
    rpcCalls.length = 0;
    (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__ = React;
  });

  function mount(rpc: {
    getInstructions: () => unknown;
    saveInstructions: (input: unknown) => unknown;
  }) {
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: { useRpc: () => { call: (method: string, args?: unknown) => Promise<unknown> } } }).__ZCC_PLUGIN_RUNTIME__ = {
      useRpc: () => ({
        async call(method: string, args?: unknown) {
          rpcCalls.push({ method, input: args });
          if (method === 'getInstructions') return rpc.getInstructions();
          if (method === 'saveInstructions') return rpc.saveInstructions(args);
          throw new Error(`unknown rpc ${method}`);
        }
      })
    };
    const section = collectTestPluginApp(app, 'custom-instructions').settingsSections[0];
    if (!section) throw new Error('missing settings section');
    return render(createElement(section.component, { pluginId: 'custom-instructions' }));
  }

  it('uses the plugin page header instead of declaring a second title', () => {
    expect(
      collectTestPluginApp(app, 'custom-instructions').settingsSections[0]?.title
    ).toBeUndefined();
  });

  it('uses the host settings textarea class so Chromium does not paint a white native control', async () => {
    const slot = mount({
      getInstructions: () => ({ instructions: '', maxLength: 4096 }),
      saveInstructions: () => ({ instructions: '', maxLength: 4096 })
    });
    const textarea = (await slot.findByLabelText('Custom instructions')) as HTMLTextAreaElement;
    expect(textarea.className).toBe('settings-textarea');
  });

  it('loads and autosaves only the latest debounced instructions', async () => {
    const slot = mount({
      getInstructions: () => ({
        instructions: 'Use concise answers.',
        maxLength: 4096
      }),
      saveInstructions: (input) => ({
        instructions: (input as { instructions: string }).instructions,
        maxLength: 4096
      })
    });

    const textarea = (await slot.findByLabelText('Custom instructions')) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('Use concise answers.'));

    expect(slot.queryByRole('button', { name: 'Save' })).toBeNull();

    fireEvent.change(textarea, { target: { value: 'Always run' } });
    fireEvent.change(textarea, { target: { value: 'Always run focused tests.' } });
    expect(slot.getByRole('status').textContent).toBe('Saving…');

    await waitFor(() =>
      expect(rpcCalls).toContainEqual({
        method: 'saveInstructions',
        input: { instructions: 'Always run focused tests.' }
      })
    );
    expect(
      rpcCalls.some(
        (call) =>
          call.method === 'saveInstructions' &&
          (call.input as { instructions?: unknown }).instructions === 'Always run'
      )
    ).toBe(false);
    await waitFor(() => expect(slot.getByRole('status').textContent).toBe('Saved'));
  });

  it('shows save failures without losing the draft', async () => {
    const slot = mount({
      getInstructions: () => ({ instructions: '', maxLength: 4096 }),
      saveInstructions: () => {
        throw new Error('Could not save instructions');
      }
    });
    const textarea = (await slot.findByLabelText('Custom instructions')) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Keep this draft' } });

    await slot.findByRole('alert');
    expect(slot.getByRole('alert').textContent).toContain('Could not save instructions');
    expect(textarea.value).toBe('Keep this draft');
  });

  it('shows load failures', async () => {
    const slot = mount({
      getInstructions: () => {
        throw new Error('Could not load instructions');
      },
      saveInstructions: () => ({ instructions: '', maxLength: 4096 })
    });
    await slot.findByRole('alert');
    expect(slot.getByRole('alert').textContent).toContain('Could not load instructions');
  });

  it('retries autosave after a failed write and fills missing RPC fields', async () => {
    let shouldFail = true;
    const slot = mount({
      getInstructions: () => ({}),
      saveInstructions: (input) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('transient');
        }
        return { instructions: (input as { instructions: string }).instructions };
      }
    });
    const textarea = (await slot.findByLabelText('Custom instructions')) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe(''));
    fireEvent.change(textarea, { target: { value: 'first' } });
    await slot.findByRole('alert');
    fireEvent.change(textarea, { target: { value: 'second' } });
    await waitFor(() => expect(slot.getByRole('status').textContent).toBe('Saved'));
    expect(textarea.value).toBe('second');
  });
});
