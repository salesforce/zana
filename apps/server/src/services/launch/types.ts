export type LaunchPrincipalKind = 'interactive-user' | 'schedule' | 'team' | 'automation';

export interface LaunchPrincipalBase {
  id: string;
  allowedProjectIds: string[];
  maxConcurrent: number;
  maxLaunchesPerRun: number;
}

export type LaunchPrincipal =
  | (LaunchPrincipalBase & { kind: 'interactive-user' })
  | (LaunchPrincipalBase & { kind: 'schedule' })
  | (LaunchPrincipalBase & { kind: 'team'; allowedTeamIds: string[] })
  | (LaunchPrincipalBase & { kind: 'automation' });

export function bindLaunchPrincipal(
  principal: LaunchPrincipalRef,
  limits: LaunchPrincipalBase,
  teamId?: string
): LaunchPrincipal | undefined {
  if (principal.kind === 'team') {
    if (!teamId) return undefined;
    return { ...limits, kind: 'team', allowedTeamIds: [teamId] };
  }
  return { ...limits, kind: principal.kind };
}

export type LaunchAuthorizationState = 'authorized' | 'consumed' | 'expired' | 'revoked';
export type LaunchLedgerState = 'authorized' | 'committing' | 'launched' | 'exited' | 'denied' | 'failed' | 'interrupted';

export interface LaunchPrincipalRef {
  kind: LaunchPrincipalKind;
  id: string;
}

export interface LaunchAuthorization {
  id: string;
  principal: LaunchPrincipalRef;
  projectId: string;
  launchDigest: string;
  binding: LaunchAuthorizationBinding;
  state: LaunchAuthorizationState;
  createdAt: number;
  expiresAt?: number;
  consumedAt?: number;
  revokedAt?: number;
}

export type LaunchConsumerKind = 'terminal' | 'team-slot' | 'orchestrator-child';

export interface LaunchAuthorizationBinding {
  consumerKind: LaunchConsumerKind;
  personaId?: string;
  profileId?: string;
  teamId?: string;
  slotId?: string;
  evidenceDigest?: string;
  initialTaskDigest: string;
  consentReservation?: { id: string; scope: string };
  scope: 'local' | 'remote';
  storeRevision: string;
  projectIdentityDigest: string;
  autonomous: boolean;
  expiresAt: number;
  deadlineAt?: number;
}
