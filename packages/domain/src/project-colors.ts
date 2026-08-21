/**
 * The project-color palette and the auto-assignment policy, shared by main
 * (which persists a color on every project at create / backfill time) and the
 * renderer (which renders the swatch picker and tints agents with it).
 *
 * Keeping this in one module is the point: main picks colors and the renderer
 * paints them, and they must agree on the exact hex set or the "Reset" swatch
 * and the auto-assigned color would diverge.
 */

/** The 8-color project palette. First entry is the conventional default. */
export const PROJECT_COLORS = [
  '#2f81f7', // blue (default)
  '#3fb950', // green
  '#d4a017', // gold
  '#bc8cff', // magenta
  '#39c5cf', // cyan
  '#f85149', // red
  '#ff7b72', // pink
  '#8b949e' // gray
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

/**
 * Pick the least-used palette color given the colors already in play, so a
 * fresh project gets a color that's visually distinct from its neighbours for
 * as long as possible (only repeating once every palette slot is taken). Ties
 * break toward palette order, so the first few projects walk blue→green→gold→…
 * deterministically. Colors outside the palette (e.g. a hand-edited hex) are
 * ignored for counting — they neither block nor bias the choice.
 */
export function pickProjectColor(inUse: Iterable<string | undefined | null>): ProjectColor {
  const counts = new Map<string, number>(PROJECT_COLORS.map((c) => [c, 0]));
  for (const c of inUse) {
    if (c && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  let best: ProjectColor = PROJECT_COLORS[0];
  let bestCount = Infinity;
  for (const c of PROJECT_COLORS) {
    const n = counts.get(c)!;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}
