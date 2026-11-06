import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { IPC, type CcApi } from '@zana-ai/zcc-desktop-contract';

const h = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), play: vi.fn() }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: h.invoke, setMaxListeners: vi.fn(), on: h.on, off: vi.fn() },
  contextBridge: { exposeInMainWorld: h.expose },
  webFrame: { getZoomFactor: () => 1 }, webUtils: { getPathForFile: vi.fn() },
}));
vi.mock('./native/agent-sound-player.js', () => ({ playAgentSound: h.play }));

let api: CcApi;
let cue: (event: unknown, kind: unknown, volume: unknown) => void;
beforeAll(async () => {
  await import('./preload.js');
  api = h.expose.mock.calls.find(([name]) => name === 'cc')![1];
  cue = h.on.mock.calls.find(([channel]) => channel === IPC.app.onAgentSound)![1];
});
beforeEach(() => { h.invoke.mockReset(); h.play.mockReset().mockResolvedValue(undefined); });

it('plays validated main-process cues and ignores malformed messages', () => {
  cue({}, 'idle', 50);
  cue({}, 'needs-you', 75);
  expect(h.play.mock.calls).toEqual([['idle', 50], ['needs-you', 75]]);
  for (const [kind, volume] of [['other', 50], ['idle', '50'], [undefined, 50], ['needs-you', null]]) {
    cue({}, kind, volume);
  }
  expect(h.play).toHaveBeenCalledTimes(2);
});

it('contains an automatic playback failure without interrupting the agent', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failure = new Error('audio device unavailable');
  h.play.mockRejectedValueOnce(failure);
  try {
    expect(() => cue({}, 'idle', 50)).not.toThrow();
    await Promise.resolve();
    expect(warning).toHaveBeenCalledWith('[agent sound]', failure);
  } finally { warning.mockRestore(); }
});

it('uses the volume authorized by main for previews', async () => {
  h.invoke.mockResolvedValueOnce(75);
  await api.app.previewAgentSound!('needs-you');
  expect(h.invoke).toHaveBeenCalledExactlyOnceWith(IPC.app.previewAgentSound, 'needs-you');
  expect(h.play).toHaveBeenCalledExactlyOnceWith('needs-you', 75);
});

it('rejects unavailable or failed previews without silently reporting success', async () => {
  h.invoke.mockResolvedValueOnce(undefined);
  await expect(api.app.previewAgentSound!('idle')).rejects.toThrow('Sound preview unavailable');
  expect(h.play).not.toHaveBeenCalled();
  h.invoke.mockRejectedValueOnce(new Error('IPC unavailable'));
  await expect(api.app.previewAgentSound!('idle')).rejects.toThrow('IPC unavailable');
  h.invoke.mockResolvedValueOnce(50);
  h.play.mockRejectedValueOnce(new Error('audio unavailable'));
  await expect(api.app.previewAgentSound!('idle')).rejects.toThrow('audio unavailable');
});
