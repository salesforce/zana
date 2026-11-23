import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { appNavigate } from '../../lib/app-navigate.js';
import { getSettingsRoutePath } from '../../lib/route-paths.js';
import { harnessLoginStatus } from '../thread/pickers/harness-login.js';
import { getThreadModelCatalog, prefetchThreadModelCatalog, subscribeThreadModelCatalog } from '../thread/pickers/thread-model-catalog.js';
import { useUi } from '../../store.js';

const DEFAULT_FAMILY: HarnessFamily = 'claude';
const BRAND: Partial<Record<HarnessFamily, string>> = {
  claude: '#d97757', codex: '#10a37f', cursor: '#6e7681', opencode: '#a371f7', pi: '#e0a030', grok: '#4a5568'
};
/** After this long a sign-in check stops spinning and shows an honest "unknown". */
export const LOGIN_CHECK_TIMEOUT_MS = 6000;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);


/**
 * Step 1: confirm the default coding agent from real verify + login data.
 * Nothing is installed or signed in here: sign-in deep-links to the Harness settings row.
 */
export function HarnessStep({ onDone, onSkip }: { onDone: (label: string) => void; onSkip: () => void }) {
  const [rows, setRows] = useState<HarnessVerifyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HarnessFamily>(DEFAULT_FAMILY);
  const [saving, setSaving] = useState<HarnessFamily | null>(null);
  const [hintFor, setHintFor] = useState<HarnessFamily | null>(null);
  const alive = useRef(true);
  const catalog = useSyncExternalStore(subscribeThreadModelCatalog, getThreadModelCatalog, getThreadModelCatalog);

  const scan = useCallback(() => {
    setRows(null); setError(null);
    Promise.all([product.harness.verify(), product.config.get()]).then(([results, config]) => {
      if (!alive.current) return;
      setRows(results);
      setSelected((config as Pick<AppConfig, 'defaultHarness'>).defaultHarness ?? DEFAULT_FAMILY);
    }).catch(reason => {
      if (alive.current) setError(errorText(reason) || 'Could not check coding agents.');
    });
  }, []);
  useEffect(() => { alive.current = true; scan(); return () => { alive.current = false; }; }, [scan]);

  // Ask for the model catalog (which carries login state) and never wait on it forever.
  const [loginTimedOut, setLoginTimedOut] = useState(false);
  const scanned = rows !== null;
  useEffect(() => {
    if (!scanned) { setLoginTimedOut(false); return undefined; }
    let live = true;
    try { void Promise.resolve(prefetchThreadModelCatalog()).catch(() => undefined); } catch { /* status stays unknown */ }
    const timer = setTimeout(() => { if (live) setLoginTimedOut(true); }, LOGIN_CHECK_TIMEOUT_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [scanned]);
  const loginOf = (row: HarnessVerifyResult) => {
    const login = harnessLoginStatus(row.family, catalog, row.installed);
    return login?.state === 'checking' && loginTimedOut ? { ...login, state: 'unverified' as const } : login;
  };
  // Ready agents first, then unverified, then ones that need sign-in, then not installed. Stable within a group.
  const rank = (row: HarnessVerifyResult) => {
    if (!row.installed) return 3;
    const state = loginOf(row)?.state;
    return state === 'sign_in_required' ? 2 : state === 'unverified' || state === 'checking' ? 1 : 0;
  };
  const ordered = rows ? rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map(item => item.row) : null;

  // Picking a card only selects it; "Continue with …" is the one place that saves and moves on.
  const [saved, setSaved] = useState<HarnessFamily | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  useEffect(() => { if (rows) setSaved(prev => prev ?? selected); }, [rows, selected]);
  const confirm = async () => {
    const choice = current;
    if (!choice?.installed || saving) return;
    setSaving(choice.family);
    try {
      if (choice.family !== saved) await product.config.set({ defaultHarness: choice.family });
      if (!alive.current) return;
      setSaved(choice.family);
      onDone(choice.label);
    } catch (reason) {
      useUi.getState().pushToast(`Could not set the default agent: ${errorText(reason)}`, 'error');
    } finally {
      if (alive.current) setSaving(null);
    }
  };

  const installed = ordered?.filter(row => row.installed) ?? [];
  const missing = ordered?.filter(row => !row.installed) ?? [];
  // When the saved default isn't installed, suggest the best ready agent so there is always one obvious next click.
  const chosen = installed.some(row => row.family === selected) ? selected : installed[0]?.family ?? selected;
  const current = rows?.find(row => row.family === chosen);
  const ready = !!current?.installed;
  const pick = (family: HarnessFamily) => { if (!saving) setSelected(family); };
  const onRadioKey = (event: React.KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta || installed.length === 0) return;
    event.preventDefault();
    const next = installed[(index + delta + installed.length) % installed.length]!;
    pick(next.family);
    (event.currentTarget.closest('.onb-hcards')?.querySelectorAll<HTMLElement>('[role=radio]')[(index + delta + installed.length) % installed.length])?.focus();
  };

  const statusOf = (row: HarnessVerifyResult) => {
    const login = loginOf(row);
    if (!row.installed) return { status: 'Not installed', tone: 'dim', login };
    const version = row.version ? ` · ${row.version}` : '';
    if (login?.state === 'sign_in_required') return { status: `Installed · needs sign-in${version}`, tone: 'warn', login };
    if (login?.state === 'checking') return { status: `Installed · checking sign-in…${version}`, tone: 'dim', login };
    if (login?.state === 'unverified') return { status: `Installed · sign-in unknown${version}`, tone: 'dim', login };
    if (login?.state === 'signed_in') return { status: `Installed · signed in${version}`, tone: 'ok', login };
    return { status: `Installed${version}`, tone: 'ok', login };
  };
  const icon = (row: HarnessVerifyResult) => <span className="onb-hi" style={{ background: BRAND[row.family] ?? 'var(--text-dim)' }} aria-hidden="true">{row.label.slice(0, 1).toUpperCase()}</span>;

  return <>
    <p>Pick the coding agent that runs your new threads. You can still switch per thread from the composer.</p>
    {error ? <div className="onb-callout err" role="alert">
      Couldn’t check your coding agents. {error}
      <div className="onb-row"><button type="button" className="onb-btn sm" onClick={scan}>Retry</button></div>
    </div> : rows === null ? <ul className="onb-hcards" aria-label="Coding agents" aria-busy="true">
      {[0, 1, 2].map(i => <li key={i} className="onb-hc scanning" aria-hidden="true"><span className="onb-hi ghost" /><span className="onb-hc-name">Checking…</span><span className="onb-scan" /></li>)}
    </ul> : <>
      {installed.length ? <ul className="onb-hcards" role="radiogroup" aria-label="Coding agents">
        {installed.map((row, index) => {
          const { status, tone, login } = statusOf(row);
          const isSelected = row.family === chosen;
          return <li key={row.family} className={`onb-hc pick${isSelected ? ' def' : ''}`} data-family={row.family}>
            <button type="button" role="radio" aria-checked={isSelected} tabIndex={isSelected ? 0 : -1}
              className="onb-hc-pick" onClick={() => pick(row.family)} onKeyDown={event => onRadioKey(event, index)}>
              {icon(row)}
              <strong className="onb-hc-name">{row.label}</strong>
              <span className="onb-hc-status"><span className={`onb-dot ${tone}`} aria-hidden="true" />{status}</span>
              <span className="onb-radio" aria-hidden="true" />
            </button>
            {login?.state === 'sign_in_required' ? <>
              <code className="onb-hc-hint">Run “{login.loginCommand}” in a terminal, or sign in from settings.</code>
              <span className="onb-hc-links"><button type="button" className="onb-link" aria-label={`Sign in to ${row.label}`} onClick={() => appNavigate(getSettingsRoutePath('harness'))}>Sign in</button></span>
            </> : login?.state === 'unverified' && isSelected ? <span className="onb-hc-links">
              <button type="button" className="onb-link" aria-label={`Open settings for ${row.label}`} onClick={() => appNavigate(getSettingsRoutePath('harness'))}>Check sign-in in settings</button>
            </span> : null}
          </li>;
        })}
      </ul> : <div className="onb-callout">No coding agent is installed yet. Install one below, then come back. You can skip this for now.</div>}
      {missing.length ? <div className="onb-missing">
        <button type="button" className="onb-link" aria-expanded={showMissing || !installed.length} onClick={() => setShowMissing(!showMissing)}>
          {showMissing || !installed.length ? 'Hide' : 'Show'} {missing.length} not installed
        </button>
        <ul className="onb-hcards compact" aria-label="Not installed" hidden={!(showMissing || !installed.length)}>
          {missing.map(row => <li key={row.family} className="onb-hc ghost" data-family={row.family}>
            {icon(row)}
            <strong className="onb-hc-name">{row.label}</strong>
            <span className="onb-hc-status"><span className="onb-dot dim" aria-hidden="true" />Not installed</span>
            <span className="onb-hc-act"><button type="button" className="onb-btn q sm" aria-expanded={hintFor === row.family} onClick={() => setHintFor(hintFor === row.family ? null : row.family)}>Install guide</button></span>
            {hintFor === row.family ? <code className="onb-hc-hint">{row.installHint}</code> : null}
          </li>)}
        </ul>
      </div> : null}
    </>}
    <div className="onb-row onb-cta">
      <button type="button" className="onb-btn q sm" onClick={onSkip}>Skip for now</button>
      <span className="onb-sp" />
      {error ? null : <button type="button" className="onb-btn p lg" disabled={!ready || saving !== null} onClick={() => { void confirm(); }}>
        {ready && current ? <>Continue with {current.label}<span aria-hidden="true"> →</span></> : rows ? 'Select an installed agent' : 'Checking…'}
      </button>}
    </div>
  </>;
}
