import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

/**
 * A manual run resolves ok once the attempt is recorded, even when the launch
 * itself was refused (e.g. unmet Squad requirements). Returns the failure cause
 * of the newest run so callers can show it instead of a false "Fired".
 */
export function failedRunMessage(task: ScheduledTask | undefined): string | undefined {
  const latest = task?.status.runs[0];
  if (!latest || latest.result !== 'error') return undefined;
  return latest.message?.trim() || 'the run failed without a recorded cause';
}
