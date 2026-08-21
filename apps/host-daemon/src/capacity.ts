import { totalmem } from 'node:os';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { SESSION_MEMORY_DEFAULTS } from '@zana-ai/zcc-domain/product';

export function computeMaxLiveSessions(totalRamBytes: number): number {
  const {
    minLiveSessions,
    defaultLiveSessions,
    perSessionBudgetMB,
    ramFractionForSessions
  } = SESSION_MEMORY_DEFAULTS;
  const ramMB = totalRamBytes / (1024 * 1024);
  const derived = Math.floor((ramMB * ramFractionForSessions) / perSessionBudgetMB);
  return Math.max(minLiveSessions, Math.min(defaultLiveSessions, derived));
}

const DEFAULT_MAX_LIVE_SESSIONS = computeMaxLiveSessions(totalmem());

export function resolveMaxLiveSessions(config?: AppConfig): number {
  const explicit = config?.maxLiveSessions;
  const base = typeof explicit === 'number' && explicit > 0 ? explicit : DEFAULT_MAX_LIVE_SESSIONS;
  return Math.max(
    SESSION_MEMORY_DEFAULTS.minLiveSessions,
    Math.min(SESSION_MEMORY_DEFAULTS.maxLiveSessionsCeiling, Math.round(base))
  );
}
