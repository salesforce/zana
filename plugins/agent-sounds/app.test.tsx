// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installTestPluginRuntime } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import server from './server.js';
const h = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock('./player.js', () => ({ SoundPlayer: class { play = h.play; stop = h.stop; } }));
import definition, { readClip, SoundStudio } from './app.tsx';
let host: ReturnType<typeof createFakePluginHost>, runtime: ReturnType<typeof installTestPluginRuntime>;
beforeEach(async () => {
  host = createFakePluginHost(); await server(host.zcc); h.play.mockReset().mockResolvedValue(undefined); h.stop.mockReset();
  runtime = installTestPluginRuntime({ rpc: Object.fromEntries([...host.harness.rpc].map(([name, fn]) => [name, fn])) });
});
afterEach(() => cleanup());
const loaded = async () => { render(<SoundStudio/>); await screen.findByRole('switch', { name: 'Sound notifications' }); };
const wav = (name = 'ping.wav') => ({ name, size: 16, arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFFxxxxWAVEdata')).buffer }) as File;
it('registers one Settings provider and retains an unlisted legacy panel', async () => {
  const navPanel = vi.fn(), notificationSoundProvider = vi.fn(), register = vi.fn();
  definition.setup({ slots: { navPanel, notificationSoundProvider }, contentScripts: { register } } as never);
  expect(navPanel).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sound Studio', placement: 'unlisted' }));
  expect(notificationSoundProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'notifications', title: 'Sound Studio', mount: expect.any(Function) }));
  expect(register).not.toHaveBeenCalled();
  const Settings = notificationSoundProvider.mock.calls[0]![0].component;
  render(<Settings/>);
  await screen.findByText("Bring your own sounds");
  expect(screen.queryByRole('switch', { name: 'Sound notifications' })).toBeNull();
});
it('keeps previews in Configure and automatic audio off on older hosts', () => {
  const settingsSection = vi.fn(), register = vi.fn();
  definition.setup({ slots: { navPanel: vi.fn(), settingsSection }, contentScripts: { register } } as never);
  expect(settingsSection).toHaveBeenCalledWith(expect.objectContaining({ id: 'sounds', description: expect.stringContaining('Update Zana') }));
  expect(register).not.toHaveBeenCalled();
});

