// Subsequence-fuzzy scoring shared by the pickers (CommandPalette,
// QuickOpen, …). Higher is better; null = no match.
//
// Bonuses encode "matches that look intentional":
//   • consecutive characters
//   • match landing right after a separator (/ _ - .) or a space
//   • camel-hump transition (lower → upper)
//   • match inside the basename (the segment after the last `/`)
//   • match on the very first character of the basename
//
// We also apply a small length penalty so that, all else equal, shorter
// strings win over longer ones — useful when a query matches both a short
// label and a longer one that happens to contain the same characters.
export interface FuzzyMatch {
  score: number;
  matchIdx: number[];
}

export function fuzzyScore(text: string, query: string): FuzzyMatch | null {
  if (!query) return { score: 0, matchIdx: [] };
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const matchIdx: number[] = [];
  let ti = 0;
  let qi = 0;
  let s = 0;
  let prev = -2;
  const slashIdx = text.lastIndexOf('/');
  const baseStart = slashIdx >= 0 ? slashIdx + 1 : 0;
  while (qi < q.length && ti < t.length) {
    if (t[ti] === q[qi]) {
      matchIdx.push(ti);
      let bonus = 1;
      if (ti === prev + 1) bonus += 3;
      const ch = text[ti];
      const prevCh = ti > 0 ? text[ti - 1] : '';
      if (ti >= baseStart) bonus += 2;
      if (ti === baseStart) bonus += 4;
      if (
        prevCh === '/' ||
        prevCh === '_' ||
        prevCh === '-' ||
        prevCh === '.' ||
        prevCh === ' '
      ) {
        bonus += 3;
      }
      if (prevCh && prevCh.toLowerCase() === prevCh && ch.toLowerCase() !== ch) {
        bonus += 2;
      }
      s += bonus;
      prev = ti;
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return null;
  s -= text.length * 0.01;
  return { score: s, matchIdx };
}
