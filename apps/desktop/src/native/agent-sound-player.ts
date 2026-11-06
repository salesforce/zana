import type { AgentSoundKind } from '@zana-ai/zcc-domain/product';
import { normalizeAgentSoundVolume } from '@zana-ai/zcc-domain/product';

/** Runs in preload's isolated world. One short-lived audio graph per chime. */
export async function playAgentSound(kind: AgentSoundKind, volume: number): Promise<void> {
  const level = normalizeAgentSoundVolume(volume) / 100;
  if (level === 0) return;
  const context = new AudioContext();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { clearTimeout(closeTimer); void context.close().catch(() => {}); };
  try {
    await context.resume();
    const notes = kind === 'idle' ? [784, 1046.5] : [880, 659.25, 880];
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
