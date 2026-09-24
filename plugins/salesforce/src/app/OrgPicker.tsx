import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Cloud } from 'lucide-react';
import { setPluginSettings } from '@zana-ai/zcc-plugin-sdk/app';
import { orgMatchesAlias, orgOptionLabel } from '../../lib/org-list.js';
import { useSalesforceCall, requireResult } from './components/client.js';
import { SALESFORCE_STYLES } from './components/styles.js';
import type { PublicListedOrg } from '../../lib/types.js';
import { parseOrgLoginInput, type OrgLoginInstance } from '../../lib/org-login.js';
import { signInWithBrowser } from './org-login-rpc.js';
import { OrgLoginDialog } from './OrgLoginDialog.js';

export type OrgsRpc =
  | { ok: true; orgs: PublicListedOrg[]; selectedAlias: string | null; connectedAlias?: string | null; warning?: string }
  | { ok: false; error?: string; code?: string; orgs?: PublicListedOrg[]; selectedAlias?: string | null };

export function parseOrgsRpc(payload: unknown): OrgsRpc {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Could not list Salesforce CLI orgs.', orgs: [], selectedAlias: null };
  }
  const row = payload as OrgsRpc;
  const orgs = Array.isArray(row.orgs) ? row.orgs : [];
  if (row.ok === true) return { ok: true, orgs, selectedAlias: row.selectedAlias ?? null,
    ...(typeof row.connectedAlias === 'string' ? { connectedAlias: row.connectedAlias } : {}),
    ...(typeof row.warning === 'string' ? { warning: row.warning } : {}),
  };
  return {
    ok: false,
    error: typeof row.error === 'string' ? row.error : 'Could not list Salesforce CLI orgs.',
    code: row.code,
    orgs,
    selectedAlias: row.selectedAlias ?? null
  };
}

export function settingOrgAlias(values: Record<string, unknown> | undefined): string {
  const value = values?.defaultOrg;
  return typeof value === 'string' ? value.trim() : '';
}

type OrgPickerProps = {
  pluginId: string;
  projectId?: string;
  compact?: boolean;
  appearance?: 'toolbar';
  disabled?: boolean;
  loginRequest?: number;
  hideConnect?: boolean;
  onSelect?: (alias: string) => void;
};

