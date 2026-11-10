import type { AgentSoundClip, AgentSoundKind } from '@zana-ai/zcc-domain/product';
import { normalizeAgentSoundVolume } from '@zana-ai/zcc-domain/product';

/** Runs in preload's isolated world. One short-lived audio graph per chime. */
let stopActive: (() => void) | undefined;
export async function playAgentSound(kind: AgentSoundKind, volume: number, clip?: AgentSoundClip): Promise<void> {
  stopActive?.();
  const level = normalizeAgentSoundVolume(volume) / 100;
  if (level === 0) return;
  const context = new AudioContext();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(closeTimer);
    if (stopActive === close) stopActive = undefined;
    void context.close().catch(() => {});
  };
  stopActive = close;
  try {
    await context.resume();
    if (closed) return;
    if (clip) {
      if (!['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(clip.mime) || clip.base64.length > 1_398_104) throw new Error('Invalid notification audio');
      const binary = atob(clip.base64);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer);
      if (closed) return;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = level;
      source.connect(gain); gain.connect(context.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); close(); };
      source.start(0, 0, Math.min(buffer.duration, 8));
      closeTimer = setTimeout(close, 8_100);
      return;
    }
    const notes = kind === 'done' ? [659.25, 880] : kind === 'idle' ? [784, 1046.5] : [880, 659.25, 880];
    const now = context.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.16;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level * 0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    });
    closeTimer = setTimeout(close, 1_000);
  } catch (error) {
    close();
    throw error;
  }
}
