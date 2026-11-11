import { useEffect, useRef, useState } from 'react';
import type { ExecutionResolvedLaunchV1, LaunchOptions } from '@zana-ai/zcc-domain/launch-options';
import { launchOptionsSchema } from '@zana-ai/zcc-domain/launch-options';
import type { Project, Worktree } from '@zana-ai/zcc-domain/product';
import type { SquadLaunchPreview } from '@zana-ai/zcc-domain/squad-proposal';
import { product } from '../lib/product-client.js';
import './SquadLaunchSettings.css';

type CoordinationMode = 'structured' | 'freeform';
type Preview = SquadLaunchPreview & { previewToken: string };
type ChecksMode = '' | 'none' | 'named';

const sourceLabel = (source: string) => ({ launch: 'This launch', plan: 'Plan', squad: 'Squad', default: 'Default' })[source] ?? source;
const settingLabel = (key: keyof ExecutionResolvedLaunchV1) => ({
  worktree: 'Worktree isolation', onComplete: 'On complete', push: 'Push', checks: 'Named checks', failurePolicyDefault: 'Failure policy'
})[key];
const settingValue = (key: keyof ExecutionResolvedLaunchV1, value: unknown) => {
  if (key === 'worktree') return value ? 'Create new worktree' : 'Use checkout';
  if (key === 'onComplete') return ({ leave: 'Keep checkout and branch', merge: 'Merge then remove', delete: 'Delete checkout and branch' })[String(value)] ?? String(value);
  if (key === 'push') return value ? 'Allowed' : 'Blocked';
  if (key === 'checks') return Array.isArray(value) ? value.join(', ') || 'No checks' : String(value);
  return value === 'fail-run' ? 'Fail run' : String(value);
};

function updateOption<K extends keyof LaunchOptions>(value: LaunchOptions, key: K, next: LaunchOptions[K] | undefined): LaunchOptions {
  const updated = { ...value };
  if (next === undefined) delete updated[key];
  else updated[key] = next;
  return updated;
}

export function SquadResolvedLaunchDetails({ resolved }: { resolved: ExecutionResolvedLaunchV1 }) {
  return <dl className="squad-launch-resolved-details">{(Object.keys(resolved) as Array<keyof ExecutionResolvedLaunchV1>).map((key) => {
    const setting = resolved[key];
    return <div key={key}><dt>{settingLabel(key)}</dt><dd>{settingValue(key, setting.value)} <span>({sourceLabel(setting.source)})</span></dd></div>;
  })}</dl>;
}

