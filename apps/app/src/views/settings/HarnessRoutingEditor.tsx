import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type {
  HarnessFamily,
  HarnessModelRoutingV1,
  LaunchProfileId
} from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { Field } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { Skeleton } from '@/components/ui/Skeleton';
import { profileIcon } from '@/lib/profileIcon';
import { sortHarnessDisplayRows } from '@/lib/harness-display-order';

/** Descriptor shape the editor renders. Aliased until the SDK exports its own routing descriptor. */
export type HarnessRoutingDescriptor = HarnessAdapterDescriptor;

type AdapterRouting = NonNullable<HarnessModelRoutingV1['byAdapter'][HarnessFamily]>;

export interface HarnessRoutingPatch {
  providerTargetId?: string;
  modelTargetId?: string;
  executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
}

export type HarnessEditorTab = 'launch' | 'harness' | 'files';

const FAMILY_PROFILE: Record<HarnessFamily, LaunchProfileId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode',
  grok: 'grok',
  mastracode: 'mastracode',
  afcode: 'afcode'
};

const TABS: ReadonlyArray<readonly [HarnessEditorTab, string]> = [
  ['launch', 'Zana Settings'],
  ['harness', 'Harness Settings'],
  ['files', 'Harness Files']
];

const portableLabel = (value: string) => value
  .split('-')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

/** Merge a patch into one adapter's routing; undefined values clear keys, empty results prune. */
export function applyHarnessRoutingPatch(
  value: HarnessModelRoutingV1 | undefined,
  adapterId: HarnessFamily,
  patch: HarnessRoutingPatch
): HarnessModelRoutingV1 | undefined {
  const byAdapter = { ...(value?.byAdapter ?? {}) };
  const next: AdapterRouting = { ...(byAdapter[adapterId] ?? {}), ...patch };
  for (const key of Object.keys(next) as Array<keyof AdapterRouting>) {
    if (next[key] === undefined) delete next[key];
  }
  if (Object.keys(next).length) byAdapter[adapterId] = next;
  else delete byAdapter[adapterId];
  return Object.keys(byAdapter).length ? { schemaVersion: 1 as const, byAdapter } : undefined;
}

export interface HarnessRoutingEditorProps {
  descriptors: HarnessRoutingDescriptor[];
  value: HarnessModelRoutingV1 | undefined;
  onChange(adapterId: HarnessFamily, patch: HarnessRoutingPatch): void;
  /** Label of the inherit option, e.g. "Use global default" / "Use project default". */
  inheritLabel?: string;
  /** Shows skeletons and hides rows while descriptors or the value are loading. */
  loading?: boolean;
  /** Optional default-harness picker rendered above the rows. */
  defaultHarness?: {
    value: string;
    onChange(adapterId: string): void;
  };
  /** Rendered between the default-harness picker and the rows (e.g. an error banner). */
  notice?: ReactNode;
  /** Host-specific launch fields appended to a row's launch tab; return null when none. */
  renderLaunchExtras?(descriptor: HarnessRoutingDescriptor): ReactNode;
  /** Host content for the harness/files tabs. When omitted the tab bar is hidden. */
  renderTab?(tab: Exclude<HarnessEditorTab, 'launch'>, descriptor: HarnessRoutingDescriptor): ReactNode;
  /** Row copy naming what these settings apply to; defaults to project settings. */
  rowCopy?: HarnessRoutingRowCopy;
}

export interface HarnessRoutingRowCopy {
  expandLabel(harnessLabel: string): string;
  blurb: string;
  empty: string;
}

const PROJECT_ROW_COPY: HarnessRoutingRowCopy = {
  expandLabel: (harnessLabel) => `Project settings for ${harnessLabel}`,
  blurb: 'Project-specific launch settings',
  empty: 'No project-specific settings are available for this harness.'
};

