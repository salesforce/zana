/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { PluginHubIncludes } from './PluginHubIncludes.js';
import { clearPluginSlots, interpretPluginApp } from '@/plugins/plugin-slots';

afterEach(() => {
  cleanup();
  clearPluginSlots('hello');
});

describe('PluginHubIncludes', () => {
  it('lists live slots, skills, CLI, and MCP for a plugin', () => {
    interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.navPanel({
          id: 'main',
          title: 'Hello',
          icon: 'Puzzle',
          path: 'hello',
          component: () => null
        });
      })
    );
    const plugin: PluginAppEntry = {
      id: 'hello',
      name: 'Hello',
      description: '',
      icon: 'Puzzle',
      enabled: true,
      provenance: 'direct',
      status: 'running',
      appUrl: null,
      skillNames: ['hello'],
      cliNames: ['hello'],
      mcpServers: [{ name: 'hello-mcp', type: 'stdio' }]
    };
    render(
      <MemoryRouter>
        <PluginHubIncludes plugin={plugin} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('plugin-includes')).toBeTruthy();
    expect(screen.getByText('Sidebar panels (1)')).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText(/zcc hello/)).toBeTruthy();
    expect(screen.getByText(/hello-mcp/)).toBeTruthy();
  });

  it('labels extensions-placed navPanels as hub pages', () => {
    interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.navPanel({
          id: 'main',
          title: 'Hello',
          icon: 'Puzzle',
          path: 'hello',
          placement: 'extensions',
          component: () => null
        });
      })
    );
    const plugin: PluginAppEntry = {
      id: 'hello',
      name: 'Hello',
      description: '',
      icon: 'Puzzle',
      enabled: true,
      provenance: 'direct',
      status: 'running',
      appUrl: null
    };
    render(
      <MemoryRouter>
        <PluginHubIncludes plugin={plugin} />
      </MemoryRouter>
    );
    expect(screen.getByText('Plugins hub pages (1)')).toBeTruthy();
    expect(screen.queryByText('Sidebar panels (1)')).toBeNull();
  });

  it('lists Agents board slot contributions', () => {
    interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.experimental_agentCardAction({
          id: 'card',
          title: 'Card',
          run: () => undefined
        });
        app.slots.experimental_agentsBoardAction({
          id: 'board',
          title: 'Board',
          run: () => undefined
        });
      })
    );
    const plugin: PluginAppEntry = {
      id: 'hello',
      name: 'Hello',
      description: '',
      icon: 'Puzzle',
      enabled: true,
      provenance: 'direct',
      status: 'running',
      appUrl: null
    };
    render(
      <MemoryRouter>
        <PluginHubIncludes plugin={plugin} />
      </MemoryRouter>
    );
    expect(screen.getByText('Agent card actions (1)')).toBeTruthy();
    expect(screen.getByText('Agents board actions (1)')).toBeTruthy();
  });

  it('lists side-panel tabs', () => {
    interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.threadPanelAction({
          id: 'board',
          title: 'Board',
          component: () => null
        });
      })
    );
    const plugin: PluginAppEntry = {
      id: 'hello',
      name: 'Hello',
      description: '',
      icon: 'Puzzle',
      enabled: true,
      provenance: 'direct',
      status: 'running',
      appUrl: null
    };
    render(
      <MemoryRouter>
        <PluginHubIncludes plugin={plugin} />
      </MemoryRouter>
    );
    expect(screen.getByText('Side-panel tabs (1)')).toBeTruthy();
  });
});
