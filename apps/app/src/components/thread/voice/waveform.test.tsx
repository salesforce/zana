import { describe, expect, it, vi } from 'vitest';
import { IDLE_AMPLITUDE, startWaveform, waveformBarAmplitude, waveformBarCount } from './waveform.js';

describe('waveform', () => {
  it('maps rms into a bounded bar amplitude', () => {
    expect(waveformBarAmplitude(0)).toBe(0);
    expect(waveformBarAmplitude(0.003)).toBe(0);
    expect(waveformBarAmplitude(1)).toBe(1);
    expect(waveformBarAmplitude(0.05)).toBeGreaterThan(IDLE_AMPLITUDE);
    expect(waveformBarCount(0)).toBe(1);
    expect(waveformBarCount(50)).toBeGreaterThan(1);
  });

  it('draws idle bars when there is no live stream', () => {
    const strokes: Array<{ x: number; y1: number; y2: number }> = [];
    const ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn((x: number, y: number) => { strokes.push({ x, y1: y, y2: y }); }),
      lineTo: vi.fn((x: number, y: number) => { strokes[strokes.length - 1]!.y2 = y; }),
      stroke: vi.fn(),
      strokeStyle: '',
      lineCap: '',
      lineWidth: 0
    };
    const canvas = {
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 80, height: 28, top: 0, left: 0, bottom: 28, right: 80, x: 0, y: 0, toJSON: () => ({}) }),
      width: 0,
      height: 0
    } as unknown as HTMLCanvasElement;
    const dispose = startWaveform(canvas, null, false);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(strokes.length).toBeGreaterThan(0);
    dispose();
    expect(typeof startWaveform({ getContext: () => null } as unknown as HTMLCanvasElement, null, true)).toBe('function');
  });

  it('animates from a live audio track', () => {
    const previous = {
      AudioContext: (globalThis as { AudioContext?: unknown }).AudioContext,
      MediaStream: (globalThis as { MediaStream?: unknown }).MediaStream,
      raf: globalThis.requestAnimationFrame,
      caf: globalThis.cancelAnimationFrame
    };
    let calls = 0;
    const disconnect = vi.fn();
    const stop = vi.fn();
    const getByteTimeDomainData = vi.fn((buf: Uint8Array) => { buf.fill(200); });
    (globalThis as { AudioContext: unknown }).AudioContext = class {
      resume = async () => undefined;
      close = async () => undefined;
      createMediaStreamSource = () => ({ connect: () => undefined, disconnect });
      createAnalyser = () => ({
        fftSize: 0,
        connect: () => undefined,
        disconnect,
        getByteTimeDomainData
      });
    };
    (globalThis as { MediaStream: unknown }).MediaStream = class {
      constructor(_tracks?: unknown) {}
    };
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = calls + 1;
      calls += 1;
      if (calls < 4) cb(0);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();
    const ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
      lineCap: '',
      lineWidth: 0
    };
    const canvas = {
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 40, height: 20, top: 0, left: 0, bottom: 20, right: 40, x: 0, y: 0, toJSON: () => ({}) }),
      width: 0,
      height: 0
    } as unknown as HTMLCanvasElement;
    const stream = {
      getAudioTracks: () => [{ clone: () => ({ stop }) }]
    } as unknown as MediaStream;
    const dispose = startWaveform(canvas, stream, true);
    expect(getByteTimeDomainData).toHaveBeenCalled();
    dispose();
    expect(stop).toHaveBeenCalled();
    (globalThis as { AudioContext?: unknown }).AudioContext = previous.AudioContext;
    (globalThis as { MediaStream?: unknown }).MediaStream = previous.MediaStream;
    globalThis.requestAnimationFrame = previous.raf;
    globalThis.cancelAnimationFrame = previous.caf;
  });
});
