import type { HarnessExecutionTarget } from '@zana-ai/zcc-domain/harness-adapter';
import { randomUUID } from 'node:crypto';
import type {
  ExecutionConsentBinding,
  ExecutionConsentGrant,
  ExecutionConsentScope,
  createExecutionConsentStore
} from './execution-consent-store.js';

type ExecutionConsentStore = ReturnType<typeof createExecutionConsentStore>;
export type ExecutionConsentCeremonyMode = 'interactive' | 'headless' | 'unattended';

export interface ExecutionConsentCeremonyInput {
  adapterId: string;
  target: HarnessExecutionTarget;
  targetDigest: string;
  evidenceDigest: string;
  projectId: string;
  launchScope: 'local' | 'remote';
  mode: ExecutionConsentCeremonyMode;
  expiresAt?: number;
}

export class ExecutionConsentService {
  constructor(private readonly deps: {
    store: ExecutionConsentStore;
  }) {}

  async request(input: ExecutionConsentCeremonyInput): Promise<
    { decision: 'granted'; grant: ExecutionConsentGrant } | { decision: 'denied'; reason: string }
  > {
    if (input.mode !== 'interactive') return { decision: 'denied', reason: `${input.mode} ceremony cannot mint consent` };
    // Closest/conditional mappings (e.g. Cursor interactive native policy) are already
    // adapter-owner reviewed. Interactive launches auto-grant project scope so
    // the native warning is not a launch blocker. Headless/unattended still
    // cannot mint consent here.
    const grant = await this.deps.store.grant({
      adapterId: input.adapterId,
      targetId: input.target.id,
      targetDigest: input.targetDigest,
      evidenceDigest: input.evidenceDigest,
      projectId: input.projectId,
      launchScope: input.launchScope,
      scope: 'project',
      expiresAt: input.expiresAt
    });
    return { decision: 'granted', grant };
  }

  async findGrant(input: Omit<ExecutionConsentBinding, 'targetId'> & { scope: ExecutionConsentScope; mode: ExecutionConsentCeremonyMode; target: HarnessExecutionTarget }) {
    if (input.mode === 'unattended' && input.target.unattendedAllowed === false) {
      return { decision: 'denied' as const, reason: 'target disallows unattended execution' };
    }
    const reservation = await this.deps.store.reserve({
      adapterId: input.adapterId, targetId: input.target.id, targetDigest: input.targetDigest,
      evidenceDigest: input.evidenceDigest, projectId: input.projectId, scope: input.scope,
      launchScope: input.launchScope,
      idempotencyKey: `lookup:${randomUUID()}`
    });
    if (reservation.outcome === 'denied') return { decision: 'denied' as const, reason: 'no matching consent' };
    await this.deps.store.release(reservation.reservation.id);
    return { decision: 'granted' as const, grant: reservation.grant };
  }
}
