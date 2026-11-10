// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { AgentSoundSettings } from './AgentSoundSettings.js';
import { entries } from '@/lib/settings-search/entries/notifications';
const config = {} as AppConfig;
let api: any;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  api = { previewAgentSound: vi.fn().mockResolvedValue(undefined), getAgentSoundFiles: vi.fn().mockResolvedValue({}),
    chooseAgentSoundFile: vi.fn().mockResolvedValue({ name: 'my-chime.mp3' }), clearAgentSoundFile: vi.fn().mockResolvedValue(undefined) };
  (window as any).cc = { app: api };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as any).cc; });
const show = async (saved = config, onUpdate = vi.fn().mockResolvedValue(undefined)) => {
  const view = render(<AgentSoundSettings config={saved} onUpdate={onUpdate} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Preview Needs you' }) as HTMLButtonElement).disabled).toBe(false));
  return { ...view, onUpdate };
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: `${label} sound` }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
it('starts off and saves independent completion, input, idle, volume and spacing preferences', async () => {
  const { onUpdate, rerender } = await show();
  for (const label of ['Agent finishes a turn', 'Agent needs you']) {
    const toggle = screen.getByRole('switch', { name: label });
    expect(toggle.getAttribute('aria-checked')).toBe('false'); fireEvent.click(toggle);
  }
  fireEvent.click(screen.getByText('Also notify when an agent becomes idle'));
  fireEvent.click(screen.getByRole('switch', { name: 'Agent becomes idle' }));
  fireEvent.change(screen.getByRole('slider', { name: 'Chime volume' }), { target: { value: '75' } });
  fireEvent.click(screen.getByRole('button', { name: 'Quiet spacing' })); fireEvent.click(screen.getByRole('option', { name: '10 seconds' }));
  expect(onUpdate.mock.calls).toEqual([[{ agentSoundDone: true }], [{ agentSoundNeedsYou: true }], [{ agentSoundIdle: true }], [{ agentSoundVolume: 75 }], [{ agentSoundSpacingSeconds: 10 }]]);
  rerender(<AgentSoundSettings config={{ ...config, agentSoundIdle: true, agentSoundNeedsYou: true, agentSoundDone: true, agentSoundVolume: 75 }} onUpdate={onUpdate}/>);
  expect(screen.getByRole('switch', { name: 'Agent becomes idle' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('75%')).toBeTruthy();
});
it('imports separate audio directly without enabling notifications, persists names and restores a chime', async () => {
  const { onUpdate } = await show();
  choose('Agent needs you', 'Choose audio file…');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('my-chime.mp3 saved'));
  expect(api.chooseAgentSoundFile).toHaveBeenCalledWith('needs-you');
  expect(screen.getByRole('button', { name: 'Agent needs you sound' }).textContent).toContain('my-chime.mp3');
  expect(screen.getByRole('button', { name: 'Agent finishes a turn sound' }).textContent).toContain('Default chime');
  choose('Agent needs you', 'my-chime.mp3'); // Selecting the already selected file does nothing.
  expect(api.chooseAgentSoundFile).toHaveBeenCalledOnce();
  choose('Agent needs you', 'Default chime');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Default chime restored.'));
  expect(api.clearAgentSoundFile).toHaveBeenCalledWith('needs-you'); expect(onUpdate).not.toHaveBeenCalled();
});
it('keeps the previous choice after cancelling, rejecting a file, or failing to clear', async () => {
  api.getAgentSoundFiles.mockResolvedValue({ done: { name: 'finish.wav' } });
  await show();
  api.chooseAgentSoundFile.mockResolvedValueOnce(null);
  choose('Agent finishes a turn', 'Choose audio file…');
  await waitFor(() => expect((screen.getByRole('button', { name: 'Agent finishes a turn sound' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole('button', { name: 'Agent finishes a turn sound' }).textContent).toContain('finish.wav');
  api.chooseAgentSoundFile.mockRejectedValueOnce(new Error('Choose an audio file up to 1 MB.'));
  choose('Agent finishes a turn', 'Choose audio file…');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('1 MB'));
  api.clearAgentSoundFile.mockRejectedValueOnce('offline');
  choose('Agent finishes a turn', 'Default chime');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('previous sound'));
  expect(screen.getByRole('button', { name: 'Agent finishes a turn sound' }).textContent).toContain('finish.wav');
});
it('previews all three sounds while disabled and reports decoder failures', async () => {
  const { onUpdate } = await show();
  for (const [label, kind, text] of [['Finished turn', 'done', 'Finished turn'], ['Needs you', 'needs-you', 'Needs you'], ['Idle', 'idle', 'Idle']]) {
    if (kind === 'idle') fireEvent.click(screen.getByText('Also notify when an agent becomes idle'));
    fireEvent.click(screen.getByRole('button', { name: `Preview ${label}` }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(`${text} preview played.`));
    expect(api.previewAgentSound).toHaveBeenLastCalledWith(kind);
  }
  api.previewAgentSound.mockRejectedValueOnce(new Error('bad audio'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview Needs you' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not play'));
  expect(onUpdate).not.toHaveBeenCalled();
});
it('reloads names on focus and contains failures and late results after unmount', async () => {
  api.getAgentSoundFiles.mockRejectedValueOnce(new Error('offline'));
  const { unmount } = await show();
  expect(screen.getByRole('alert').textContent).toContain('Could not load');
  api.getAgentSoundFiles.mockResolvedValueOnce({ 'needs-you': { name: 'another-window.ogg' } });
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agent needs you sound' }).textContent).toContain('another-window.ogg'));
  let finish: (v: any) => void = () => {};
  api.getAgentSoundFiles.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.focus(window); unmount(); finish({});
  const calls = api.getAgentSoundFiles.mock.calls.length; fireEvent.focus(window); expect(api.getAgentSoundFiles).toHaveBeenCalledTimes(calls);
});
it('explains desktop support and old-host limitations', async () => {
  delete (window as any).cc;
  const view = render(<AgentSoundSettings config={config} onUpdate={vi.fn()} />);
  expect((screen.getByRole('button', { name: 'Preview Needs you' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/available in the Zana desktop app/)).toBeTruthy();
  view.unmount(); (window as any).cc = { app: { previewAgentSound: api.previewAgentSound } };
  render(<AgentSoundSettings config={config} onUpdate={vi.fn()} />);
  expect(screen.getByText('Update Zana to choose your own audio files here.')).toBeTruthy();
});
it('indexes custom audio, completion, idle, volume, spacing and previews', () => {
  const rows = entries.filter(e => e.id.startsWith('agents.sound-'));
  expect(rows).toHaveLength(6);
  for (const row of rows) expect(row.anchor).toBe('builtin-chimes');
  expect(rows.filter(e => e.value).map(e => e.value!({ config: {} } as any))).toEqual(['Off', 'Off', 'Off', '50%', '2 seconds']);
  expect(rows.filter(e => e.value).map(e => e.value!({ config: { agentSoundDone: true, agentSoundNeedsYou: false, agentSoundIdle: true, agentSoundVolume: 70, agentSoundSpacingSeconds: 15 } } as any))).toEqual(['On', 'Off', 'On', '70%', '15 seconds']);
});
