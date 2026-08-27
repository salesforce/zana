import type {
  EnvelopeKind,
  GuardrailDecision,
  OrgKind,
  SafetyEnvelope
} from './types.js';
import { isConfirmingOrg } from './org-resolution.js';

export interface GuardrailRequest {
  threadId: string;
  orgAlias: string;
  orgId?: string;
  orgKind: OrgKind;
  kind?: EnvelopeKind;
  summary: string;
  fingerprint?: string;
  preview?: string;
}

type ConfirmFn = (envelope: SafetyEnvelope, threadId: string) => Promise<GuardrailDecision>;

export class Guardrail {
  private readonly session = new Map<string, true>();

  constructor(private readonly confirm: ConfirmFn) {}

  clearThread(threadId: string): void {
    for (const key of [...this.session.keys()]) {
      if (key.startsWith(`${threadId}:`)) this.session.delete(key);
    }
  }

  async mediate(request: GuardrailRequest): Promise<GuardrailDecision> {
    const kind = request.kind ?? orgReadEnvelope(request.orgKind);
    if (!kind) return { approved: true, reason: 'submitted' };
    if (!request.threadId) return { approved: false, reason: 'headless' };

    const envelope: SafetyEnvelope = {
      kind,
      orgAlias: request.orgAlias,
      orgId: request.orgId,
      orgKind: request.orgKind,
      summary: request.summary,
      fingerprint: request.fingerprint,
      preview: request.preview
    };
    const key = sessionKey(request.threadId, envelope);
    if (reusesSession(kind) && this.session.has(key)) return { approved: true, reason: 'submitted' };

    const decision = await this.confirm(envelope, request.threadId);
    if (decision.approved && reusesSession(kind)) this.session.set(key, true);
    return decision;
  }
}

export function reusesSession(kind: EnvelopeKind): boolean {
  return kind !== 'agent.publish' && kind !== 'agent.activate';
}

export function orgReadEnvelope(kind: OrgKind): EnvelopeKind | undefined {
  if (kind === 'production') return 'org.production.read';
  if (kind === 'unknown') return 'org.unknown.read';
  return undefined;
}

export function sessionKey(threadId: string, envelope: SafetyEnvelope): string {
  const org = envelope.orgId || envelope.orgAlias;
  const finger = envelope.fingerprint ?? '*';
  return `${threadId}:${envelope.kind}:${org}:${finger}`;
}

export function envelopeTitle(kind: EnvelopeKind): string {
  switch (kind) {
    case 'org.production.read':
      return 'Confirm production org access';
    case 'org.unknown.read':
      return 'Confirm unknown org access';
    case 'apex.anonymous':
      return 'Confirm anonymous Apex';
    case 'soql.unbounded':
      return 'Confirm unbounded SOQL';
    case 'soql.export':
      return 'Confirm SOQL export';
    case 'agent.publish':
      return 'Confirm Agent Script publish';
    case 'agent.activate':
      return 'Confirm Agent Script activate';
    default:
      return 'Confirm Salesforce action';
  }
}

export { isConfirmingOrg };
