import { randomUUID } from 'node:crypto';

export function createHostId(): string {
  return randomUUID();
}

export function createHostSessionId(): string {
  return randomUUID();
}

export function createEnvironmentId(): string {
  return randomUUID();
}

export function createThreadId(): string {
  return randomUUID();
}

export function createEventId(): string {
  return randomUUID();
}

export function createPendingInteractionId(): string {
  return `pint_${randomUUID()}`;
}

export function createDeferredThreadMessageId(): string {
  return `dmsg_${randomUUID()}`;
}

export function createThreadPlanId(): string {
  return `tplan_${randomUUID()}`;
}

export function createThreadPlanRevisionId(): string {
  return `tprev_${randomUUID()}`;
}

export function createThreadPlanTaskId(): string {
  return `tptask_${randomUUID()}`;
}

export function createThreadPlanReferenceId(): string {
  return `tpref_${randomUUID()}`;
}
