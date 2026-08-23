const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_PITCH = BAR_WIDTH + BAR_GAP;
const SAMPLE_EVERY_N_FRAMES = 2;
const NOISE_FLOOR = 0.006;
const AMPLITUDE_GAIN = 8;
const AMPLITUDE_GAMMA = 0.6;
export const IDLE_AMPLITUDE = 0.06;

export function waveformBarAmplitude(rms: number): number {
  const boosted = Math.max(0, rms - NOISE_FLOOR) * AMPLITUDE_GAIN;
  return Math.min(1, boosted ** AMPLITUDE_GAMMA);
}

export function waveformBarCount(cssWidth: number): number {
  return Math.max(1, Math.floor(cssWidth / BAR_PITCH));
}

export function startWaveform(
  canvas: HTMLCanvasElement,
  stream: MediaStream | null,
  active: boolean
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;

  let cssWidth = 0;
  let cssHeight = 0;
  let barCount = 1;
  let midY = 0;
  let maxHalf = 0;
  const bars: number[] = [];

  const measure = () => {
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    const rect = canvas.getBoundingClientRect();
    cssWidth = rect.width;
    cssHeight = rect.height;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const color = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '';
    ctx.strokeStyle = color || 'currentColor';
    ctx.lineCap = 'round';
    ctx.lineWidth = BAR_WIDTH;
    midY = cssHeight / 2;
    maxHalf = Math.max(0, (cssHeight * 0.95 - BAR_WIDTH) / 2);
    barCount = waveformBarCount(cssWidth);
  };

  const draw = () => {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    for (let i = 0; i < bars.length; i += 1) {
      const amp = bars[bars.length - 1 - i] ?? IDLE_AMPLITUDE;
      const cx = cssWidth - BAR_WIDTH / 2 - i * BAR_PITCH;
      if (cx + BAR_WIDTH < 0) break;
      ctx.beginPath();
      ctx.moveTo(cx, midY - amp * maxHalf);
      ctx.lineTo(cx, midY + amp * maxHalf);
      ctx.stroke();
    }
  };

  measure();
  const audioTrack = stream?.getAudioTracks()[0] ?? null;
  const canAnimate = active && audioTrack !== null && typeof AudioContext !== 'undefined';
  if (!canAnimate || audioTrack === null) {
    if (bars.length === 0) bars.push(...Array.from({ length: barCount }, () => IDLE_AMPLITUDE));
    draw();
    return () => undefined;
  }

  const audioCtx = new AudioContext();
  void audioCtx.resume();
  const analysisTrack = audioTrack.clone();
  const source = audioCtx.createMediaStreamSource(new MediaStream([analysisTrack]));
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const timeData = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let rafId = 0;
  const tick = () => {
    if (frame % SAMPLE_EVERY_N_FRAMES === 0) {
      analyser.getByteTimeDomainData(timeData);
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i += 1) {
        const centered = (timeData[i]! - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);
      bars.push(waveformBarAmplitude(rms));
      if (bars.length > barCount) bars.shift();
      draw();
    }
    frame += 1;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(rafId);
    source.disconnect();
    analyser.disconnect();
    analysisTrack.stop();
    void audioCtx.close();
  };
}
