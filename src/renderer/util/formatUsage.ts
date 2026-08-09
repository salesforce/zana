/**
 * Pure display formatters for the Usage dashboard (WARP R2 B7) — cost, tokens,
 * model labels. Kept as a standalone util (not inlined in the panel) so they're
 * unit-testable and can be shared. Mirrors the private helpers in
 * `AgentInsights.tsx` so the two surfaces render costs/tokens identically.
 */

/** Compact a token count as "44.9k" / "1.2M". Sub-1k renders as the raw count. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Format a rough USD cost — "$0.42" / "$12.30" / "<$0.01" for a non-zero sliver
 * — so a small-but-real cost never reads as free. Zero renders as "$0.00".
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Strip the vendor prefix + trailing date off a model id → "sonnet-4-5" from
 *  "claude-sonnet-4-5-20250929", leaving a short human label. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

/** Format an elapsed duration (ms) as a coarse "3m" / "1.5h" / "2.1d" gloss for
 *  the session list. Sub-minute rounds to "<1m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 60_000) return '<1m';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}
