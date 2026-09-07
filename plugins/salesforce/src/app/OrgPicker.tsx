import { useCallback, useEffect, useState } from 'react';
import { callPluginRpc, setPluginSettings, useSettings } from '@zana-ai/zcc-plugin-sdk/app';
import { orgOptionLabel, resolveListedSelection } from '../../lib/org-list.js';
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

const LIST_STYLES = `
.sf-org-list { display: grid; gap: 8px; margin: 12px 0 16px; }
.sf-org-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-muted); }
.sf-org-actions { display: flex; gap: 8px; }
.sf-org-refresh, .sf-org-connect, .sf-org-list button { font: inherit; }
.sf-org-refresh, .sf-org-connect { height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; }
.sf-org-connect.primary { border-color: var(--accent, #1b96ff); background: color-mix(in srgb, var(--accent, #1b96ff) 12%, transparent); }
.sf-org-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sf-org-rows button { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(10rem, 1.4fr) auto auto auto; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; font-size: 12px; }
.sf-org-rows button.is-selected { border-color: var(--accent, #1b96ff); background: color-mix(in srgb, var(--accent, #1b96ff) 12%, transparent); }
.sf-org-error { margin: 0; color: var(--danger); font-size: 12px; }
.sf-org-empty { margin: 0; color: var(--text-muted); font-size: 12px; }
.sf-org-login { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
.sf-org-login-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sf-org-login input, .sf-org-login select { font: inherit; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: inherit; }
`;

type OrgPickerProps = {
  pluginId: string;
  compact?: boolean;
  disabled?: boolean;
  onSelect?: (alias: string) => void;
};

export function OrgPicker(props: OrgPickerProps) {
  const settings = useSettings();
  const [orgs, setOrgs] = useState<PublicListedOrg[]>([]);
  const [resolvedAlias, setResolvedAlias] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginInstance, setLoginInstance] = useState<'production' | 'sandbox'>('production');
  const [loginAlias, setLoginAlias] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const settingAlias = settingOrgAlias(settings.values as Record<string, unknown> | undefined);
  const selected = resolveListedSelection(orgs, settingAlias, resolvedAlias);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const payload = parseOrgsRpc(await callPluginRpc(props.pluginId, 'orgs'));
      setOrgs(payload.orgs ?? []);
      setResolvedAlias(payload.selectedAlias ?? null);
      setError(payload.ok ? null : payload.error || 'Could not list Salesforce CLI orgs.');
    } catch (err) {
      setOrgs([]);
      setResolvedAlias(null);
      setError(err instanceof Error ? err.message : 'Could not list Salesforce CLI orgs.');
    } finally {
      setBusy(false);
    }
  }, [props.pluginId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connectMore = async () => {
    setLoginBusy(true);
    setError(null);
    try {
      const payload = parseOrgsRpc(
        await callPluginRpc(props.pluginId, 'orgs.login', {
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
    if (!alias || alias === settingAlias) {
      props.onSelect?.(alias);
      return;
    }
    setError(null);
    try {
      await setPluginSettings(props.pluginId, { defaultOrg: alias });
      setResolvedAlias(alias);
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
    <div className="sf-org-list" data-testid="salesforce-org-list">
      <style>{LIST_STYLES}</style>
      <div className="sf-org-list-head">
        <span>CLI-connected orgs</span>
        <div className="sf-org-actions">
          <button
            type="button"
            className="sf-org-connect primary"
            data-testid="salesforce-connect-orgs"
            disabled={props.disabled || loginBusy}
            onClick={() => setLoginOpen((open) => !open)}
          >
            Connect more orgs
          </button>
          <button type="button" className="sf-org-refresh" disabled={busy || loginBusy} onClick={() => void refresh()}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {loginOpen ? (
        <form
          className="sf-org-login"
          data-testid="salesforce-org-login"
          onSubmit={(event) => {
            event.preventDefault();
            void connectMore();
          }}
        >
          <p className="sf-org-empty">
            {loginBusy
              ? 'Complete sign-in in the browser that just opened.'
              : 'Opens Salesforce CLI web login in your browser.'}
          </p>
          <div className="sf-org-login-row">
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
            <button type="submit" className="sf-org-connect primary" disabled={loginBusy}>
              {loginBusy ? 'Waiting for login…' : 'Start login'}
            </button>
          </div>
        </form>
      ) : null}
      {error ? <p className="sf-org-error">{error}</p> : null}
      {orgs.length === 0 && !busy ? (
        <p className="sf-org-empty">No Salesforce CLI orgs yet. Connect more orgs to authenticate with Salesforce CLI.</p>
      ) : (
        <ul className="sf-org-rows">
          {orgs.map((org) => {
            const alias = org.alias || org.username;
            const isSelected = selected === alias;
            return (
              <li key={alias}>
                <button
                  type="button"
                  className={isSelected ? 'is-selected' : undefined}
                  data-testid={`salesforce-org:${alias}`}
                  aria-pressed={isSelected}
                  disabled={props.disabled}
                  onClick={() => void select(alias)}
                >
                  <span>{org.alias || org.username}</span>
                  <span>{org.username}</span>
                  <span>{org.kind}</span>
                  {org.isDefault ? <span>CLI default</span> : null}
                  {isSelected ? <span>selected</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
