import type { Clip, Cue } from './model.js';

/** One voice at a time. Input requests take priority; no delayed sound queue. */
export class SoundPlayer {
  private context: AudioContext | null = null;
  private activeCue: Cue | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  stop(): void {
    clearTimeout(this.expiry);
    const previous = this.context;
    this.context = null;
    this.activeCue = null;
    if (previous) void previous.close().catch(() => undefined);
  }
  async play(cue: Cue, volume: number, clip?: Clip): Promise<void> {
    if (cue === 'idle' && this.context && this.activeCue === 'needs-you') return;
    this.stop();
    if (volume <= 0) return;
    const context = new AudioContext();
    this.context = context;
    this.activeCue = cue;
    try {
      const gain = context.createGain();
      gain.gain.value = Math.min(1, volume / 100) * 0.45;
      gain.connect(context.destination);
      await context.resume();
      if (this.context !== context) return;
      let duration: number;
      if (clip) {
        const raw = atob(clip.base64);
        const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        if (this.context !== context) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        duration = Math.min(8, buffer.duration);
        source.start(0, 0, duration);
      } else {
        const notes = cue === 'idle' ? [784, 1046.5] : [880, 659.25, 880];
        for (const [index, frequency] of notes.entries()) {
          const oscillator = context.createOscillator(), envelope = context.createGain();
          oscillator.frequency.value = frequency;
          const start = context.currentTime + index * 0.16;
          envelope.gain.setValueAtTime(0, start);
          envelope.gain.linearRampToValueAtTime(0.3, start + 0.01);
          envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
          oscillator.connect(envelope).connect(gain);
          oscillator.start(start); oscillator.stop(start + 0.15);
        }
        duration = notes.length * 0.16;
      }
      this.expiry = setTimeout(() => { if (this.context === context) this.stop(); }, (duration + 0.1) * 1000);
    } catch (error) {
      if (this.context !== context) return;
      this.stop();
      throw error;
    } finally {
      if (this.context !== context && context.state !== 'closed') void context.close().catch(() => undefined);
    }
  }
}
