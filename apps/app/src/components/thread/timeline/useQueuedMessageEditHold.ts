import { useCallback, useEffect, useRef } from 'react';
import { product } from '../../../lib/product-client.js';
import { useUi } from '../../../store.js';

/** Used until the server states the lease it granted. */
const DEFAULT_LEASE_MS = 120_000;
/** The lease is renewed this many times per lease so one missed renewal never lets it lapse. */
const RENEWALS_PER_LEASE = 4;
const MIN_RENEW_MS = 1_000;
/** A failed renewal is retried well inside the lease instead of waiting for the next quarter. */
export const EDIT_HOLD_RETRY_MS = 5_000;

const QUEUED_SEND_CHANGED = 'queued-send-changed';

function httpFailure(error: unknown): { status?: unknown; code?: unknown } {
  return (error as { status?: unknown; code?: unknown } | null | undefined) ?? {};
}

/**
 * The user-facing reason when the server says the row is gone (404) or already claimed (409), else null.
 * Both mean the edit can no longer be applied, so the editor closes instead of retrying. A 409 for a
 * stale revision is not one of them: the row is still waiting, so the editor can stay open.
 */
export function queuedEditRejection(error: unknown): string | null {
  const { status, code } = httpFailure(error);
  if (status === 404) return 'This queued message was already sent or removed, so the edit was closed.';
  if (status === 409 && code !== QUEUED_SEND_CHANGED) return 'This queued message is already being sent, so the edit was closed.';
  return null;
}

/** True when a save was refused because the row changed after the editor opened. */
export function isQueuedEditConflict(error: unknown): boolean {
  const { status, code } = httpFailure(error);
  return status === 409 && code === QUEUED_SEND_CHANGED;
}

function renewalDelay(leaseMs: unknown): number {
  const lease = typeof leaseMs === 'number' && Number.isFinite(leaseMs) && leaseMs > 0 ? leaseMs : DEFAULT_LEASE_MS;
  return Math.max(MIN_RENEW_MS, Math.floor(lease / RENEWALS_PER_LEASE));
}

/**
 * Keeps the server from sending a queued message while the user edits it.
 *
 * The server holds the row for a bounded lease that lapses by itself; this renews it for as long as
 * `itemId` is set and ends it on close. A 404 or 409 means the row is gone or already claimed, so the
 * editor is closed with a toast. Every request is chained behind the previous one so a late grant can
 * never land after the release.
 *
 * Call `pause()` before saving. It stops renewing and resolves once no hold request is in flight, so
 * a renewal can never land after the save ended the lease; it resolves false if the editor was closed
 * meanwhile. Call `resume()` when the save failed and the editor stays open.
 *
 * Call `finish()` once the edit was saved (the save already ended the lease) or otherwise resolved so
 * closing does not send a redundant release.
 */
export function useQueuedMessageEditHold({ threadId, itemId, onRejected }: {
  threadId: string;
  itemId: string | null;
  onRejected: () => void;
}): { finish: () => void; pause: () => Promise<boolean>; resume: () => void } {
  const onRejectedRef = useRef(onRejected);
  onRejectedRef.current = onRejected;
  const releaseOnCloseRef = useRef(true);
  const controlRef = useRef<{ pause: () => Promise<boolean>; resume: () => void } | null>(null);

  useEffect(() => {
    if (!itemId) return undefined;
    releaseOnCloseRef.current = true;
    let closed = false;
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let chain: Promise<unknown> = Promise.resolve();

    const schedule = (delayMs: number) => {
      if (!paused) timer = setTimeout(hold, delayMs);
    };
    const reject = (message: string) => {
      closed = true;
      releaseOnCloseRef.current = false;
      useUi.getState().pushToast(message, 'error');
      onRejectedRef.current();
    };
    function hold() {
      timer = undefined;
      chain = chain.then(async () => {
        if (closed || paused) return;
        try {
          const lease = await product.threads.holdNextTurnForEdit(threadId, itemId!);
          if (!closed) schedule(renewalDelay(lease?.leaseMs));
        } catch (error) {
          if (closed) return;
          const rejection = queuedEditRejection(error);
          if (rejection) reject(rejection);
          else schedule(EDIT_HOLD_RETRY_MS);
        }
      });
    }

    const control = {
      pause: async () => {
        paused = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        await chain;
        return !closed;
      },
      resume: () => {
        if (closed || !paused) return;
        paused = false;
        // Time passed while saving, so renew now rather than on the old schedule.
        hold();
      }
    };
    controlRef.current = control;

    hold();
    return () => {
      closed = true;
      if (controlRef.current === control) controlRef.current = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!releaseOnCloseRef.current) return;
      // Best effort: the lease expires on its own, so a lost release only delays the send.
      chain = chain.then(() => product.threads.releaseNextTurnEditHold(threadId, itemId)).catch(() => undefined);
    };
  }, [threadId, itemId]);

  const finish = useCallback(() => { releaseOnCloseRef.current = false; }, []);
  const pause = useCallback(() => controlRef.current?.pause() ?? Promise.resolve(true), []);
  const resume = useCallback(() => { controlRef.current?.resume(); }, []);
  return { finish, pause, resume };
}
