import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { normalizeAgentSoundVolume } from '@zana-ai/zcc-domain/product';
import type { AgentSoundClip } from '@zana-ai/zcc-domain/product';
import type { IpcCtx } from '../ipc/ctx.js';
import { isAgentSoundKind, type AgentSoundFiles } from './agent-sound-files.js';

export function registerAgentSoundIpc(deps: {
  handle: IpcCtx['safeHandleFromWindow'];
  files: AgentSoundFiles;
  volume(): unknown;
  showOpenDialog(win: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
}): void {
  const { files, handle } = deps;
  const reject = (error: unknown): never => { throw error; };
  handle(IPC.app.getAgentSoundFiles, async () => { await files.ready; return files.selections(); }, reject);
  handle<[unknown], { name: string } | null>(IPC.app.chooseAgentSoundFile, async (win, kind: unknown) => {
    if (!isAgentSoundKind(kind)) throw new Error('Unknown agent sound');
    const result = await deps.showOpenDialog(win, {
      title: 'Choose notification sound', properties: ['openFile'],
      filters: [{ name: 'Audio files', extensions: ['mp3', 'wav', 'ogg'] }]
    });
    if (result.canceled || !result.filePaths.length || win.isDestroyed()) return null;
    return files.import(kind, result.filePaths[0]!);
  }, reject);
  handle<[unknown], void>(IPC.app.clearAgentSoundFile, async (_win, kind: unknown) => {
    if (!isAgentSoundKind(kind)) throw new Error('Unknown agent sound');
    await files.clear(kind);
  }, reject);
  handle<[unknown], { volume: number; clip: AgentSoundClip | undefined } | undefined>(IPC.app.previewAgentSound, async (_win, kind: unknown) => {
    if (!isAgentSoundKind(kind)) throw new Error('Unknown agent sound');
    await files.ready;
    return { volume: normalizeAgentSoundVolume(deps.volume()), clip: files.current(kind) };
  }, () => undefined);
}
