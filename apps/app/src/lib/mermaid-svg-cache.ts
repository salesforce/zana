/**
 * Mermaid SVG cache so a diagram that already rendered does not flash
 * "Rendering diagram…" when the host remounts it.
 *
 * The thread transcript ticks `now` every second for relative timestamps,
 * and a ResizeObserver pin-to-bottom can re-render much faster than that.
 * react-markdown rebuilds its tree on those passes, which remounts
 * {@link MermaidDiagram} with empty state. Serving the last SVG for the same
 * theme+source keeps the graph on screen.
 *
 * In-flight renders are coalesced: a remount that arrives before mermaid
 * finishes must not start a second `mermaid.render` (global config + DOM ids)
 * or the first result is cancelled forever and the placeholder blinks.
 */

export const MERMAID_SVG_CACHE_LIMIT = 32;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let renderQueue: Promise<unknown> = Promise.resolve();

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

export function loadMermaidSvg(key: string, load: () => Promise<string>): Promise<string> {
  const cached = readMermaidSvgCache(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = enqueueExclusive(load)
    .then((svg) => {
      writeMermaidSvgCache(key, svg);
      return svg;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

function enqueueExclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(work, work);
  renderQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function resetMermaidSvgCache(): void {
  cache.clear();
  inflight.clear();
  renderQueue = Promise.resolve();
}
