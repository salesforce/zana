import { useState } from 'react';
import type { AppConfig, HarnessFamily } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { resolveTierFromRules } from '@zana-ai/zcc-domain/tier-rules';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { Field } from '@/components/settings/FormFields';
import { harnessRowPrefix } from '@/lib/settings-search/providers/harness';
import { HarnessOptionsGroup } from './HarnessView.js';

type Tier = 'low' | 'medium' | 'high' | 'extra-high';
export const MODEL_TIERS: readonly Tier[] = ['low', 'medium', 'high', 'extra-high'];

const TIER_LABEL: Record<Tier, string> = { low: 'Low', medium: 'Medium', high: 'High', 'extra-high': 'Extra-high' };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** True when the harness lists models, so each tier can be pointed at one. */
export function usesTierRules(descriptor?: HarnessAdapterDescriptor): boolean {
  return (descriptor?.targets?.models?.length ?? 0) > 0;
}

/**
 * One row per tier: pick the model that tier uses. "Default" follows the
 * harness's own rule (latest matching model, or its fixed mapping) and tracks
 * new releases; picking a model pins that exact id for the tier.
 */
export function HarnessModelTiers({
  family, label, descriptor, config, onUpdate
}: {
  family: HarnessFamily;
  label: string;
  descriptor?: HarnessAdapterDescriptor;
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void> | void;
}) {
  const [saveError, setSaveError] = useState<string>();
  if (!descriptor || !usesTierRules(descriptor)) return null;
  const models = descriptor.targets?.models ?? [];
  const liveIds = models.map((m) => m.id);
  const disabled = !descriptor.availability.enabled || !descriptor.availability.installed;
  const userRules = config.harnessRouting?.byAdapter?.[family]?.modelTierRules ?? {};
  const seeds = descriptor.targets?.defaultModelTierRules ?? {};
  const fixed: Partial<Record<Tier, string>> = descriptor.targets?.modelLevelMapping ?? {};
  const nameOf = (id: string | undefined) => (id ? (models.find((m) => m.id === id)?.label ?? id) : undefined);

  const write = (tier: Tier, rules: string[] | undefined) => {
    const byAdapter = { ...(config.harnessRouting?.byAdapter ?? {}) };
    const current = byAdapter[family] ?? {};
    const tiers = { ...(current.modelTierRules ?? {}) };
    if (rules && rules.length) tiers[tier] = rules;
    else delete tiers[tier];
    const { modelTierRules: _old, ...rest } = current;
    const next = Object.keys(tiers).length ? { ...rest, modelTierRules: tiers } : rest;
    if (Object.keys(next).length) byAdapter[family] = next;
    else delete byAdapter[family];
    const patch = { harnessRouting: Object.keys(byAdapter).length ? { schemaVersion: 1 as const, byAdapter } : undefined };
    try {
      Promise.resolve(onUpdate(patch)).then(() => setSaveError(undefined), (error: unknown) => setSaveError(describe(error)));
    } catch (error) {
      setSaveError(describe(error));
    }
  };

  return (
    <HarnessOptionsGroup
      title="Model tiers"
      help={`Which ${label} model each portable tier (Low to Extra-high) uses for Persona and Agent model settings.`}
      disabled={disabled}
    >
      {MODEL_TIERS.map((tier) => {
        const user = userRules[tier];
        const custom = !!user?.length;
        const defaultId = resolveTierFromRules(seeds[tier], liveIds) ?? fixed[tier];
        const defaultName = nameOf(defaultId) ?? 'Harness default model';
        // A custom rule may be a name term rather than an id; show the model it resolves to.
        const resolved = custom ? resolveTierFromRules(user, liveIds) : undefined;
        // A stored rule that matches nothing installed still overrides the tier; keep it visible.
        const stale = custom && !resolved ? user![0]! : undefined;
        const selected = resolved ?? stale ?? '';
        return (
          <Field
            key={tier}
            searchId={`${harnessRowPrefix(family)}model-tier-${tier}`}
            label={TIER_LABEL[tier]}
            layout="row"
            help={stale ? 'Custom model is not installed. Choose Default to follow the latest.' : custom ? 'Custom model. Choose Default to follow the latest.' : 'Default. Follows the latest matching model.'}
          >
            <span data-testid={`harness-tier-${tier}`}>
              <PopoverPicklist
                value={selected}
                ariaLabel={`${TIER_LABEL[tier]} tier model`}
                onChange={(id) => write(tier, id ? [id] : undefined)}
                disabled={disabled}
                title={disabled ? descriptor.availability.reason ?? 'Harness unavailable' : undefined}
                options={[
                  { value: '', label: `Default (${defaultName})` },
                  ...(stale ? [{ value: stale, label: `${stale} (not installed)` }] : []),
                  ...models.map((m) => ({ value: m.id, label: m.label }))
                ]}
              />
            </span>
          </Field>
        );
      })}
      {saveError && <p role="alert" className="harness-settings-error">Could not save the model tier: {saveError}</p>}
    </HarnessOptionsGroup>
  );
}
