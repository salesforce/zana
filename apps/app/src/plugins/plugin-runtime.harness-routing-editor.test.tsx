// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginSdkApp } from '@zana-ai/zcc-plugin-sdk/app';
import { experimental_HarnessRoutingEditor } from '@zana-ai/zcc-plugin-sdk/app';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { installPluginRuntime } from './plugin-runtime.js';

afterEach(() => {
  cleanup();
  delete (globalThis as { __ZCC_HOST_REACT__?: unknown }).__ZCC_HOST_REACT__;
  delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
});

const descriptor = {
  id: 'claude',
  label: 'Claude Code',
  agentDefaultEligible: true,
  availability: { enabled: true, installed: true },
  configFiles: [],
  targets: {
    providers: [],
    providerModelRelationship: 'none',
    models: [{ id: 'sonnet', label: 'Sonnet', level: 'balanced' }],
    executionStateMapping: { plan: 'plan' }
  }
} as unknown as HarnessAdapterDescriptor;

describe('experimental_HarnessRoutingEditor', () => {
  beforeEach(() => {
    (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__ = React;
    installPluginRuntime();
  });

  it('registers the host implementation on the plugin runtime', () => {
    const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
    expect(typeof runtime.experimental_HarnessRoutingEditor).toBe('function');
  });

  it('renders the core editor from the SDK export with the plugin props', () => {
    const onChange = vi.fn();
    render(createElement(experimental_HarnessRoutingEditor, {
      descriptors: [descriptor],
      value: undefined,
      onChange,
      inheritLabel: 'Use project default'
    }));
    expect(screen.getByText('Claude Code')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Project settings for Claude Code'));
    expect(screen.getByText('Launch and routing settings affect Zana-created sessions only.')).toBeTruthy();
  });

  it('passes the plugin harness choice through to the core editor', () => {
    // Picking is covered by the core editor's own test; this proves the prop crosses the SDK seam.
    const props = { descriptors: [descriptor], value: undefined, onChange: vi.fn() };
    const { unmount } = render(createElement(experimental_HarnessRoutingEditor, props));
    expect(screen.queryByRole('button', { name: /Default harness/ })).toBeNull();
    unmount();
    render(createElement(experimental_HarnessRoutingEditor, { ...props, defaultHarness: { value: 'claude', onChange: vi.fn() } }));
    expect(screen.getByRole('button', { name: /Default harness/ })).toBeTruthy();
  });

  it('renders nothing when the host runtime is not installed', () => {
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
    const { container } = render(createElement(experimental_HarnessRoutingEditor, {
      descriptors: [descriptor],
      value: undefined,
      onChange: vi.fn()
    }));
    expect(container.innerHTML).toBe('');
  });

  it('hides rows while loading', () => {
    render(createElement(experimental_HarnessRoutingEditor, {
      descriptors: [descriptor],
      value: undefined,
      onChange: vi.fn(),
      loading: true
    }));
    expect(screen.queryByText('Claude Code')).toBeNull();
  });
});
