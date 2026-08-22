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
