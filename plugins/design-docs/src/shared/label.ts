/** Longest peer-supplied display label, in code points. */
export const MAX_LABEL_CODE_POINTS = 80;
const MAX_COMBINING_RUN = 3;

// Invisible, control and bidirectional characters a peer could use to spoof or hide text.
/* eslint-disable no-control-regex */
const INVISIBLE = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\u2066-\\u206f' +
    '\\u2800\\u3164\\ufe00-\\ufe0f\\ufeff\\u{e0000}-\\u{e007f}\\u{e0100}-\\u{e01ef}]',
  'gu'
);
/* eslint-enable no-control-regex */
const COMBINING_RUN = new RegExp(`(\\p{M}{${MAX_COMBINING_RUN}})\\p{M}+`, 'gu');

/**
 * Display-safe text: control, bidirectional and invisible characters removed, combining runs and length capped, blank as null.
 * Shared by the server and the app so the two cannot drift; `max` defaults to the peer-label cap.
 */
export function sanitizeLabel(value: string | null | undefined, max = MAX_LABEL_CODE_POINTS): string | null {
  const cleaned = (value ?? '').replace(INVISIBLE, '').replace(COMBINING_RUN, '$1').trim();
  if (!cleaned) return null;
  const points = Array.from(cleaned);
  return (points.length > max ? points.slice(0, max).join('').trimEnd() : cleaned) || null;
}