export function SquadLaunchPolicyFields({ value, onChange, disabled, includeCheckout = false }: {
  value: LaunchOptions;
  onChange: (value: LaunchOptions) => void;
  disabled: boolean;
  /** Full settings owns checkout isolation. Composer passes false to keep this field. */
  includeCheckout?: boolean;
}) {
  const externalMode: ChecksMode = value.checks === undefined ? '' : value.checks.length === 0 ? 'none' : 'named';
  const [checksMode, setChecksMode] = useState<ChecksMode>(externalMode);
  const [checksText, setChecksText] = useState(value.checks?.join(', ') ?? '');
  const editingChecks = useRef(false);
  useEffect(() => {
    if (editingChecks.current) return;
    setChecksMode(externalMode);
    setChecksText(value.checks?.join(', ') ?? '');
  }, [externalMode, value.checks]);
  const commitChecks = (mode: ChecksMode, text: string) => {
    if (mode === '') onChange(updateOption(value, 'checks', undefined));
    else if (mode === 'none') onChange(updateOption(value, 'checks', []));
    else onChange(updateOption(value, 'checks', text ? text.split(',').map((name) => name.trim()) : ['']));
  };

  return <div className="squad-launch-policy-fields">
    {!includeCheckout ? <label><span>Worktree isolation</span><select aria-label="Worktree isolation" disabled={disabled} value={value.worktree === undefined ? '' : String(value.worktree)} onChange={(event) => onChange(updateOption(value, 'worktree', event.target.value === '' ? undefined : event.target.value === 'true'))}><option value="">Use default</option><option value="true">Create new worktree</option><option value="false">Use selected checkout</option></select></label> : null}
    <label><span>On complete</span><select aria-label="On complete" disabled={disabled} value={value.onComplete ?? ''} onChange={(event) => onChange(updateOption(value, 'onComplete', event.target.value === '' ? undefined : event.target.value as 'leave' | 'merge' | 'delete'))}><option value="">Use default</option><option value="leave">Keep checkout and branch</option><option value="merge">Merge then remove</option><option value="delete">Delete checkout and branch</option></select></label>
    <label><span>Push</span><select aria-label="Push" disabled={disabled} value={value.push === undefined ? '' : String(value.push)} onChange={(event) => onChange(updateOption(value, 'push', event.target.value === '' ? undefined : event.target.value === 'true'))}><option value="">Use default</option><option value="true">Allow push</option><option value="false">Do not push</option></select></label>
    <label><span>Named checks</span><select aria-label="Named checks mode" disabled={disabled} value={checksMode} onChange={(event) => {
      const mode = event.target.value as ChecksMode;
      editingChecks.current = false;
      setChecksMode(mode);
      commitChecks(mode, checksText);
    }}><option value="">Use default</option><option value="none">No checks</option><option value="named">Named checks</option></select></label>
    {checksMode === 'named' ? <label><span>Check names</span><input aria-label="Named checks input" disabled={disabled} value={checksText} placeholder="lint, test" onChange={(event) => {
      const text = event.target.value;
      editingChecks.current = true;
      setChecksText(text);
      commitChecks('named', text);
    }} onBlur={() => { editingChecks.current = false; }} /></label> : null}
    <p className="squad-launch-help">Use default follows the plan, then Squad settings, then defaults. Review the effective values and their sources before launch.</p>
  </div>;
}