it('previews while disabled, saves event settings, spacing and volume', async () => {
  await loaded(); const enabled = screen.getByRole('switch', { name: 'Sound notifications' }); expect(enabled.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Preview Needs you' })); await screen.findByText('Needs you preview played.'); expect(h.play).toHaveBeenCalledWith('needs-you', 35, undefined);
  fireEvent.click(enabled); await waitFor(() => expect(enabled.getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(screen.getByRole('checkbox', { name: /Becomes idle/ })); await waitFor(() => expect((screen.getByRole('checkbox', { name: /Becomes idle/ }) as HTMLInputElement).checked).toBe(true));
  fireEvent.click(screen.getByRole('checkbox', { name: /Needs you/ })); await waitFor(() => expect((screen.getByRole('checkbox', { name: /Needs you/ }) as HTMLInputElement).checked).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '30s' })); await waitFor(() => expect(screen.getByRole('button', { name: '30s' }).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.change(screen.getByRole('slider', { name: 'Sound volume' }), { target: { value: '0' } }); fireEvent.pointerUp(screen.getByRole('slider')); await waitFor(() => expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('0'));
  await waitFor(async () => expect(await host.harness.callRpc('read')).toMatchObject({ preferences: { volume: 0 } }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview Idle' })); await screen.findByText('Volume is muted.');
});
it('imports, selects, previews and removes custom audio, and reports unmapped events', async () => {
  await loaded(); fireEvent.change(screen.getByLabelText('Pack name'), { target: { value: 'My peon' } });
  fireEvent.change(screen.getByLabelText('Needs you audio'), { target: { files: [wav()] } }); fireEvent.click(screen.getByRole('button', { name: 'Save sound pack' }));
  await screen.findByText('Sound pack imported.'); expect(screen.getByRole('button', { name: /My peon Your audio/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Preview Idle' })); await screen.findByText('This pack has no sound for that event.');
  fireEvent.click(screen.getByRole('button', { name: 'Preview Needs you' })); await screen.findByText('Needs you preview played.'); expect(h.play).toHaveBeenLastCalledWith('needs-you', 35, expect.objectContaining({ name: 'ping.wav' }));
  fireEvent.click(screen.getByRole('button', { name: 'Soft chimes Built in to this plugin' })); await waitFor(() => expect(screen.getByRole('button', { name: /Soft chimes/ }).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: /My peon Your audio/ })); await screen.findByRole('button', { name: 'Remove My peon' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove My peon' })); await screen.findByText('Pack removed. Switched to soft chimes.');
});
it('handles load, save, oversized file and playback failures with visible feedback', async () => {
  runtime = installTestPluginRuntime({ rpc: { read: () => { throw new Error('offline'); } } }); render(<SoundStudio/>); await screen.findByText(/offline/); cleanup();
  runtime = installTestPluginRuntime({ rpc: Object.fromEntries([...host.harness.rpc].map(([name, fn]) => [name, fn])) }); await loaded();
  fireEvent.change(screen.getByLabelText('Needs you audio'), { target: { files: [{ ...wav(), size: 2 * 1024 * 1024 }] } }); fireEvent.click(screen.getByRole('button', { name: 'Save sound pack' })); await screen.findByText('ping.wav exceeds 1 MB.');
  h.play.mockRejectedValue(new Error('bad audio')); fireEvent.click(screen.getByRole('button', { name: 'Preview Idle' })); await screen.findByText('Could not play this audio: bad audio');
  host.harness.rpc.set('configure', () => { throw new Error('save failed'); });
  // Reinstall the fake transport so it reflects the replaced server method.
  cleanup(); installTestPluginRuntime({ rpc: Object.fromEntries(host.harness.rpc) }); await loaded(); fireEvent.click(screen.getByRole('switch')); await screen.findByText('save failed');
});
it('imports an OpenPeon folder and reports missing files or invalid manifests', async () => {
  await loaded(); const input = document.querySelector('input[webkitdirectory]')!;
  const manifest = { name: 'openpeon.json', size: 200, webkitRelativePath: 'peon/openpeon.json', text: async () => JSON.stringify({ name: 'Peon', categories: { 'input.required': { sounds: [{ file: 'sounds/a.wav' }] } } }) } as File;
  fireEvent.change(input, { target: { files: [manifest] } }); await screen.findByText('The pack is missing sounds/a.wav.');
  const file = { ...wav(), webkitRelativePath: 'peon/sounds/a.wav' } as File;
  fireEvent.change(input, { target: { files: [manifest, file] } }); await screen.findByText('OpenPeon pack imported.');
  fireEvent.change(input, { target: { files: [] } }); await screen.findByText(/Choose a folder containing openpeon.json/);
  await act(async () => runtime.emitRealtime('changed')); expect(screen.getByRole('button', { name: /Peon Your audio/ })).toBeTruthy();
});
it('encodes arbitrary file bytes without a text codec', async () => {
  expect((await readClip(wav())).base64).toBe(Buffer.from('RIFFxxxxWAVEdata').toString('base64'));
});
it('supports idle-only packs, keyboard volume saves and the native folder picker', async () => {
  await loaded();
  fireEvent.change(screen.getByLabelText('Pack name'), { target: { value: 'Idle only' } });
  fireEvent.change(screen.getByLabelText('Idle audio'), { target: { files: [wav('idle.wav')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Save sound pack' })); await screen.findByText('Sound pack imported.');
  fireEvent.click(screen.getByRole('button', { name: 'Preview Idle' })); await screen.findByText('Idle preview played.');
  expect(h.play).toHaveBeenCalledWith('idle', 35, expect.objectContaining({ name: 'idle.wav' }));
  const slider = screen.getByRole('slider'); fireEvent.change(slider, { target: { value: '45' } }); fireEvent.keyUp(slider, { key: 'ArrowRight' });
  await waitFor(async () => expect(await host.harness.callRpc('read')).toMatchObject({ preferences: { volume: 45 } }));
  await waitFor(() => expect(slider).not.toHaveProperty('disabled', true));
  fireEvent.change(slider, { target: { value: '50' } }); fireEvent.blur(slider);
  await waitFor(async () => expect(await host.harness.callRpc('read')).toMatchObject({ preferences: { volume: 50 } }));
  const pick = vi.spyOn(document.querySelector<HTMLInputElement>('input[webkitdirectory]')!, 'click');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import OpenPeon folder…' })).not.toHaveProperty('disabled', true));
  fireEvent.click(screen.getByRole('button', { name: 'Import OpenPeon folder…' })); expect(pick).toHaveBeenCalledOnce();
});
