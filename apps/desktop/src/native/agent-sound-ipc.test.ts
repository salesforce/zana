import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerAgentSoundIpc } from './agent-sound-ipc.js';
const handlers = new Map<string, (...args: any[]) => any>(), errors = new Map<string, (...args: any[]) => any>();
let files: any, dialog: any, win: any;
beforeEach(() => {
  files = { ready: Promise.resolve(), selections: vi.fn(() => ({ done: { name: 'finish.mp3' } })), current: vi.fn(() => ({ mime: 'audio/mpeg', base64: 'SUQz' })), import: vi.fn().mockResolvedValue({ name: 'new.mp3' }), clear: vi.fn().mockResolvedValue(undefined) };
  dialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/selected/new.mp3'] }); win = { isDestroyed: () => false };
  registerAgentSoundIpc({ handle: ((channel: string, handler: any, error: any) => { handlers.set(channel, handler); errors.set(channel, error); }) as any,
    files, showOpenDialog: dialog, volume: () => 72 });
});
it('returns only metadata, asks a trusted native picker, and imports its path', async () => {
  expect(await handlers.get(IPC.app.getAgentSoundFiles)!(win)).toEqual({ done: { name: 'finish.mp3' } });
  expect(await handlers.get(IPC.app.chooseAgentSoundFile)!(win, 'done', '/renderer/cannot/choose.mp3')).toEqual({ name: 'new.mp3' });
  expect(dialog).toHaveBeenCalledWith(win, expect.objectContaining({ properties: ['openFile'] }));
  expect(files.import).toHaveBeenCalledExactlyOnceWith('done', '/selected/new.mp3');
  await handlers.get(IPC.app.clearAgentSoundFile)!(win, 'done'); expect(files.clear).toHaveBeenCalledWith('done');
  expect(await handlers.get(IPC.app.previewAgentSound)!(win, 'done')).toEqual({ volume: 72, clip: { mime: 'audio/mpeg', base64: 'SUQz' } });
});
it('does not import on cancel, empty paths, or a closing window', async () => {
  for (const result of [{ canceled: true, filePaths: ['/ignored'] }, { canceled: false, filePaths: [] }]) {
    dialog.mockResolvedValueOnce(result); expect(await handlers.get(IPC.app.chooseAgentSoundFile)!(win, 'idle')).toBeNull();
  }
  expect(await handlers.get(IPC.app.chooseAgentSoundFile)!({ isDestroyed: () => true }, 'idle')).toBeNull();
  expect(files.import).not.toHaveBeenCalled();
});
it('rejects unknown event names before reading files or showing a picker', async () => {
  for (const channel of [IPC.app.previewAgentSound, IPC.app.chooseAgentSoundFile, IPC.app.clearAgentSoundFile]) {
    await expect(handlers.get(channel)!(win, '../other')).rejects.toThrow('Unknown agent sound');
  }
  expect(dialog).not.toHaveBeenCalled();
  expect(errors.get(IPC.app.previewAgentSound)!(new Error('bad'))).toBeUndefined();
  expect(() => errors.get(IPC.app.chooseAgentSoundFile)!(new Error('bad'))).toThrow('bad');
});
