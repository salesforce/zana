import type { EventEmitter } from 'node:events';

/**
 * Resolves true once the session is gone (already absent, or its `exit` event fires); false after `timeoutMs`.
 * The listener and timer are always released.
 */
export function waitForSessionExit(
  source: Pick<EventEmitter, 'on' | 'off'>,
  hasSession: (sessionId: string) => boolean,
  sessionId: string,
  timeoutMs: number
): Promise<boolean> {
  if (!hasSession(sessionId)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const done = (value: boolean): void => { clearTimeout(timer); source.off('exit', onExit); resolve(value); };
    const onExit = (exitedId: string): void => { if (exitedId === sessionId) done(true); };
    const timer = setTimeout(() => done(false), timeoutMs);
    source.on('exit', onExit);
  });
}
