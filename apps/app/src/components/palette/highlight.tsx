// Match highlighting shared by the pickers (CommandPalette, QuickOpen). Wraps
// the characters at `matchIdx` (as returned by `fuzzyScore`) in <mark> so the
// user sees *why* a row matched. Contiguous hits/non-hits are coalesced into a
// single node so we emit `<mark>foo</mark>bar`, not one node per character.
//
// `matchIdx` indexes into `text`; callers must pass the indices that came from
// scoring THIS exact string (don't reuse a hint/keyword-derived matchIdx on a
// label — the positions won't line up).
import type { ReactNode } from 'react';

export function highlightMatches(text: string, matchIdx: number[]): ReactNode {
  if (!matchIdx || matchIdx.length === 0) return text;
  const set = new Set(matchIdx);
  const parts: ReactNode[] = [];
  let buf = '';
  let bufHit = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (i === 0) {
      buf = text[i];
      bufHit = hit;
      continue;
    }
    if (hit === bufHit) {
      buf += text[i];
    } else {
      parts.push(bufHit ? <mark key={i} className="palette-match">{buf}</mark> : buf);
      buf = text[i];
      bufHit = hit;
    }
  }
  parts.push(bufHit ? <mark key="last" className="palette-match">{buf}</mark> : buf);
  return parts;
}
