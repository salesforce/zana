import type { Persona } from '@zana-ai/zcc-domain/product';
import type { LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';

/**
 * The persona's legacy `model` string when the provider's static catalog can
 * say it is unknown, otherwise undefined. Advisory input only: it never blocks
 * a launch. "Cannot answer" (no persona model, a provider that accepts unlisted
 * targets, a live-probed or empty catalog) returns undefined, so no warning is
 * raised. Pure and synchronous: no network call and no spawn.
 */
export function unknownLegacyPersonaModel(
  provider: Pick<LaunchProvider, 'acceptsUnlistedModelTargets' | 'discoverModelTargets' | 'adapter'>,
  persona: Pick<Persona, 'model'> | undefined
): string | undefined {
  const model = persona?.model?.trim();
  if (!model || model === 'default') return undefined;
  if (provider.acceptsUnlistedModelTargets || provider.discoverModelTargets) return undefined;
  const catalog = provider.adapter.descriptor.targets?.models;
  if (!catalog || catalog.length === 0) return undefined;
  return catalog.some((candidate) => candidate.id === model) ? undefined : model;
}

/** Inbox text for an unknown persona model; names only, no paths or credentials. */
export function unknownPersonaModelMessage(personaName: string, model: string, harnessLabel: string): string {
  return `Persona "${personaName}" names model "${model}", which the ${harnessLabel} model catalog does not list. The worker may fail to start or stall. The launch continued.`;
}

export interface PersonaModelWarningDeps {
  slots: ReadonlyArray<{ personaId: string }>;
  personas: ReadonlyArray<Pick<Persona, 'id' | 'name' | 'model'>>;
  providerFor: (personaId: string) => Parameters<typeof unknownLegacyPersonaModel>[0] & { adapter: { descriptor: { label: string } } };
  project: { id: string; name: string };
  notify: (notice: { projectId: string; projectLabel: string; subject: string; comments: string; dedupeKey: string }) => Promise<unknown>;
  onError: (source: string, error: unknown) => void;
}

/** Raises one deduped notice per persona/model the catalog cannot place. Never throws and never blocks a launch. */
export function warnUnknownPersonaModels(deps: PersonaModelWarningDeps): void {
  const seen = new Set<string>();
  for (const slot of deps.slots) {
    if (seen.has(slot.personaId)) continue;
    seen.add(slot.personaId);
    try {
      const persona = deps.personas.find((candidate) => candidate.id === slot.personaId);
      const provider = deps.providerFor(slot.personaId);
      const model = unknownLegacyPersonaModel(provider, persona);
      if (!persona || !model) continue;
      void deps.notify({
        projectId: deps.project.id,
        projectLabel: deps.project.name,
        subject: 'Persona model not recognised',
        comments: unknownPersonaModelMessage(persona.name, model, provider.adapter.descriptor.label),
        dedupeKey: `persona-unknown-model:${deps.project.id}:${persona.id}:${model}`
      }).catch((error) => deps.onError('persona model warning inbox', error));
    } catch (error) {
      deps.onError('persona model check', error);
    }
  }
}
