import { memo } from 'react';

/**
 * AuroraGrid — a reusable ambient animated background.
 *
 * A faint fine grid overlaid by two slowly-drifting aurora glows, with thin
 * comet-like light beams that travel ALONG the grid lines (like current pulsing
 * through a circuit trace). Always-on but faint; designed to sit behind real
 * content. All motion is transform/opacity only (compositor-friendly) and
 * freezes under prefers-reduced-motion. Adapts to light/dark themes.
 *
 * Usage — drop it as the FIRST child of any positioned, clipping container:
 *
 *   <div style={{ position: 'relative', isolation: 'isolate', overflow: 'hidden' }}>
 *     <AuroraGrid />
 *     <div style={{ position: 'relative', zIndex: 1 }}>…your content…</div>
 *   </div>
 *
 * The host must establish a stacking context (`position: relative` +
 * `isolation: isolate`) and lift its real content to `z-index: 1` — the grid
 * paints at `z-index: 0`. It's `pointer-events: none`, so it never intercepts
 * clicks. All visuals are theme-token driven (`--border`, `--accent-blue`,
 * `--accent-gold`, `--bg-base`), so it inherits whatever surface it's dropped
 * into.
 *
 * Tuning knobs (all optional, defaulted):
 * - `className`  extra classes on the root (e.g. a per-surface opacity override)
 * - `beams`      render the traveling light beams (default true)
 */
export const AuroraGrid = memo(function AuroraGrid({
  className,
  beams = true
}: {
  className?: string;
  beams?: boolean;
}) {
  return (
    <div className={`aurora-grid${className ? ` ${className}` : ''}`} aria-hidden="true">
      {beams && (
        <>
          {/* Light beams that travel ALONG the grid lines — a comet-like streak
              sliding down a vertical line or across a horizontal one. Each beam
              sits on a grid line (offset is a 40px multiple from centre, phase-
              corrected for background-position:center) and sweeps its own axis
              on a staggered loop. */}
          <span className="aurora-grid-beam aurora-grid-beam--v b1" />
          <span className="aurora-grid-beam aurora-grid-beam--v b2" />
          <span className="aurora-grid-beam aurora-grid-beam--v b3" />
          <span className="aurora-grid-beam aurora-grid-beam--h b4" />
          <span className="aurora-grid-beam aurora-grid-beam--h b5" />
        </>
      )}
    </div>
  );
});