export function SquadLaunchSettings({ teamId, projectId, goal, coordinationMode, value, onChange, disabled, onValidityChange }: {
  teamId: string;
  projectId: string;
  goal: string;
  coordinationMode: CoordinationMode;
  value: LaunchOptions;
  onChange: (value: LaunchOptions) => void;
  disabled: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [previewState, setPreviewState] = useState<{ key: string; preview?: Preview; error?: string }>();
  const request = useRef(0);
  const project = projects.find((candidate) => candidate.id === projectId);
  const validOptions = launchOptionsSchema.safeParse(value).success;
  const previewKey = JSON.stringify({ teamId, projectId, goal, coordinationMode, value });
  const currentPreview = previewState?.key === previewKey ? previewState : undefined;
  const preview = currentPreview?.preview;
  const resolved = preview?.resolvedLaunch;

  useEffect(() => {
    let active = true;
    void product.projects.list().then((list) => { if (active) setProjects(list); }, () => { if (active) setProjects([]); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setWorktrees([]);
    if (!project || project.remote) return () => { active = false; };
    void product.git.listWorktrees(project.path).then((list) => { if (active) setWorktrees(list.slice(0, 256)); }, () => undefined);
    return () => { active = false; };
  }, [project?.id, project?.path, project?.remote]);
  useEffect(() => {
    const current = ++request.current;
    onValidityChange?.(false);
    setPreviewState(undefined);
    if (!teamId || !projectId || !validOptions) {
      setPreviewState({ key: previewKey, error: validOptions ? 'Choose a squad and registered Project.' : 'Launch options are invalid.' });
      return () => { request.current++; };
    }
    void product.teams.preview({ teamId, projectId, goal, coordinationMode, ...value }).then((result) => {
      if (request.current !== current) return;
      if (!result.ok) { setPreviewState({ key: previewKey, error: result.message }); return; }
      setPreviewState({ key: previewKey, preview: result.value }); onValidityChange?.(true);
    }, (cause) => {
      if (request.current === current) setPreviewState({ key: previewKey, error: cause instanceof Error ? cause.message : 'Launch preview unavailable.' });
    });
    return () => { if (request.current === current) request.current++; };
  }, [previewKey]);

  const change = (next: LaunchOptions) => { onValidityChange?.(false); onChange(next); };
  const selectedBranch = value.target?.kind === 'worktree' ? value.target.branch : '';
  const knownBranch = worktrees.some((tree) => tree.branch === selectedBranch);
  const targetValue = value.target?.kind === 'project-root' ? 'project-root' : selectedBranch ? `worktree:${selectedBranch}` : value.worktree === true ? 'new-worktree' : value.worktree === false ? 'selected-checkout' : '';
  const locationText = !preview ? undefined : preview.location.kind === 'new-worktree'
    ? `New worktree from ${preview.location.baseBranch} (${sourceLabel(preview.location.isolationSource)}); path assigned at launch`
    : preview.location.kind === 'worktree' ? `${preview.branch} at ${preview.path} (user-owned)` : `Project root (${preview.branch ?? 'HEAD'}) at ${preview.path}`;

  return <section className="squad-launch-settings" aria-label="Squad launch settings">
    <div className="squad-launch-preview" role="status" aria-live="polite">
      <strong>Launch preview</strong>
      {!teamId || !projectId ? <p>Choose a Squad and Project in the fields above to preview this launch.</p>
        : currentPreview?.error ? <p role="alert">{currentPreview.error}</p>
          : <p>{locationText ? `Location: ${locationText}` : 'Resolving launch location and settings…'}</p>}
      {resolved ? <>
        <SquadResolvedLaunchDetails resolved={resolved} />
        {resolved.onComplete.value !== 'leave' ? <p>User-owned worktrees cannot merge or delete.</p> : null}
      </> : null}
      <p className="squad-launch-help">Preview shows effective settings and their sources. Each run revalidates the plan, Squad and checkout.</p>
    </div>
    <div className="squad-launch-actions">
      <button type="button" className="launch-disclosure-button" aria-expanded={customizeOpen} onClick={() => setCustomizeOpen((open) => !open)}>Customize launch</button>
    </div>
    {customizeOpen ? <div className="squad-launch-customize">
      <label><span>Checkout</span><select aria-label="Checkout" disabled={disabled} value={targetValue} onChange={(event) => {
        const selected = event.target.value;
        if (selected === '') change(updateOption(updateOption(value, 'target', undefined), 'worktree', undefined));
        else if (selected === 'new-worktree') change({ ...updateOption(value, 'target', undefined), worktree: true });
        else if (selected === 'project-root') change({ ...updateOption(value, 'target', { kind: 'project-root' }), worktree: false });
        else if (selected === 'selected-checkout') change({ ...updateOption(value, 'target', undefined), worktree: false });
        else change({ ...updateOption(value, 'target', { kind: 'worktree', branch: selected.slice('worktree:'.length) }), worktree: false });
      }}><option value="">Inherit checkout</option><option value="new-worktree">Generated new worktree</option><option value="project-root">Project checkout</option><option value="selected-checkout">Selected checkout</option>{selectedBranch && !knownBranch ? <option value={`worktree:${selectedBranch}`}>{selectedBranch} (missing worktree)</option> : null}{worktrees.filter((tree) => !tree.isMain && tree.branch && !tree.detached && !tree.bare).map((tree) => <option key={tree.path} value={`worktree:${tree.branch}`}>{tree.branch} (existing worktree)</option>)}</select></label>
      <p className="squad-launch-help">Existing branches resolve only from this registered Project. Main validates all checkout choices.</p>
      <SquadLaunchPolicyFields value={value} onChange={change} disabled={disabled} includeCheckout />
      <div className="squad-launch-reset"><button type="button" className="btn" disabled={disabled} onClick={() => change({})}>Reset launch settings</button></div>
    </div> : null}
  </section>;
}
