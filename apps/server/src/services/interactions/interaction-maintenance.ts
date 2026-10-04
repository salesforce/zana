import type { ZccDatabase } from '@zana-ai/zcc-db';
import { InteractionService } from './interaction-service.js';

const DAILY_MS = 24 * 60 * 60 * 1000;
/** Utilization at or above this fraction of the global quota is worth an operator's attention. */
const UTILIZATION_ALERT_THRESHOLD = 0.8;

/** Startup sweep plus a daily scheduled cleanup, matching the plan's bounded-retention requirement; emits utilization/oldest-age for operator alerting. */
export function startInteractionMaintenance(db: ZccDatabase): () => void {
  const service = new InteractionService(db);
  const sweep = () => {
    try {
      service.prune();
      const metrics = service.metrics();
      if (metrics.utilization >= UTILIZATION_ALERT_THRESHOLD) {
        console.warn('[interactions] global quota utilization high:', metrics);
      }
    } catch (error) {
      console.warn('[interactions] maintenance deferred:', error instanceof Error ? error.message : 'database unavailable');
    }
  };
  sweep();
  const timer = setInterval(sweep, DAILY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
