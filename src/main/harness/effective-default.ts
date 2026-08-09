import type {
  AppConfig,
  EffectiveHarnessDefaultResult,
  HarnessVerifyResult,
  Persona,
  Project
} from '../../shared/types.js';
import { harnessFamilyOf } from '../../shared/launch-provider.js';
import { resolveLaunchSelection } from './launch-selection.js';

/** Resolve a Home launch default from main-owned state and reject a missing CLI. */
export function resolveEffectiveHarnessDefault(input: {
  project: Project | undefined;
  config: AppConfig;
  personas: readonly Persona[];
  availability: readonly HarnessVerifyResult[];
}): EffectiveHarnessDefaultResult {
  if (!input.project) {
    return { ok: false, code: 'NOT_FOUND', message: 'Project not found' };
  }

  const selection = resolveLaunchSelection({
    config: input.config,
    project: input.project,
    personas: input.personas,
    requestedProfile: 'claude',
    requestedSource: 'seeded-default'
  });
  if (!selection.ok) {
    return { ok: false, code: 'UNAVAILABLE_DEFAULT', message: selection.message };
  }

  const family = harnessFamilyOf(selection.profile);
  const status = family && input.availability.find((candidate) => candidate.family === family);
  if (!family || !status?.enabled || !status.installed) {
    return {
      ok: false,
      code: 'UNAVAILABLE_DEFAULT',
      message: 'Configured default harness is disabled or unavailable'
    };
  }
  return { ok: true, profile: selection.profile, family, source: selection.source as Exclude<typeof selection.source, 'explicit'> };
}
