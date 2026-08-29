/**
 * Mermaid's default `useMaxWidth` SVG is `width="100%"` plus an inline
 * `max-width`/`height`. That is fine in a definite-width panel (inbox, library)
 * and a circular layout inside a thread bubble (`width: fit-content`): the
 * parent sizes to the SVG, the SVG sizes to the parent, and the transcript
 * blinks as the engine oscillates.
 *
 * Strip the percentage/inline sizing and expose the viewBox aspect ratio so
 * CSS can scale the graph to a definite container without a feedback loop.
 */

export interface MermaidSvgLayout {
  /** Opening-tag attributes rewritten so CSS owns width/height. */
  svg: string;
  /** CSS `aspect-ratio` value (`"1248 / 412"`), or null when viewBox is missing. */
  aspectRatio: string | null;
}

const SIZING_PROPS = new Set(['width', 'height', 'max-width', 'max-height']);

export function mermaidSvgLayout(svg: string): MermaidSvgLayout {
  const open = /<svg\b([^>]*?)>/i.exec(svg);
  if (!open || open.index === undefined) {
    return { svg, aspectRatio: viewBoxAspectRatio(svg) };
  }
  const attrs = open[1] ?? '';
  const aspectRatio = viewBoxAspectRatio(attrs) ?? viewBoxAspectRatio(svg);
  const cleaned = `${attrs
    .replace(/\s(?:width|height)\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\sstyle\s*=\s*["']([^"']*)["']/i, (_all, style: string) => {
      const kept = style
        .split(';')
        .map((part) => part.trim())
        .filter((part) => {
          if (!part) return false;
          const prop = part.split(':')[0]?.trim().toLowerCase();
          return Boolean(prop) && !SIZING_PROPS.has(prop);
        });
      return kept.length > 0 ? ` style="${kept.join('; ')}"` : '';
    })}`;
  const next = `${svg.slice(0, open.index)}<svg${cleaned}>${svg.slice(open.index + open[0].length)}`;
  return { svg: next, aspectRatio };
}

function viewBoxAspectRatio(source: string): string | null {
  const match = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(source);
  if (!match) return null;
  const parts = match[1]?.trim().split(/[\s,]+/).map(Number) ?? [];
  const width = parts[2];
  const height = parts[3];
  if (!(width > 0) || !(height > 0)) return null;
  return `${width} / ${height}`;
}
