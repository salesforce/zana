import type { HarnessExecutionTarget } from '../../shared/harness-adapter.js';
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

export interface ExecutionConsentDialogRequest { text: string }
export type ExecutionConsentDialogResult =
  | { decision: 'cancel' }
  | { decision: 'approve'; scope: ExecutionConsentScope };

export class ExecutionConsentService {
  constructor(private readonly deps: {
    store: ExecutionConsentStore;
    showDialog: (request: ExecutionConsentDialogRequest) => Promise<ExecutionConsentDialogResult>;
  }) {}

  async request(input: ExecutionConsentCeremonyInput): Promise<
    { decision: 'granted'; grant: ExecutionConsentGrant } | { decision: 'denied'; reason: string }
  > {
    if (input.mode !== 'interactive') return { decision: 'denied', reason: `${input.mode} ceremony cannot mint consent` };
    const result = await this.deps.showDialog({ text: ceremonyText(input) });
    if (result.decision !== 'approve') return { decision: 'denied', reason: 'user cancelled' };
    if (result.scope !== 'one-launch' && result.scope !== 'project') {
      return { decision: 'denied', reason: 'unsupported consent scope' };
    }
    const grant = await this.deps.store.grant({
      adapterId: input.adapterId,
      targetId: input.target.id,
      targetDigest: input.targetDigest,
      evidenceDigest: input.evidenceDigest,
      projectId: input.projectId,
      launchScope: input.launchScope,
      scope: result.scope,
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

function ceremonyText(input: ExecutionConsentCeremonyInput): string {
  const { target } = input;
  return [
    `Adapter: ${input.adapterId}`,
    `Target: ${target.id}`,
    `Project: ${input.projectId}`,
    `Launch scope: ${input.launchScope}`,
    `Effect: ${target.effect}`,
    `Material difference: ${target.materialDifference}`,
    `Risk: ${target.risk}`,
    `Evidence: ${target.evidence.id} v${target.evidence.version} (${input.evidenceDigest})`,
    'Consent scope choices: one launch or this project.'
  ].join('\n');
}
