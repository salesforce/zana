import type { HarnessFamily, Persona, PersonaHarnessIntentV1 } from '@zana-ai/zcc-domain/product';
import { harnessFamilyOf } from '@zana-ai/zcc-domain/launch-provider';

const EXECUTION_FROM_NATIVE: Record<string, NonNullable<PersonaHarnessIntentV1['executionState']>> = {
  plan: 'plan',
  default: 'interactive',
  acceptEdits: 'accept-edits',
  'accept-edits': 'accept-edits',
  bypassPermissions: 'autonomous',
  autonomous: 'autonomous'
};

export function effectivePersonaRouting(persona: Persona | null): NonNullable<Persona['harnessRouting']>['byAdapter'] {
  const byAdapter = structuredClone(persona?.harnessRouting?.byAdapter ?? {});
  if (!persona?.baseProfile) return byAdapter;

  const family = harnessFamilyOf(persona.baseProfile);
  if (!family) return byAdapter;
  const current = byAdapter[family] ?? {};
  const executionTarget = current.executionTargetId ?? persona.permissionMode;
  byAdapter[family] = {
    ...current,
    modelTargetId: current.modelTargetId ?? (persona.model !== 'default' ? persona.model : undefined),
    executionState: current.executionState
      ?? persona.executionState
      ?? (executionTarget ? EXECUTION_FROM_NATIVE[executionTarget] : undefined)
  };
  return byAdapter;
}

export function personaRoutingSummary(persona: Persona): string[] {
  const family = persona.baseProfile ? harnessFamilyOf(persona.baseProfile) : null;
  const routing = family ? effectivePersonaRouting(persona)[family] : undefined;
  return [
    persona.baseProfile,
    routing?.modelTargetId ?? persona.modelLevel,
    routing?.executionState ?? persona.executionState
  ].filter((value): value is string => !!value && value !== 'default');
}
