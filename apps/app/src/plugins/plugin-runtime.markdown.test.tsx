/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginSdkApp } from '@zana-ai/zcc-plugin-sdk/app';
import { installPluginRuntime } from './plugin-runtime.js';

afterEach(cleanup);

it('plugin Markdown leaves file-like links as anchors for the plugin to resolve', () => {
  installPluginRuntime();
  const { Markdown } = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
  const { container } = render(<Markdown content="[x](diagrams/architecture.mmd)" className="doc" />);
  expect(container.querySelector('.doc a')?.getAttribute('href')).toBe('diagrams/architecture.mmd');
  expect(screen.queryByRole('button', { name: 'x' })).toBeNull();
});

it('uses the shared formatted editor for a named field and keeps existing Markdown intact until edited', async () => {
  installPluginRuntime();
  const { Markdown } = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
  const editor = { label: 'Role', onChange: vi.fn() };
  const content = '## Goals\n\n- Help **people**';
  const view = render(<Markdown content={content} editor={editor} />);
  const field = await screen.findByRole('textbox', { name: 'Role' });
  expect(field.querySelector('h2')?.textContent).toBe('Goals');
  expect(field.querySelector('li strong')?.textContent).toBe('people');
  expect(screen.getByRole('button', { name: 'Bold' }).hasAttribute('disabled')).toBe(false);
  expect(editor.onChange).not.toHaveBeenCalled();
  view.rerender(<Markdown content="Replacement" editor={{ ...editor, disabled: true }} />);
  expect(field.textContent).toBe('Replacement');
  expect(field.getAttribute('contenteditable')).toBe('false');
  expect(screen.getByRole('button', { name: 'Bold' }).hasAttribute('disabled')).toBe(true);
});
