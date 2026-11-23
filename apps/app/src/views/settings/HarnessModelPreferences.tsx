import { useState } from 'react';
import { reasoningLevelSchema, reconcileReasoningLevel, type AvailableModel } from '@zana-ai/zcc-domain/thread-runtime';
import { Field } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { defaultOfferedComposerModel, rememberComposerSelection, rememberedSelectionFor } from '@/components/thread/pickers/composer-selection-preference';
import { REASONING_LABELS, visibleComposerReasoningLevels } from '@/components/thread/pickers/reasoning-labels';

function effortFor(model: AvailableModel, preferred?: string) {
  const offered = visibleComposerReasoningLevels(model.supportedReasoningEfforts.map(e => e.reasoningEffort));
  const parsed = reasoningLevelSchema.safeParse(preferred);
  const previous = parsed.success ? parsed.data : model.defaultReasoningEffort;
  return { offered, value: offered.length ? reconcileReasoningLevel(previous, offered) : model.defaultReasoningEffort };
}

/** Mount with the provider as key so a selection never carries over to another harness. */
export function HarnessModelPreferences({ providerId, models, moreModels = [] }: {
  providerId: string;
  models: readonly AvailableModel[];
  moreModels?: readonly AvailableModel[];
}) {
  const [selection, setSelection] = useState(() => rememberedSelectionFor(providerId));
  const [failed, setFailed] = useState(false);
  const allModels = models.concat(moreModels);
  const model = allModels.find(row => row.model === selection?.model) ?? defaultOfferedComposerModel(models, moreModels);
  if (!model) return null;
  const effort = effortFor(model, selection?.reasoningLevel);
  function choose(row: AvailableModel, preferred?: string) {
    const level = effortFor(row, preferred).value;
    rememberComposerSelection({ providerId, model: row.model, reasoningLevel: level, rememberProvider: false });
    const saved = rememberedSelectionFor(providerId);
    setFailed(saved?.model !== row.model || saved.reasoningLevel !== level);
    setSelection(saved);
  }
  return <>
    <Field label="Model" layout="row" searchId="composer.model" help="Remembered for this harness on this device.">
      <PopoverPicklist ariaLabel="Model" value={model.model} options={models.map(row => ({ value: row.model, label: row.displayName, group: '' }))
          .concat(moreModels.map(row => ({ value: row.model, label: row.displayName, group: 'More models' })))}
        onChange={value => { const next = allModels.find(row => row.model === value); if (next) choose(next, effort.value); }} />
    </Field>
    {effort.offered.length > 0 && <Field label="Thinking effort" layout="row" searchId="composer.effort">
      <PopoverPicklist ariaLabel="Thinking effort" value={effort.value} searchable={false}
        options={effort.offered.map(value => ({ value, label: REASONING_LABELS[value] }))}
        onChange={value => choose(model, value)} />
    </Field>}
    {failed && <p role="alert" className="settings-help">Could not save the model preference on this device.</p>}
  </>;
}
