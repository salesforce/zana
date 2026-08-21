import { useState, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  AUTH_PROVIDERS,
  AUTHORIZATION_PRESETS,
  type AuthProviderId,
  type AuthorizationTier,
  type AuthorizationApplyResult
} from '@zana-ai/zcc-domain/authorizations';
import { Section, Field } from './FormFields.js';
import { PopoverPicklist } from '../ui/PopoverPicklist.js';

/**
 * "Auto-configure authorizations" — one click writes a curated permission preset
 * (tier) into each selected agent CLI's user-global config. Claude Code (writes
 * ~/.claude/settings.json) and Codex (writes ~/.codex/config.toml
 * approval_policy + sandbox_mode) are wired; pi is shown but disabled
 * ("coming soon") until its authorizer lands.
 *
 * The tier is provider-agnostic intent; the per-provider translation lives in
 * the main process (src/main/authorizations.ts). This component just collects
 * {providers, tier} and reports the per-provider outcome.
 */
export function AuthorizationsSection() {
  const [tier, setTier] = useState<AuthorizationTier>('standard');
  // Default: the ready providers, pre-selected.
  const [selected, setSelected] = useState<Record<AuthProviderId, boolean>>(() => {
    const init = {} as Record<AuthProviderId, boolean>;
    for (const p of AUTH_PROVIDERS) init[p.id] = p.ready;
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AuthorizationApplyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePreset = AUTHORIZATION_PRESETS.find((p) => p.tier === tier);
  const chosen = AUTH_PROVIDERS.filter((p) => selected[p.id]).map((p) => p.id);

  const toggle = useCallback((id: AuthProviderId) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const apply = useCallback(async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await window.cc.authorizations.apply({ providers: chosen, tier });
      setResults(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, chosen, tier]);

  return (
    <Section
      anchorId="authorizations"
      title="Authorizations"
      help="One-click apply a curated permission preset to your agent CLIs (user-global). Instead of approving tools one prompt at a time, pick a trust tier and let the app write the allow-rules into the CLI's own settings."
    >
      <Field label="Preset" help={activePreset?.description}>
        <PopoverPicklist
          ariaLabel="Authorization preset"
          value={tier}
          searchable={false}
          onChange={(nextTier) => setTier(nextTier as AuthorizationTier)}
          options={AUTHORIZATION_PRESETS.map((preset) => ({ value: preset.tier, label: preset.label }))}
        />
      </Field>

      <div className="settings-field">
        <span className="settings-label">Apply to</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {AUTH_PROVIDERS.map((p) => (
            <label
              key={p.id}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 8,
                opacity: p.ready ? 1 : 0.5
              }}
            >
              <input
                type="checkbox"
                checked={!!selected[p.id]}
                disabled={!p.ready}
                onChange={() => toggle(p.id)}
              />
              <span>
                {p.label}
                {!p.ready && ' — coming soon'}{' '}
                <code style={{ opacity: 0.7 }}>{p.target}</code>
              </span>
            </label>
          ))}
        </div>
      </div>

      {error && <p className="modal-error">{error}</p>}

      {results && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: '0.85em', opacity: 0.9 }}>
          {results.map((r) => (
            <li key={r.provider}>
              {r.ok ? '✅' : '⚠️'} <strong>{r.provider}</strong>: {r.message}
            </li>
          ))}
        </ul>
      )}

      <div className="settings-btn-row">
        <button
          type="button"
          className="settings-btn"
          onClick={() => void apply()}
          disabled={busy || chosen.length === 0}
        >
          <ShieldCheck size={14} />
          {busy ? 'Applying…' : 'Auto-configure'}
        </button>
      </div>
    </Section>
  );
}
