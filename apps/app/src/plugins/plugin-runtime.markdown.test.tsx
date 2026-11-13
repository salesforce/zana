/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
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
