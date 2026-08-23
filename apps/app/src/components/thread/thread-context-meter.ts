import type { ThreadContextWindowUsage } from '@zana-ai/zcc-server-contract';

function compactTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    const rounded = Math.round(millions * 10) / 10;
    return `${Number.isInteger(rounded) ? String(rounded) : String(rounded)}m`;
  }
  if (n >= 1_000) {
    const thousands = n / 1_000;
    const rounded = Math.round(thousands * 10) / 10;
    return `${Number.isInteger(rounded) ? String(rounded) : String(rounded)}k`;
  }
  return String(Math.round(n));
}

export interface ThreadContextMeterView {
  usedPct: number;
  title: string;
  usedLabel: string;
  leftLabel: string;
  tokensLabel: string;
}

export function threadContextMeterView(
  usage: ThreadContextWindowUsage
): ThreadContextMeterView | null {
  if (usage.modelContextWindow <= 0) return null;
  const usedPct = Math.min(
    100,
    Math.max(0, Math.round((usage.usedTokens / usage.modelContextWindow) * 100))
  );
  return {
    usedPct,
    title: usage.estimated ? 'Estimated context' : 'Context',
    usedLabel: `${usedPct}% used`,
    leftLabel: `${100 - usedPct}% left`,
    tokensLabel: `${compactTokenCount(usage.usedTokens)} / ${compactTokenCount(usage.modelContextWindow)} tokens`
  };
}
