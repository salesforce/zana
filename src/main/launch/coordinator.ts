import type { LaunchPreflight } from './preflight.js';

export interface LaunchCoordinatorDeps<TRequest, TResolved, TSession> {
  ledger: {
    claim: (input: { idempotencyKey: string; launchDigest: string; authorizationId: string; sessionId: string; consentReservationId?: string; principal: LaunchPreflight<TRequest, TResolved>['principal']; binding: LaunchPreflight<TRequest, TResolved>['binding'] }) => Promise<{
      outcome: 'claimed' | 'replay' | 'conflict'; entry: { id: string }
    }>;
    transition: (
      entryId: string,
      state: 'committing' | 'launched' | 'denied' | 'failed',
      expectedState?: 'authorized' | 'committing'
    ) => Promise<unknown>;
  };
  executionConsent?: {
    consume: (reservationId: string) => Promise<{ outcome: 'consumed' | 'denied' }>;
    release: (reservationId: string) => Promise<void>;
  };
  authorize: {
    authorize: (input: { principal: LaunchPreflight<TRequest, TResolved>['principal']; projectId: string; launchDigest: string; binding: LaunchPreflight<TRequest, TResolved>['binding']; expiresAt?: number }) =>
      | { decision: 'authorized'; authorization: { id: string } }
      | { decision: 'denied'; reason: string };
    consume: (id: string, digest: string) => { ok: true } | { ok: false; reason: string };
    consumePreissued?: (id: string, expected: { principal: LaunchPreflight<TRequest, TResolved>['principal']; projectId: string; binding: LaunchPreflight<TRequest, TResolved>['binding'] }) => { ok: true } | { ok: false; reason: string };
    complete?: (id: string) => void;
  };
  revalidate?: (plan: LaunchPreflight<TRequest, TResolved>) => { ok: true } | { ok: false; reason: string } | Promise<{ ok: true } | { ok: false; reason: string }>;
  spawn: (plan: LaunchPreflight<TRequest, TResolved> & { sessionId: string }) => TSession | Promise<TSession>;
  onCommitted?: (input: { ledgerEntryId: string; authorizationId: string; sessionId: string }) => void | Promise<void>;
  beforeSpawn?: (input: { ledgerEntryId: string; authorizationId: string; sessionId: string }) => boolean | Promise<boolean>;
  afterSpawn?: (input: { ledgerEntryId: string; authorizationId: string; session: TSession }) => boolean | Promise<boolean>;
  terminateSpawned?: (session: TSession) => boolean | Promise<boolean>;
  onLaunched?: (input: { ledgerEntryId: string; authorizationId: string; session: TSession }) => void | Promise<void>;
  onLedgerError?: (error: unknown, input: { ledgerEntryId: string; session: TSession }) => void | Promise<void>;
  now?: () => number;
}

