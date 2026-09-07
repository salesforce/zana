/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import app from '../app.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__;
});

describe('pdf-preview file opener', () => {
  beforeEach(() => {
    (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__ = React;
  });

  function opener() {
    const registered = collectTestPluginApp(app, 'pdf-preview').fileOpeners[0];
    if (!registered) throw new Error('missing pdf opener');
    return registered;
  }

  function Original() {
    return createElement('div', { 'data-testid': 'original' }, 'host preview');
  }

  it('falls back to the host preview without a thread id', () => {
    const slot = render(
      createElement(opener().component, {
        path: 'docs/spec.pdf',
        source: { kind: 'workspace', threadId: null, environmentId: null, projectId: 'p1' },
        experimental_Original: Original
      })
    );
    expect(slot.getByTestId('original').textContent).toBe('host preview');
  });

  it('shows loading while the PDF is requested', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined))
    );
    const slot = render(
      createElement(opener().component, {
        path: 'docs/spec.pdf',
        source: { kind: 'workspace', threadId: 'thr_1', environmentId: null, projectId: 'p1' },
        experimental_Original: Original
      })
    );
    expect(slot.getByRole('status').textContent).toContain('Loading PDF');
  });

  it('shows a retryable error when the PDF request fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const slot = render(
      createElement(opener().component, {
        path: 'docs/spec.pdf',
        source: { kind: 'host', threadId: 'thr_1', environmentId: 'env', projectId: 'p1' },
        experimental_Original: Original
      })
    );
    await slot.findByRole('alert');
    expect(slot.getByRole('alert').textContent).toContain('status 500');
    fireEvent.click(slot.getByRole('button', { name: 'Retry' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
