import { fuzzyMatchPaths, fuzzyMatchText } from '@zana-ai/zcc-fuzzy-match';

export { fuzzyMatchPaths, fuzzyMatchText };

export interface FuzzyMatch {
  score: number;
  matchIdx: number[];
}

export function fuzzyScore(text: string, query: string): FuzzyMatch | null {
  if (!query) return { score: 0, matchIdx: [] };
  const rows = fuzzyMatchText({
    items: [{ text }],
    query,
    getText: (item) => item.text,
    limit: 1
  });
  const row = rows[0];
  if (!row) return null;
  return { score: row.score, matchIdx: row.positions };
}
