import { useCallback, useEffect, useRef, useState } from 'react';
import { setPluginSettings } from '@zana-ai/zcc-plugin-sdk/app';
import { orgOptionLabel, resolveListedSelection } from '../../lib/org-list.js';
import { useSalesforceCall, requireResult } from './components/client.js';
import { SALESFORCE_STYLES } from './components/styles.js';
import type { PublicListedOrg } from '../../lib/types.js';

export type OrgsRpc =
  | { ok: true; orgs: PublicListedOrg[]; selectedAlias: string | null }
  | { ok: false; error?: string; code?: string; orgs?: PublicListedOrg[]; selectedAlias?: string | null };

export function parseOrgsRpc(payload: unknown): OrgsRpc {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Could not list Salesforce CLI orgs.', orgs: [], selectedAlias: null };
  }
  const row = payload as OrgsRpc;
  const orgs = Array.isArray(row.orgs) ? row.orgs : [];
  if (row.ok === true) return { ok: true, orgs, selectedAlias: row.selectedAlias ?? null };
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
  disabled?: boolean;
  onSelect?: (alias: string) => void;
};

export function OrgPicker(props: OrgPickerProps) {
  const call = useSalesforceCall(props.pluginId, { projectId: props.projectId });
  const generation = useRef(0);
  const [search, setSearch] = useState('');
  const [inspected, setInspected] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<PublicListedOrg[]>([]);
  const [resolvedAlias, setResolvedAlias] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginInstance, setLoginInstance] = useState<'production' | 'sandbox'>('production');
  const [loginAlias, setLoginAlias] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const settingAlias = resolvedAlias ?? '';
  const selected = resolveListedSelection(orgs, settingAlias, resolvedAlias);

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
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const connectMore = async () => {
    setLoginBusy(true);
    setError(null);
    try {
      const payload = parseOrgsRpc(
        await call('orgs.login', {
          instance: loginInstance,
          alias: loginAlias.trim() || undefined
        })
      );
      setOrgs(payload.orgs ?? []);
      setResolvedAlias(payload.selectedAlias ?? null);
      if (!payload.ok) {
        setError(payload.error || 'Could not connect a Salesforce org.');
        return;
      }
      setLoginOpen(false);
      setLoginAlias('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect a Salesforce org.');
    } finally {
      setLoginBusy(false);
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

  if (props.compact) {
    return (
      <select
        className="sf-org-picker"
        aria-label="Salesforce org"
        data-testid="salesforce-org-picker"
        disabled={props.disabled || busy || orgs.length === 0}
        value={selected}
        onChange={(event) => void select(event.target.value)}
      >
        {orgs.length === 0 ? (
          <option value="">{busy ? 'Loading orgs…' : error || 'No CLI orgs'}</option>
        ) : (
          orgs.map((org) => (
            <option key={org.alias || org.username} value={org.alias || org.username}>
              {orgOptionLabel(org)}
            </option>
          ))
        )}
      </select>
    );
  }

  return (
    <div className="sf-surface sf-org-list" style={{ height: 'auto', flex: '0 0 auto' }} data-testid="salesforce-org-list">
      <style>{SALESFORCE_STYLES}</style>
      <div className="sf-org-list-head">
        <span>CLI-connected orgs</span>{props.projectId && <button type="button" className="sf-btn quiet" onClick={() => void select('')}>Use shared default</button>}
        <div className="sf-org-actions">
          <button
            type="button"
            className="sf-btn primary"
            data-testid="salesforce-connect-orgs"
            disabled={props.disabled || loginBusy}
            onClick={() => setLoginOpen((open) => !open)}
          >
            Connect more orgs
          </button>
          <button type="button" className="sf-btn" disabled={busy || loginBusy} onClick={() => void refresh()}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {loginOpen ? (
        <form
          className="sf-org-login sf-form"
          data-testid="salesforce-org-login"
          onSubmit={(event) => {
            event.preventDefault();
            void connectMore();
          }}
        >
          <p className="sf-muted">
            {loginBusy
              ? 'Complete sign-in in the browser that just opened.'
              : 'Opens Salesforce CLI web login in your browser.'}
          </p>
          <div className="sf-form">
            <label>
              Environment
              <select
                aria-label="Login environment"
                disabled={loginBusy}
                value={loginInstance}
                onChange={(event) => setLoginInstance(event.target.value === 'sandbox' ? 'sandbox' : 'production')}
              >
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </label>
            <label>
              Alias
              <input
                aria-label="Org alias"
                disabled={loginBusy}
                placeholder="optional"
                value={loginAlias}
                onChange={(event) => setLoginAlias(event.target.value)}
              />
            </label>
            <button type="submit" className="sf-btn primary" disabled={loginBusy}>
              {loginBusy ? 'Waiting for login…' : 'Start login'}
            </button>
          </div>
        </form>
      ) : null}
      {error ? <p className="sf-error" role="alert">{error}</p> : null}
      {orgs.length === 0 && !busy ? (
        <p className="sf-muted">No Salesforce CLI orgs yet. Connect more orgs to authenticate with Salesforce CLI.</p>
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