export function HarnessRoutingEditor({
  descriptors,
  value,
  onChange,
  inheritLabel = 'Use global default',
  loading = false,
  defaultHarness,
  notice,
  renderLaunchExtras,
  renderTab,
  rowCopy = PROJECT_ROW_COPY
}: HarnessRoutingEditorProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [activeTabs, setActiveTabs] = useState<Record<string, HarnessEditorTab>>({});
  const options = sortHarnessDisplayRows(
    descriptors.filter((entry) => entry.agentDefaultEligible),
    (entry) => entry.label,
    (entry) => entry.id
  );

  const toggle = (id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {defaultHarness && (
        <Field label="Default harness" searchId="project.default-harness">
          {loading ? (
            <Skeleton width="180px" height="28px" />
          ) : (
            <PopoverPicklist
              ariaLabel="Default harness"
              value={defaultHarness.value}
              onChange={defaultHarness.onChange}
              options={[
                { value: '', label: inheritLabel },
                ...options.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  disabled: !entry.availability.enabled || !entry.availability.installed
                }))
              ]}
            />
          )}
        </Field>
      )}
      {notice}
      <div className="opener-list">
        {!loading && options.map((descriptor) => {
          const id = descriptor.id as HarnessFamily;
          const isOpen = open.has(id);
          const activeTab = renderTab ? activeTabs[id] ?? 'launch' : 'launch';
          const routing = value?.byAdapter?.[id];
          const executionMapping = descriptor.targets?.executionStateMapping;
          const unavailable = !descriptor.availability.enabled || !descriptor.availability.installed;
          const enabled = id === 'claude' || descriptor.availability.enabled;
          const extras = renderLaunchExtras?.(descriptor) ?? null;
          return (
            <div className={`opener-row${enabled ? '' : ' opener-row--off'}`} key={id}>
              <div className="opener-row-head">
                <button
                  type="button"
                  className="opener-row-expand"
                  aria-expanded={isOpen}
                  aria-label={rowCopy.expandLabel(descriptor.label)}
                  onClick={() => toggle(id)}
                >
                  <ChevronRight size={14} className={isOpen ? 'opener-row-chevron opener-row-chevron--open' : 'opener-row-chevron'} aria-hidden />
                </button>
                <span className="opener-row-glyph" aria-hidden>
                  {profileIcon(FAMILY_PROFILE[id], 17)}
                </span>
                <div className="opener-row-text">
                  <span className="opener-row-name">{descriptor.label}</span>
                  <span className="opener-row-blurb">{rowCopy.blurb}</span>
                </div>
              </div>
              {isOpen ? (
                <div className="opener-row-advanced">
                  {renderTab && (
                    <div className="harness-settings-tabs" role="tablist" aria-label={`${descriptor.label} settings`}>
                      {TABS.map(([tab, label]) => (
                        <button
                          key={tab}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === tab}
                          className={activeTab === tab ? 'active' : ''}
                          onClick={() => setActiveTabs((current) => ({ ...current, [id]: tab }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {activeTab === 'launch' && <section className="harness-settings-group">
                    <p className="settings-help">Launch and routing settings affect Zana-created sessions only.</p>
                    <fieldset disabled={unavailable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                      {!!descriptor.targets?.providers?.length && (
                        <Field searchId="project.default-provider" label="Default Provider" help={descriptor.targets.providerModelRelationship === 'fixed-provider'
                          ? `${descriptor.label} uses this fixed provider.`
                          : 'Selects which provider’s models appear below. Combined provider/model harnesses encode this choice in the model id.'}>
                          <PopoverPicklist
                            value={routing?.providerTargetId
                              ?? descriptor.targets.models.find((target) => target.id === routing?.modelTargetId)?.provider
                              ?? (descriptor.targets.providerModelRelationship === 'fixed-provider' ? descriptor.targets.providers[0]?.id : '')}
                            ariaLabel="Default provider"
                            searchable={false}
                            disabled={descriptor.targets.providerModelRelationship === 'fixed-provider'}
                            onChange={(providerId) => {
                              const providerTargetId = providerId || undefined;
                              const currentModel = descriptor.targets?.models.find((target) => target.id === routing?.modelTargetId);
                              onChange(id, {
                                providerTargetId,
                                ...(!providerTargetId || (currentModel && currentModel.provider !== providerTargetId)
                                  ? { modelTargetId: undefined }
                                  : {})
                              });
                            }}
                            options={[
                              ...(descriptor.targets.providerModelRelationship !== 'fixed-provider' ? [{ value: '', label: inheritLabel }] : []),
                              ...descriptor.targets.providers.map((provider) => ({ value: provider.id, label: provider.label }))
                            ]}
                          />
                        </Field>
                      )}
                      {!!descriptor.targets?.models.length && (
                        <Field searchId="project.default-model-level" label="Default Model Level" help={`Native ${descriptor.label} models with portable mappings.`}>
                          <PopoverPicklist
                            value={routing?.modelTargetId ?? ''}
                            ariaLabel="Default model level"
                            onChange={(modelTargetId) => onChange(id, { modelTargetId: modelTargetId || undefined })}
                            disabled={unavailable}
                            title={unavailable ? descriptor.availability.reason ?? 'Harness unavailable' : undefined}
                            options={[
                              { value: '', label: inheritLabel },
                              ...descriptor.targets.models
                                .filter((target) => !routing?.providerTargetId || !target.provider || target.provider === routing.providerTargetId)
                                .map((target) => ({
                                  value: target.id,
                                  label: `${target.label}${target.level ? ` [${portableLabel(target.level)}]` : ''}`
                                }))
                            ]}
                          />
                        </Field>
                      )}
                      {executionMapping && id !== 'codex' && (
                        <Field searchId="project.default-execution-state" label="Default Execution State" help={`Native ${descriptor.label} policies with portable mappings.`}>
                          <PopoverPicklist
                            value={routing?.executionState ?? ''}
                            ariaLabel="Default execution state"
                            searchable={false}
                            onChange={(executionState) => onChange(id, {
                              executionState: (executionState || undefined) as HarnessRoutingPatch['executionState']
                            })}
                            disabled={unavailable}
                            title={unavailable ? descriptor.availability.reason ?? 'Harness unavailable' : undefined}
                            options={[
                              { value: '', label: inheritLabel },
                              ...Object.entries(executionMapping).map(([state, native]) => ({
                                value: state,
                                label: `${native} [${portableLabel(state)}]`
                              }))
                            ]}
                          />
                        </Field>
                      )}
                      {extras}
                      {!descriptor.targets?.models.length && !executionMapping && !extras && (
                        <p className="settings-help">{rowCopy.empty}</p>
                      )}
                    </fieldset>
                  </section>}
                  {renderTab && activeTab !== 'launch' && <section className="harness-settings-group">
                    {renderTab(activeTab, descriptor)}
                  </section>}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