export function OrgPicker(props: OrgPickerProps) {
  const call = useSalesforceCall(props.pluginId, { projectId: props.projectId });
  const generation = useRef(0);
  const scopeGeneration = useRef(0);
  const loginPending = useRef(false);
  const loginController = useRef<AbortController | null>(null);
  const [search, setSearch] = useState('');
  const [inspected, setInspected] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<PublicListedOrg[]>([]);
  const [resolvedAlias, setResolvedAlias] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(Boolean(props.loginRequest));
  const [loginInstance, setLoginInstance] = useState<OrgLoginInstance>('production');
  const [loginUrl, setLoginUrl] = useState('');
  const [loginAlias, setLoginAlias] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const settingAlias = resolvedAlias ?? '';
  const selectedOrg = orgs.find(org => orgMatchesAlias(org, settingAlias));
  const selected = selectedOrg ? selectedOrg.alias || selectedOrg.username : settingAlias;
  useEffect(() => { if (props.loginRequest !== undefined) setLoginOpen(Boolean(props.loginRequest)); }, [props.loginRequest]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    try {
      const payload = parseOrgsRpc(await call('orgs'));
      if (current !== generation.current) return;
      setOrgs(payload.orgs ?? []);
      setResolvedAlias(payload.selectedAlias ?? null);
      setError(payload.ok ? null : payload.error || 'Could not list Salesforce CLI orgs.');
    } catch (err) {
      if (current !== generation.current) return;
      setOrgs([]);
      setResolvedAlias(null);
      setError(err instanceof Error ? err.message : 'Could not list Salesforce CLI orgs.');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [call]);

  useEffect(() => {
    scopeGeneration.current += 1;
    loginPending.current = false;
    setLoginBusy(false);
    setNotice(null);
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener('sf:context-changed', changed);
    return () => {
      generation.current += 1;
      scopeGeneration.current += 1;
      loginController.current?.abort();
      window.removeEventListener('sf:context-changed', changed);
    };
  }, [refresh]);

  const connectMore = async () => {
    if (loginPending.current || props.disabled) return;
    const input = { instance: loginInstance, alias: loginAlias.trim() || undefined,
      ...(loginInstance === 'custom' ? { instanceUrl: loginUrl } : {}) };
    const parsed = parseOrgLoginInput(input);
    if (!parsed.ok) { setError(parsed.error); return; }
    const scope = scopeGeneration.current;
    loginPending.current = true;
    const controller = new AbortController();
    loginController.current = controller;
    setLoginBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = parseOrgsRpc(
        await signInWithBrowser(call, input, controller.signal)
      );
      if (scope !== scopeGeneration.current) return;
      if (!payload.ok) {
        setError(payload.error || 'Could not connect a Salesforce org.');
        return;
      }
      generation.current += 1;
      setBusy(false);
      setOrgs(payload.orgs);
      setResolvedAlias(payload.selectedAlias);
      setInspected(payload.connectedAlias ?? null);
      setSearch('');
      setNotice(payload.warning || (props.projectId
        ? `Connected ${payload.connectedAlias || 'org'} and selected it for this project.`
        : `Connected ${payload.connectedAlias || 'org'}. Select it below to set the shared default.`));
      setLoginOpen(false);
      setLoginAlias('');
      window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: props.projectId ?? null } }));
      if (props.projectId && !payload.warning) props.onSelect?.(payload.selectedAlias ?? '');
    } catch (err) {
      if (scope === scopeGeneration.current) setError(err instanceof Error ? err.message : 'Could not connect a Salesforce org.');
    } finally {
      if (scope === scopeGeneration.current) { loginController.current = null; loginPending.current = false; setLoginBusy(false); }
    }
  };

  const select = async (alias: string) => {
    if ((!alias && !props.projectId) || (!props.projectId && alias === settingAlias)) {
      window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: props.projectId ?? null } }));
      props.onSelect?.(alias);
      return;
    }
    setError(null);
    try {
      if (props.projectId) requireResult(await call('context.select', { selectedAlias: alias }));
      else await setPluginSettings(props.pluginId, { defaultOrg: alias });
      setResolvedAlias(alias || null);
      if (!alias) await refresh();
      window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: props.projectId ?? null } }));
      props.onSelect?.(alias);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select this org.');
    }
  };

  const loginDialog = loginOpen && <OrgLoginDialog
    instance={loginInstance} url={loginUrl} alias={loginAlias} busy={loginBusy}
    disabled={props.disabled} projectId={props.projectId} error={error}
    onInstance={setLoginInstance} onUrl={setLoginUrl} onAlias={setLoginAlias}
    onSubmit={() => void connectMore()} onClose={() => setLoginOpen(false)}
  />;

  if (props.compact) {
    const disabled = props.disabled || busy || orgs.length === 0;
    const description = selectedOrg ? orgOptionLabel(selectedOrg) : error || (busy ? 'Loading orgs…' : selected ? `${selected} (unavailable)` : orgs.length ? 'Choose an org' : 'No connected orgs');
    const picker = <select
        className="sf-org-picker"
        aria-label="Salesforce org"
        title={description}
        data-testid="salesforce-org-picker"
        disabled={disabled}
        value={selected}
        onChange={(event) => void select(event.target.value)}
      >
        {orgs.length === 0 ? (
          <option value="">{busy ? 'Loading orgs…' : error || 'No CLI orgs'}</option>
        ) : (
          <>{!selectedOrg && <option value={selected} disabled>{selected ? `${selected} (unavailable)` : 'Choose an org'}</option>}{orgs.map((org) => (
            <option key={org.alias || org.username} value={org.alias || org.username}>
              {orgOptionLabel(org)}
            </option>
          ))}</>
        )}
      </select>;
    return (
      <>
      {loginDialog}
      {props.appearance === 'toolbar' ? (
        <div className="sf-org-switcher" data-disabled={Boolean(disabled)} title={description}>
          <span className="sf-org-switcher-label" aria-hidden="true">
            <Cloud size={14} className="sf-org-switcher-icon" />
            <span className="sf-org-switcher-name">{selectedOrg ? selectedOrg.alias || selectedOrg.username : busy ? 'Loading orgs…' : error ? 'Connection unavailable' : 'Select org'}</span>
            {selectedOrg && <span className="sf-org-switcher-kind" data-kind={selectedOrg.kind}>{selectedOrg.kind}</span>}
            <ChevronDown size={12} className="sf-org-switcher-chevron" />
          </span>
          {picker}
        </div>
      ) : picker}
      {notice && <p className="sf-connection-status" role="status">{notice}</p>}
      {error && !loginOpen && props.appearance !== 'toolbar' && <p className="sf-connection-status sf-error" role="alert">{error}</p>}
      </>
    );
  }

  return (
    <div className="sf-surface sf-org-list" style={{ height: 'auto', flex: '0 0 auto' }} data-testid="salesforce-org-list">
      <style>{SALESFORCE_STYLES}</style>
      <div className="sf-org-list-head">
        <div><strong>Connected orgs</strong><span className="sf-org-count">{orgs.length}</span><small>Connections from Salesforce CLI</small></div>
        <div className="sf-org-actions">
          {props.projectId && <button type="button" className="sf-btn quiet" onClick={() => void select('')}>Use shared default</button>}
          {!props.hideConnect && <button
            type="button"
            className="sf-btn"
            data-testid="salesforce-connect-orgs"
            disabled={props.disabled}
            onClick={() => setLoginOpen(true)}
          >
            Connect org
          </button>}
          <button type="button" className="sf-btn" disabled={busy || loginBusy} onClick={() => void refresh()}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {loginDialog}
      {error && !loginOpen ? <p className="sf-error" role="alert">{error}</p> : null}
      {notice ? <p className="sf-notice" role="status">{notice}</p> : null}
      {orgs.length === 0 && !busy ? (
        <p className="sf-muted">No connected orgs yet. Choose Connect org to sign in, or Refresh if you already signed in from your terminal.</p>
      ) : (
        <><input className="sf-input" aria-label="Search connected orgs" placeholder="Search orgs by alias or username…" value={search} onChange={event => setSearch(event.target.value)} /><ul className="sf-org-rows">
          {orgs.filter(org => `${org.alias} ${org.username}`.toLowerCase().includes(search.toLowerCase())).map((org) => {
            const alias = org.alias || org.username;
            const isSelected = (inspected ?? selected) === alias;
            return (
              <li key={alias}>
                <button
                  type="button"
                  className="sf-org-row"
                  data-testid={`salesforce-org:${alias}`}
                  aria-pressed={isSelected}
                  disabled={props.disabled}
                  onClick={() => setInspected(alias)}
                >
                  <span>{org.alias || org.username}<small>{org.username}</small></span>
                  <span className="sf-badge" data-kind={org.kind}>{org.kind}</span>
                  {org.isDefault ? <span>CLI default</span> : null}
                  {selected === alias ? <span className="sf-badge">Current target</span> : null}
                </button>
              </li>
            );
          })}
        </ul>{inspected && <div className="sf-summary"><span className="sf-grow">{inspected}</span><button type="button" className="sf-btn primary" disabled={props.disabled} onClick={() => void select(inspected)}>{props.projectId ? 'Use for this project' : 'Set shared default'}</button></div>}</>
      )}
    </div>
  );
}
