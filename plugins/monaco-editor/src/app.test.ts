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
  delete (globalThis as { __ZCC_MONACO__?: unknown }).__ZCC_MONACO__;
});

describe('monaco-editor file opener', () => {
  beforeEach(() => {
    (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__ = React;
  });

  function opener() {
    const registered = collectTestPluginApp(app, 'monaco-editor').fileOpeners[0];
    if (!registered) throw new Error('missing code opener');
    return registered;
  }

  function Original() {
    return createElement('div', { 'data-testid': 'original' }, 'host preview');
  }

  const source = {
    kind: 'workspace',
    threadId: 'thr_1',
    environmentId: null,
    projectId: 'p1'
  };

  it('falls back when RPC is missing', () => {
    const slot = render(
      createElement(opener().component, {
        path: 'src/hello.ts',
        source,
        experimental_Original: Original
      })
    );
    expect(slot.getByTestId('original').textContent).toBe('host preview');
  });

  it('falls back when the file cannot be edited here', async () => {
    const rpcClient = {
      async call(method: string, input?: { content?: string }) {
        if (method === 'read') {
          return { kind: 'unsupported', reason: 'This project has no local path' };
        }
        return input;
      }
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useRpc: () => rpcClient
    };
    const slot = render(
      createElement(opener().component, {
        path: 'src/hello.ts',
        source,
        experimental_Original: Original
      })
    );
    await waitFor(() => expect(slot.getByTestId('original')).toBeTruthy());
  });

  it('creates a host Monaco editor and saves on demand', async () => {
    let content = 'export const n = 1;\n';
    const commands: Array<() => void> = [];
    const rpcClient = {
      async call(method: string, input: { content?: string }) {
        if (method === 'read') {
          return { kind: 'text', content, sha256: 'abc' };
        }
        content = input.content ?? content;
        return { outcome: 'written', sha256: 'def' };
      }
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useRpc: () => rpcClient
    };
    (globalThis as { __ZCC_MONACO__?: unknown }).__ZCC_MONACO__ = {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { KeyS: 49 },
      editor: {
        create(_container: unknown, opts: { value: string }) {
          return {
            getValue: () => opts.value.replace('1', '2'),
            onDidChangeModelContent(listener: () => void) {
              setTimeout(listener, 0);
              return { dispose() {} };
            },
            addCommand(_id: number, fn: () => void) {
              commands.push(fn);
            },
            dispose() {}
          };
        }
      }
    };
    const slot = render(
      createElement(opener().component, {
        path: 'src/hello.ts',
        source,
        experimental_Original: Original
      })
    );
    const save = await slot.findByRole('button', { name: 'Save' });
    fireEvent.click(save);
    await waitFor(() => expect(slot.getByRole('button', { name: 'Saved' })).toBeTruthy());
    expect(content).toContain('n = 2');
    commands[0]?.();
  });

  it('shows editor load errors', async () => {
    const rpcClient = {
      async call() {
        throw new Error('read failed');
      }
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useRpc: () => rpcClient
    };
    const slot = render(
      createElement(opener().component, {
        path: 'src/hello.ts',
        source,
        experimental_Original: Original
      })
    );
    await slot.findByRole('alert');
    expect(slot.getByRole('alert').textContent).toContain('read failed');
  });
});
