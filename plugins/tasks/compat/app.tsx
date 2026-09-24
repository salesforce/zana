import { createContext, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes } from 'react';
import * as host from '@zana-ai/zcc-plugin-sdk/app';
import type { PluginSdkApp } from '@zana-ai/zcc-plugin-sdk/app';
import { reconcileReasoningLevel, type ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
export const TasksHostContext = createContext<Partial<PluginSdkApp> | null>(null);
function useHostRpc() { return (useContext(TasksHostContext)?.useRpc ?? host.useRpc)(); }
export function useRealtime(channel: string, handler: (value: unknown) => void) { return (useContext(TasksHostContext)?.useRealtime ?? host.useRealtime)(channel, handler); }
export function useRealtimeConnectionState() { return (useContext(TasksHostContext)?.useRealtimeConnectionState ?? host.useRealtimeConnectionState)(); }
export function useBbNavigate() { return (useContext(TasksHostContext)?.useZccNavigate ?? host.useZccNavigate)(); }
import type { z } from 'zod';
import { Icon } from '../vendor/shared-ui/components/ui/icon';
export * from '@zana-ai/zcc-plugin-sdk/app';
export { Icon as experimental_Icon } from '../vendor/shared-ui/components/ui/icon';

type Contract = Record<string, { input: z.ZodType; output: z.ZodType }>;
export function useRpc<C extends Contract = Contract>() {
  const rpc = useHostRpc();
  return useMemo(() => ({ call: <K extends keyof C & string>(method: K, args?: z.input<C[K]['input']>) =>
    rpc.call(method, args) as Promise<z.output<C[K]['output']>> }), [rpc]);
}
export function UrlLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}
export function experimental_ProviderIcon({ provider, fallback, className }: {
  providerKind: string; provider: { logoUrl?: string | null; id?: string; name?: string; icon?: { glyph: string } | null; strings?: { iconTint?: { light: string; dark: string } | null } }; fallback: string; className?: string;
}) {
  const attrs = { 'data-provider-id': provider.id, 'data-provider-glyph': provider.icon?.glyph, 'data-provider-tint': provider.strings?.iconTint ? JSON.stringify(provider.strings.iconTint) : undefined, 'data-provider-fallback': fallback };
  return provider.logoUrl ? <img {...attrs} data-provider-logo={provider.logoUrl} src={provider.logoUrl} alt="" className={className} /> : <span {...attrs}><Icon name={provider.icon?.glyph ?? fallback} className={className} /></span>;
}
export interface ExperimentalProviderModelPickerValue {
  providerId: string; model: string; reasoningLevel: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'ultracode';
  serviceTier?: 'default' | 'fast';
}
type PickerModel = { id: string; model: string; isDefault?: boolean; supportedReasoningEfforts: { reasoningEffort: ReasoningLevel }[] };
type Catalog = { providers: { id: string; displayName: string; capabilities?: { permissionModes?: string[]; supportsServiceTier?: boolean } }[];
  catalog?: { models: PickerModel[]; selectedOnlyModels?: PickerModel[]; modelLoadError?: unknown } };
