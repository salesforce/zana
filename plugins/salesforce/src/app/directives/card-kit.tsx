import { STUDIO_TOKENS } from '../studio/studio-tokens.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';

/** Card chrome. Extends the host `plugin-directive-card*` classes with --sf-* tokens. */
export const CARD_STYLES = `
${STUDIO_TOKENS}.sf-dcard { border-color:var(--sf-border); }
.sf-dcard .sf-dcard-icon { flex:0 0 auto; display:inline-flex; width:22px; height:22px; align-items:center; justify-content:center; border-radius:6px; font-size:11px; font-weight:700; color:var(--sf-accent); background:color-mix(in srgb,var(--sf-accent) 12%,transparent); }
.sf-dcard .sf-dcard-body { display:grid; gap:2px; min-width:0; flex:1 1 auto; text-align:left; }
.sf-dcard .sf-dcard-line { display:flex; align-items:center; gap:8px; min-width:0; }
.sf-dcard .sf-dcard-sub { font-size:12px; color:var(--sf-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-dcard code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
.sf-dcard .sf-pill { display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; line-height:18px; padding:0 7px; border-radius:999px; color:var(--sf-muted); background:color-mix(in srgb,var(--sf-muted) 14%,transparent); white-space:nowrap; }
.sf-dcard .sf-pill[data-tone=success] { color:var(--sf-success); background:color-mix(in srgb,var(--sf-success) 12%,transparent); }
.sf-dcard .sf-pill[data-tone=danger] { color:var(--sf-danger); background:color-mix(in srgb,var(--sf-danger) 12%,transparent); }
.sf-dcard .sf-pill[data-tone=warn] { color:var(--sf-warn); background:color-mix(in srgb,var(--sf-warn) 14%,transparent); }
.sf-dcard .sf-pill[data-tone=running] { color:var(--sf-accent); background:color-mix(in srgb,var(--sf-accent) 12%,transparent); }
.sf-dcard .sf-pill[data-tone=running]::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; animation:sf-dcard-pulse 1.2s ease-in-out infinite; }
@keyframes sf-dcard-pulse { 50% { opacity:.25; } }
.sf-dcard--error { color:var(--sf-danger); }
`;

export type Tone = 'success' | 'danger' | 'warn' | 'running' | 'muted';

export function Pill({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className="sf-pill" data-tone={tone} title={title}>{children}</span>;
}

export function ErrorCard({ kind, message, source }: { kind: string; message: string; source?: string }) {
  return (
    <div className="plugin-directive-card plugin-directive-card--error sf-dcard sf-dcard--error" role="alert" title={source} data-testid={`sf-card-${kind}-error`}>
      <style>{CARD_STYLES}</style>
      {message}
    </div>
  );
}

/** Pure parsers for directive attributes (model-authored: never trusted). */
export function cleanAttr(value: string | undefined, max = 1024): string | null {
  const text = value?.trim();
  return text && text.length <= max ? text : null;
}

export function parseLine(value: string | undefined): number | null {
  if (!value || !/^\d{1,7}$/.test(value.trim())) return null;
  const line = Number(value);
  return line >= 1 ? line : null;
}

export function rpcFailure(result: unknown): { code?: string; message: string } | null {
  if (!result || typeof result !== 'object') return { message: 'Salesforce returned no data.' };
  const record = result as { ok?: unknown; code?: unknown; error?: unknown };
  if (record.ok !== false) return null;
  return { ...(typeof record.code === 'string' ? { code: record.code } : {}), message: typeof record.error === 'string' && record.error ? record.error : 'Salesforce is unavailable.' };
}

export const isNotImplemented = (result: unknown): boolean => rpcFailure(result)?.code === 'not_implemented';

export async function rpc(pluginId: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  return callPluginRpc(pluginId, method, args);
}

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload(): void }

/** Runs `load` on mount and whenever `reload()` is called or `deps` change; ignores stale/unmounted results. */
export function useLoaded<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    loadRef.current().then(
      data => { if (live) setState({ data, error: null, loading: false }); },
      error => { if (live) setState(prev => ({ data: prev.data, error: error instanceof Error ? error.message : String(error), loading: false })); }
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick(value => value + 1), []);
  return { ...state, reload };
}
