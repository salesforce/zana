// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { PluginThreadToggles, pluginThreadToggleLabel } from './AgentViewToggle.js';
import { clearPluginSlots, interpretPluginApp } from '../plugins/plugin-slots.js';
import { useAgentsBoardThreadToggles } from '../plugins/agents-board-thread-toggles.js';

describe('PluginThreadToggles', () => {
  beforeEach(() => useAgentsBoardThreadToggles.setState({ shown: {} }));
  afterEach(() => { cleanup(); clearPluginSlots('alpha'); });

  it('renders nothing without registrations', () => {
    const { container } = render(<PluginThreadToggles />);
    expect(container.innerHTML).toBe('');
  });

  it('toggles a plugin thread filter as a pressed control', () => {
    interpretPluginApp('alpha', definePluginApp((app) => {
      app.slots.experimental_agentsBoardThreadToggle({ id: 'threads', title: 'Alphas', icon: 'Bot' });
    }));
    render(<PluginThreadToggles />);
    const button = screen.getByTestId('agents-board-thread-toggle-alpha-threads');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Show Alphas');
    fireEvent.click(button);
    expect(useAgentsBoardThreadToggles.getState().shown).toEqual({ alpha: true });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Hide Alphas');
    fireEvent.click(button);
    expect(useAgentsBoardThreadToggles.getState().shown).toEqual({});
  });

  it('labels the action by state', () => {
    expect(pluginThreadToggleLabel('Bots', false)).toBe('Show Bots');
    expect(pluginThreadToggleLabel('Bots', true)).toBe('Hide Bots');
  });
});
