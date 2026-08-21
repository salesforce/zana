// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { getOpenAiKey } from '../native/voice/secrets.js';
import { systemPreferences } from 'electron';

export function registerVoiceIpc(): void {
  

  // Voice transcription (OpenAI Whisper)
  ipcMain.handle(IPC.voice.transcribe, async (_ev, audioBase64: unknown, mimeType: unknown) => {
    if (typeof audioBase64 !== 'string' || typeof mimeType !== 'string') {
      return { ok: false, text: '', error: 'Invalid inputs', ms: 0 };
    }
    if (!mimeType.startsWith('audio/')) {
      return { ok: false, text: '', error: 'Invalid MIME type', ms: 0 };
    }
    try {
      const audio = Buffer.from(audioBase64, 'base64');
      if (audio.byteLength > 25 * 1024 * 1024) {
        return { ok: false, text: '', error: 'Audio too large (max 25 MB)', ms: 0 };
      }
      const cfg = store.getConfig();
      return await ctx.voiceService.transcribe({
        audio,
        mimeType,
        model: cfg.voiceModel || undefined,
        language: cfg.voiceLanguage || undefined
      });
    } catch (err) {
      return { ok: false, text: '', error: `Transcription failed: ${(err as Error).message}`, ms: 0 };
    }
  });
  ipcMain.handle(IPC.voice.hasApiKey, async () => {
    return (await getOpenAiKey()) != null;
  });

  // Ensure the OS-level microphone permission is granted before the renderer
  // calls getUserMedia. On macOS this surfaces the system TCC prompt the first
  // time; a prior denial resolves false so the renderer can show a recovery
  // hint instead of a silent failure. No-op (true) elsewhere.
  ipcMain.handle(IPC.voice.ensureMicAccess, async () => {
    if (process.platform !== 'darwin') return true;
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'granted') return true;
      if (status === 'denied') return false;
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  });
}

