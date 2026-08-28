/**
 * Mermaid SVG cache so a diagram that already rendered does not flash
 * "Rendering diagram…" when the host remounts it.
 *
 * The thread transcript ticks `now` every second for relative timestamps.
 * react-markdown rebuilds its tree on that pass, which remounts
 * {@link MermaidDiagram} with empty state. Serving the last SVG for the same
 * theme+source keeps the graph on screen.
 */

export const MERMAID_SVG_CACHE_LIMIT = 32;

const cache = new Map<string, string>();

export function mermaidSvgCacheKey(theme: string, code: string): string {
  return `${theme}\n${code}`;
}

export function readMermaidSvgCache(key: string): string | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function writeMermaidSvgCache(key: string, svg: string): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, svg);
  while (cache.size > MERMAID_SVG_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function resetMermaidSvgCache(): void {
  cache.clear();
}