function useExecutionCatalog(providerId?: string, hostId?: string) {
  const rpc = useHostRpc();
  const key = JSON.stringify([providerId, hostId]);
  const [state, setState] = useState<{ key?: string; data?: Catalog; error?: string }>({});
  useEffect(() => { let live = true; setState({ key });
    void rpc.call('executionCatalog', { providerId, hostId }).then(data => { if (live) setState({ key, data: data as Catalog }); },
      error => { if (live) setState({ key, error: String(error) }); });
    return () => { live = false; };
  }, [rpc, providerId, hostId, key]);
  return state.key === key ? state : {};
}
export function experimental_ProviderModelPicker({ value, onChange, className, routing }: {
  value: ExperimentalProviderModelPickerValue; onChange(value: ExperimentalProviderModelPickerValue): void; className?: string; routing?: { kind: 'host'; hostId: string };
}) {
  const { data, error } = useExecutionCatalog(value.providerId || undefined, routing?.hostId);
  const models = [...data?.catalog?.models ?? [], ...data?.catalog?.selectedOnlyModels ?? []];
  const verified = Boolean(data?.catalog && !data.catalog.modelLoadError && !error);
  const prefixed = models.filter(model => model.model.endsWith(`/${value.model}`));
  const selected = models.find(model => model.model === value.model) ?? (value.model && prefixed.length === 1 ? prefixed[0] : undefined);
  const active = selected ?? (verified ? models.find(model => model.isDefault) ?? models[0] : undefined);
  const efforts = active?.supportedReasoningEfforts.map(e => e.reasoningEffort) ?? [];
  const model = verified && active ? active.model : value.model;
  const reasoningLevel = verified && efforts.length ? reconcileReasoningLevel(value.reasoningLevel, efforts) : value.reasoningLevel;
  const supportsServiceTier = data?.providers.find(p => p.id === value.providerId)?.capabilities?.supportsServiceTier === true;
  const serviceTier = verified && !supportsServiceTier ? undefined : value.serviceTier;
  useEffect(() => {
    if (verified && model && (model !== value.model || reasoningLevel !== value.reasoningLevel || serviceTier !== value.serviceTier)) {
      onChange({ ...value, model, reasoningLevel, serviceTier });
    }
  }, [verified, model, reasoningLevel, serviceTier, value, onChange]);
  return <div className="flex flex-wrap gap-2">
    <select className={className} aria-label="Provider" value={value.providerId} onChange={e => onChange({ ...value, providerId: e.target.value, model: '', serviceTier: undefined })}>
      <option value="">Select provider</option>{data?.providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
      {value.providerId && !data?.providers.some(p => p.id === value.providerId) && <option value={value.providerId}>{value.providerId}</option>}
    </select>
    <select className={className} aria-label="Model" value={model} disabled={!verified} onChange={e => onChange({ ...value, model: e.target.value })}>
      <option value="">Select model</option>{models.map(m => <option key={m.id} value={m.model}>{m.model}</option>)}
      {!verified && value.model && !models.some(m => m.model === value.model) && <option value={value.model}>{value.model}</option>}
    </select>
    <select className={className} aria-label="Reasoning level" value={reasoningLevel} disabled={!verified} onChange={e => onChange({ ...value, reasoningLevel: e.target.value as ExperimentalProviderModelPickerValue['reasoningLevel'] })}>
      {[...new Set(verified && efforts.length ? efforts : [reasoningLevel])].map(level => <option key={level}>{level}</option>)}
    </select>
    {supportsServiceTier && <select className={className} aria-label="Service tier" value={value.serviceTier ?? ''} onChange={e => onChange({ ...value, serviceTier: e.target.value as 'default' | 'fast' || undefined })}>
      <option value="">Provider default</option><option value="default">Default</option><option value="fast">Fast</option>
    </select>}
    {(error || Boolean(data?.catalog?.modelLoadError)) && <span role="alert">{String(error ?? "Live model discovery unavailable; showing saved or fallback models.")}</span>}
  </div>;
}
export function experimental_PermissionModePicker({ value, onChange, providerId, className }: {
  providerId: string; value: 'accept-edits' | 'auto' | 'full'; onChange(value: 'accept-edits' | 'auto' | 'full'): void; routing?: { kind: 'host'; hostId: string }; align?: string; className?: string;
}) {
  const { data } = useExecutionCatalog();
  const allowed = data?.providers.find(p => p.id === providerId)?.capabilities?.permissionModes;
  return <select aria-label="Permissions" className={className} value={value} onChange={e => onChange(e.target.value as typeof value)}>
    {(['accept-edits', 'auto', 'full'] as const).map(mode => <option key={mode} value={mode} disabled={allowed?.length ? !allowed.includes(mode) : false}>
      {{ 'accept-edits': 'Accept Edits', auto: 'Approve for me', full: 'Full Access' }[mode]}</option>)}
  </select>;
}
