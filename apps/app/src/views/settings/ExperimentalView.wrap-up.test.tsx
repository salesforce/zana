// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS } from '@zana-ai/zcc-domain/product';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { ExperimentalView } from './ExperimentalView.js';

afterEach(cleanup);
const base = {
  version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13,
  lastProjectId: null, worktreeIsolationDefault: true
} as AppConfig;
const INSTRUCTIONS = 'Instructions sent to the agent';

// Settings keeps the draft in state and feeds it back as `config`, as SettingsView does.
function mount(over: Partial<AppConfig> = {}) {
  const update = vi.fn();
  const draft = vi.fn();
  function Host() {
    const [config, setConfig] = useState<AppConfig>({ ...base, ...over });
    return (
      <ExperimentalView
        config={config}
        onConfigDraft={(next) => {
          draft(next);
          setConfig(next);
        }}
        onUpdate={update}
      />
    );
  }
  render(<Host />);
  return { update, draft };
}

it.each([undefined, false, true])('renders the toggle with its exact label and help (enabled: %s)', enabled => {
  const { update } = mount({ closeWrapUpEnabled: enabled });
  const toggle = screen.getByRole('switch', { name: 'Wrap up before closing' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled ?? false));
  expect(
    screen.getByText(
      'Close with follow-up, and Close idle with follow-ups, first ask each agent to save what it learnt and tidy up. Each agent is then closed with the same summary as Summarize to inbox, and a follow-up if work is left. When off, they close straight away with a short note.'
    )
  ).toBeTruthy();
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledWith({ closeWrapUpEnabled: !(enabled ?? false) });
});

it('hides the instructions and Reset while the toggle is off', () => {
  mount();
  expect(screen.queryByLabelText(INSTRUCTIONS)).toBeNull();
  expect(screen.queryByText('Reset to default')).toBeNull();
});

it('shows the default text when on and nothing is stored', () => {
  mount({ closeWrapUpEnabled: true });
  const area = screen.getByLabelText(INSTRUCTIONS) as HTMLTextAreaElement;
  expect(area.value).toBe(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS);
  expect(screen.getByText('Typed into the agent when you choose Close with follow-up.')).toBeTruthy();
});

it('shows stored text and reports edits as a draft', () => {
  const { draft } = mount({ closeWrapUpEnabled: true, closeWrapUpInstructions: 'Mine' });
  const area = screen.getByLabelText(INSTRUCTIONS) as HTMLTextAreaElement;
  expect(area.value).toBe('Mine');
  fireEvent.change(area, { target: { value: 'Mine, edited' } });
  expect(draft).toHaveBeenCalledWith(expect.objectContaining({ closeWrapUpInstructions: 'Mine, edited' }));
});

it('saves edited text trimmed on blur', () => {
  const { update } = mount({ closeWrapUpEnabled: true });
  const area = screen.getByLabelText(INSTRUCTIONS);
  fireEvent.change(area, { target: { value: '  Just the summary.  ' } });
  fireEvent.blur(area);
  expect(update).toHaveBeenCalledWith({ closeWrapUpInstructions: 'Just the summary.' });
});

it('stores nothing when the text on blur is the default or whitespace', () => {
  const { update } = mount({ closeWrapUpEnabled: true, closeWrapUpInstructions: 'Mine' });
  const area = screen.getByLabelText(INSTRUCTIONS);
  fireEvent.change(area, { target: { value: `  ${DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS}  ` } });
  fireEvent.blur(area);
  expect(update).toHaveBeenLastCalledWith({ closeWrapUpInstructions: undefined });
  fireEvent.change(area, { target: { value: '   ' } });
  fireEvent.blur(area);
  expect(update).toHaveBeenLastCalledWith({ closeWrapUpInstructions: undefined });
});

it('Reset to default clears the stored text', () => {
  const { update } = mount({ closeWrapUpEnabled: true, closeWrapUpInstructions: 'Mine' });
  fireEvent.click(screen.getByText('Reset to default'));
  expect(update).toHaveBeenCalledWith({ closeWrapUpInstructions: undefined });
});
