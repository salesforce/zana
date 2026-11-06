// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { AgentSoundSettings } from './AgentSoundSettings.js';
import { entries } from '@/lib/settings-search/entries/agents';
const config = {} as AppConfig;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as any).cc; });
it('starts off, saves independent switches and volume, and renders the saved values', () => {
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const props = { config, onUpdate };
  const view = render(<AgentSoundSettings {...props} />);
  const needs = screen.getByRole('switch', { name: 'Play a chime when an agent needs you' });
  const idle = screen.getByRole('switch', { name: 'Play a chime when an agent becomes idle' });
  expect(needs.getAttribute('aria-checked')).toBe('false');
  expect(idle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(needs); fireEvent.click(idle);
  fireEvent.change(screen.getByRole('slider', { name: 'Chime volume' }), { target: { value: '75' } });
  expect(onUpdate.mock.calls).toEqual([[{ agentSoundNeedsYou: true }], [{ agentSoundIdle: true }], [{ agentSoundVolume: 75 }]]);
  view.rerender(<AgentSoundSettings {...props} config={{ ...config, agentSoundIdle: true, agentSoundNeedsYou: true, agentSoundVolume: 75 }} />);
  expect(needs.getAttribute('aria-checked')).toBe('true'); expect(idle.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('75%')).toBeTruthy();
  fireEvent.click(idle); expect(onUpdate).toHaveBeenLastCalledWith({ agentSoundIdle: false });
});
it('previews either sound without enabling notifications, and reports errors', async () => {
  const preview = vi.fn().mockResolvedValue(undefined);
  (window as any).cc = { app: { previewAgentSound: preview } };
  const onUpdate = vi.fn();
  render(<AgentSoundSettings config={config} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview Needs you' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Needs you preview played.'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview Idle' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Idle preview played.'));
  preview.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview Idle' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not play'));
  expect(preview.mock.calls).toEqual([['needs-you'], ['idle'], ['idle']]); expect(onUpdate).not.toHaveBeenCalled();
});
it('explains desktop playback when opened in a browser', () => {
  render(<AgentSoundSettings config={config} onUpdate={vi.fn()} />);
  for (const button of screen.getAllByRole('button', { name: /Preview/ })) expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Sound playback is available in the Zana desktop app.')).toBeTruthy();
});
it('indexes the controls with current values and the sounds section anchor', () => {
  const rows = entries.filter(e => e.id.startsWith('agents.sound-'));
  expect(rows).toHaveLength(4);
  for (const row of rows) expect(row.anchor).toBe('agent-sounds');
  const snapshot = { config: { agentSoundIdle: true, agentSoundNeedsYou: false, agentSoundVolume: 70 } } as any;
  expect(rows.filter(e => e.value).map(e => e.value!(snapshot))).toEqual(['Off', 'On', '70%']);
  expect(rows.filter(e => e.value).map(e => e.value!({ config: {} } as any))).toEqual(['Off', 'Off', '50%']);
});