export class LaunchSpawnError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function createLaunchCoordinator<TRequest, TResolved, TSession>(
  deps: LaunchCoordinatorDeps<TRequest, TResolved, TSession>
) {
  let commitTail: Promise<unknown> = Promise.resolve();
  const runCommit = <T>(task: () => Promise<T>): Promise<T> => {
    const result = commitTail.then(task, task);
    commitTail = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    async launch(plan: LaunchPreflight<TRequest, TResolved> & { executionAuthorization?: { consentReservation?: { id: string } }; preissuedAuthorization?: { id: string; binding: LaunchPreflight<TRequest, TResolved>['binding'] } }) {
      const reservationId = plan.executionAuthorization?.consentReservation?.id;
      let consentClaimed = false;
      const releaseReservation = async () => {
        if (reservationId && !consentClaimed && deps.executionConsent) {
          await deps.executionConsent.release(reservationId);
        }
      };
      const decision = plan.preissuedAuthorization ? {
        decision: 'authorized' as const,
        authorization: { id: plan.preissuedAuthorization.id }
      } : deps.authorize.authorize({
        principal: plan.principal,
        projectId: projectIdOf(plan.resolved),
        launchDigest: plan.digest,
        binding: plan.binding,
        expiresAt: plan.binding.expiresAt
      });
      if (decision.decision === 'denied') {
        try {
          await releaseReservation();
        } catch {
          // Keep denial response independent of cleanup persistence.
        }
        return { ok: false as const, code: 'DENIED', message: decision.reason };
      }

      let claim: Awaited<ReturnType<typeof deps.ledger.claim>>;
      try {
        claim = await deps.ledger.claim({
          idempotencyKey: plan.idempotencyKey,
          launchDigest: plan.digest,
          authorizationId: decision.authorization.id,
          sessionId: plan.sessionId,
          consentReservationId: reservationId,
          principal: plan.principal,
          binding: plan.binding
        });
      } catch (error) {
        deps.authorize.complete?.(decision.authorization.id);
        await releaseReservation();
        return { ok: false as const, code: 'COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) };
      }
      if (claim.outcome !== 'claimed') {
        deps.authorize.complete?.(decision.authorization.id);
        await releaseReservation();
        return {
          ok: false as const,
          code: claim.outcome === 'replay' ? 'REPLAY' : 'CONFLICT',
          message: `launch ${claim.outcome}`
        };
      }
      const consumed = plan.preissuedAuthorization
        ? deps.authorize.consumePreissued?.(decision.authorization.id, {
            principal: plan.principal,
            projectId: projectIdOf(plan.resolved),
            binding: plan.preissuedAuthorization.binding
          }) ?? { ok: false as const, reason: 'preissued authorization validation unavailable' }
        : deps.authorize.consume(decision.authorization.id, plan.digest);
      if (!consumed.ok) {
        deps.authorize.complete?.(decision.authorization.id);
        try {
          await releaseReservation();
        } catch {
          // Keep denial response independent of cleanup persistence.
        }
        try {
          await deps.ledger.transition(claim.entry.id, 'denied', 'authorized');
        } catch {
          // Cleanup failure must not expose authorization or consent state.
        }
        return { ok: false as const, code: 'DENIED', message: consumed.reason };
      }

      const committed = await runCommit(async () => {
        const revalidated = await deps.revalidate?.(plan) ?? { ok: true as const };
        if (!revalidated.ok) {
          try {
            await deps.ledger.transition(claim.entry.id, 'denied', 'authorized');
          } catch {
            // Refusal remains authoritative; cleanup is best-effort.
          }
          return { ok: false as const, code: 'STALE_PREFLIGHT', message: revalidated.reason };
        }
        if (reservationId) {
          if (!deps.executionConsent) {
            await deps.ledger.transition(claim.entry.id, 'failed', 'authorized');
            return { ok: false as const, code: 'DENIED', message: 'execution consent store unavailable' };
          }
          try {
            const consent = await deps.executionConsent.consume(reservationId);
            if (consent.outcome !== 'consumed') {
              await deps.ledger.transition(claim.entry.id, 'failed', 'authorized');
              return { ok: false as const, code: 'DENIED', message: 'execution consent consume failed' };
            }
            consentClaimed = true;
          } catch (error) {
            await deps.ledger.transition(claim.entry.id, 'failed', 'authorized');
            return { ok: false as const, code: 'COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) };
          }
        }
        try {
          // Consent is durable first. Failure here deliberately over-consumes
          // one-launch consent rather than risking reuse after a crash.
          await deps.ledger.transition(claim.entry.id, 'committing', 'authorized');
        } catch (error) {
          return { ok: false as const, code: 'COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) };
        }
        return { ok: true as const };
      });
      if (!committed.ok) {
        deps.authorize.complete?.(decision.authorization.id);
        return committed;
      }
      try {
        await deps.onCommitted?.({
          ledgerEntryId: claim.entry.id,
          authorizationId: decision.authorization.id,
          sessionId: plan.sessionId
        });
      } catch (error) {
        await deps.ledger.transition(claim.entry.id, 'failed', 'committing');
        deps.authorize.complete?.(decision.authorization.id);
        return { ok: false as const, code: 'COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) };
      }
      let value: TSession;
      let cancellationCleanupPending = false;
      try {
        if (plan.binding.deadlineAt !== undefined && plan.binding.deadlineAt <= (deps.now ?? Date.now)()) {
          await deps.ledger.transition(claim.entry.id, 'failed', 'committing');
          deps.authorize.complete?.(decision.authorization.id);
          return { ok: false as const, code: 'DEADLINE_EXCEEDED', message: 'launch deadline elapsed before spawn' };
        }
        if (deps.beforeSpawn && !await deps.beforeSpawn({
          ledgerEntryId: claim.entry.id,
          authorizationId: decision.authorization.id,
          sessionId: plan.sessionId
        })) {
          await deps.ledger.transition(claim.entry.id, 'failed', 'committing');
          deps.authorize.complete?.(decision.authorization.id);
          return { ok: false as const, code: 'CANCELED', message: 'launch canceled before spawn' };
        }
        value = await deps.spawn(plan);
        if (deps.afterSpawn && !await deps.afterSpawn({
          ledgerEntryId: claim.entry.id,
          authorizationId: decision.authorization.id,
          session: value
        })) {
          try {
            cancellationCleanupPending = await deps.terminateSpawned?.(value) !== true;
          } catch (error) {
            cancellationCleanupPending = true;
            await deps.onLedgerError?.(error, { ledgerEntryId: claim.entry.id, session: value });
          }
          if (!cancellationCleanupPending) {
            throw new LaunchSpawnError('CANCELED', 'launch canceled during spawn');
          }
        }
      } catch (error) {
        await deps.ledger.transition(claim.entry.id, 'failed', 'committing');
        deps.authorize.complete?.(decision.authorization.id);
        return {
          ok: false as const,
          code: error instanceof LaunchSpawnError ? error.code : 'PTY_SPAWN_FAILED',
          message: error instanceof Error ? error.message : String(error)
        };
      }
      try {
        await deps.onLaunched?.({ ledgerEntryId: claim.entry.id, authorizationId: decision.authorization.id, session: value });
      } catch (error) {
        await deps.onLedgerError?.(error, { ledgerEntryId: claim.entry.id, session: value });
      }
      try {
        await deps.ledger.transition(claim.entry.id, 'launched', 'committing');
      } catch (error) {
        // Spawn already happened. Preserve success and session ownership; startup
        // reconciliation will mark durable committing state interrupted.
        await deps.onLedgerError?.(error, { ledgerEntryId: claim.entry.id, session: value });
      }
      return cancellationCleanupPending
        ? {
            ok: false as const,
            code: 'CANCEL_PENDING',
            message: 'launch canceled but spawned session cleanup failed; retry cancellation'
          }
        : { ok: true as const, value };
    }
  };
}

function projectIdOf(resolved: unknown): string {
  if (!resolved || typeof resolved !== 'object') throw new Error('preflight did not resolve project');
  const project = (resolved as { project?: unknown }).project;
  if (!project || typeof project !== 'object' || typeof (project as { id?: unknown }).id !== 'string') {
    throw new Error('preflight did not resolve project');
  }
  return (project as { id: string }).id;
}
