/** Multiplier for vitest's default timeouts on a busy machine (#693). */
const MIN_SCALE = 1;
const MAX_SCALE = 5;

/** A whole number from 1 to 5; anything else (unset, text, out of range) means 1. */
export function parseTimeoutScale(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return MIN_SCALE;
  const scale = Number(raw);
  return scale >= MIN_SCALE && scale <= MAX_SCALE ? scale : MIN_SCALE;
}

export function scaleTimeout(base, raw) {
  return base * parseTimeoutScale(raw);
}
