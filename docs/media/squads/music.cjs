// Music bed and sound effects, as in the Zana demo cut. usage: node music.cjs <cues.json> <out.wav>
const fs = require('fs');
const C = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SR = 48000, DUR = C.duration, N = Math.round(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
const BEAT = 60 / 112;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67], [52, 55, 59, 64], [50, 53, 57, 62], [57, 60, 64, 71]];
const chordAt = (t) => { let c = CHORDS[0]; C.chords.forEach((a, i) => { if (t >= a) c = CHORDS[i % CHORDS.length]; }); return c; };
const energy = (t) => { let e = 0.3; for (const [a, v] of C.energy) if (t >= a) e = v; return e * Math.min(1, Math.max(0, (DUR - t) / 1.2)); };
let lpL = 0, lpR = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, ch = chordAt(t); let sL = 0, sR = 0;
  ch.forEach((m, k) => { const f = hz(m); sL += ((t * f * 1.003) % 1) * 2 - 1; sR += ((t * f * 0.997) % 1) * 2 - 1; if (k === 0) { const b = Math.sin(2 * Math.PI * f * 0.5 * t) * 1.2; sL += b; sR += b; } });
  const cut = 0.022 + 0.018 * Math.sin(t * 0.4) ** 2; lpL += cut * (sL - lpL); lpR += cut * (sR - lpR);
  const e = energy(t); add(i, lpL * 0.05 * e, lpR * 0.05 * e);
}
function pluck(t0, f, amp, pan) { const n = Math.floor(SR * 0.45), s0 = Math.floor(t0 * SR); for (let j = 0; j < n; j++) { const t = j / SR; const env = Math.exp(-t * 9) * Math.min(1, t * 400); const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * env * amp; add(s0 + j, v * (1 - pan), v * (1 + pan)); } }
function kick(t0, amp) { const n = Math.floor(SR * 0.35), s0 = Math.floor(t0 * SR); let ph = 0; for (let j = 0; j < n; j++) { const t = j / SR; const f = 45 + 90 * Math.exp(-t * 30); ph += f / SR; const v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * amp; add(s0 + j, v, v); } }
function hat(t0, amp) { const n = Math.floor(SR * 0.05), s0 = Math.floor(t0 * SR); let prev = 0; for (let j = 0; j < n; j++) { const w = rnd(); const v = (w - prev) * Math.exp(-j / SR * 80) * amp; prev = w; add(s0 + j, v * 0.8, v); } }
function whoosh(t0, dur, amp) { const n = Math.floor(SR * dur), s0 = Math.floor((t0 - dur * 0.7) * SR); let lp = 0; for (let j = 0; j < n; j++) { const x = j / n; const env = Math.sin(Math.PI * x) ** 2; const c = 0.02 + 0.25 * x; lp += c * (rnd() - lp); add(s0 + j, lp * env * amp * (1 - x * 0.6), lp * env * amp * (0.4 + x * 0.6)); } }
function click(t0) { const n = Math.floor(SR * 0.03), s0 = Math.floor(t0 * SR); for (let j = 0; j < n; j++) { const t = j / SR; const v = (Math.sin(2 * Math.PI * 2400 * t) * 0.5 + rnd() * 0.5) * Math.exp(-t * 260) * 0.2; add(s0 + j, v, v); } }
function pop(t0, amp) { const n = Math.floor(SR * 0.08), s0 = Math.floor(t0 * SR); for (let j = 0; j < n; j++) { const t = j / SR; const v = Math.sin(2 * Math.PI * (900 - 4000 * t) * t) * Math.exp(-t * 60) * amp; add(s0 + j, v, v); } }
const chime = (t0, amp = 0.08) => [76, 83, 88].forEach((m, k) => pluck(t0 + k * 0.07, hz(m), amp, (k - 1) * 0.3));
for (let t = C.pluckFrom; t < DUR; t += BEAT / 2) {
  const step = Math.round((t - C.pluckFrom) / (BEAT / 2)), ch = chordAt(t), e = energy(t);
  pluck(t, hz(ch[[0, 2, 1, 3, 2, 1, 3, 2][step % 8]] + 12), 0.04 * e, ((step % 4) - 1.5) * 0.25);
  const drums = C.drums.some(([a, b]) => t >= a && t < b);
  if (drums && step % 2 === 0) kick(t, 0.26 * e);
  if (drums && step % 2 === 1) hat(t, 0.05 * e);
}
(C.whoosh || []).forEach(([t, d, a]) => whoosh(t, d, a));
(C.kick || []).forEach(([t, a]) => kick(t, a));
(C.chime || []).forEach(([t, a]) => chime(t, a));
(C.pop || []).forEach(([t, a]) => pop(t, a));
(C.click || []).forEach((t) => click(t));
(C.typing || []).forEach(([a, b]) => { for (let t = a; t < b; t += 0.07 + 0.03 * Math.abs(rnd())) { const n = Math.floor(SR * 0.012), s0 = Math.floor(t * SR); for (let j = 0; j < n; j++) { const v = rnd() * Math.exp(-j / SR * 500) * 0.05; add(s0 + j, v, v); } } });
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.7 / peak, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
const cl = (x) => Math.max(-1, Math.min(1, x));
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(cl(L[i] * g) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(cl(R[i] * g) * 32767), 46 + i * 4); }
fs.writeFileSync(process.argv[3], buf); console.log('peak', peak.toFixed(3));
