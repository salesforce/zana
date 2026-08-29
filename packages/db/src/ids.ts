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
