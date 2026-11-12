import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import {
  gitAccessStatusSchema, gitSignInStateSchema,
  type GitAccessStatus, type GitSignInState, type OnboardingProfile
} from '@zana-ai/zcc-domain/onboarding';
import { apiJson } from '../../lib/fetch-with-app-surface.js';
import { copyText } from '../../lib/copy-text.js';
import { explainGitCloneError } from '../../lib/git-clone-error.js';

type Row = 'idle' | 'run' | 'ok' | 'bad';
type Auth = 'idle' | 'run' | 'need' | 'code' | 'finishing' | 'ok' | 'nogh' | 'expired' | 'failed';
const POLL_MS = 1_000;

const fetchStatus = async () => gitAccessStatusSchema.parse((await apiJson<{ status: unknown }>('/onboarding/git/status')).status);
const signIn = async (action: 'start' | 'cancel' | null) => gitSignInStateSchema.parse((await apiJson<{ state: unknown }>(
  action ? `/onboarding/git/sign-in/${action}` : '/onboarding/git/sign-in', action ? { method: 'POST', body: '{}' } : {})).state);

function Icon({ state }: { state: string }) {
  if (state === 'ok') return <span className="onboarding-check-icon ok" aria-label="Done"><Check size={13} /></span>;
  if (['bad', 'nogh', 'expired', 'failed'].includes(state)) return <span className="onboarding-check-icon bad" aria-label="Needs attention">!</span>;
  if (['run', 'code', 'finishing'].includes(state)) return <span className="onboarding-check-icon run" aria-label="In progress" />;
  if (state === 'need') return <span className="onboarding-check-icon act" aria-label="Action needed">2</span>;
  return <span className="onboarding-check-icon wait" aria-hidden="true" />;
}

function CheckRow({ state, title, detail, action, children }: { state: string; title: string; detail?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return <li className="onboarding-check" data-state={state}>
    <Icon state={state} />
    <div className="onboarding-check-text"><strong>{title}</strong>{detail ? <p className="settings-help">{detail}</p> : null}</div>
    <div className="onboarding-check-action">{action}</div>
    {children ? <div className="onboarding-check-extra">{children}</div> : null}
  </li>;
}

/**
 * Employee marketplace access as a self-running checklist: network → Git sign-in → marketplace.
 * Main owns every probe and the `gh` device flow; this view only renders their results.
 */
export function GitAccessChecklist({ profile, connect, footerTarget, onBusyChange }: {
  profile: OnboardingProfile & { gitAuth: NonNullable<OnboardingProfile['gitAuth']> };
  /** Adds/refreshes the marketplace and advances setup; throws with Git's message on failure. */
  connect: () => Promise<void>;
  footerTarget: HTMLElement | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const host = profile.gitAuth.host;
  const [network, setNetwork] = useState<Row>('idle');
  const [auth, setAuth] = useState<Auth>('idle');
  const [access, setAccess] = useState<Row>('idle');
  const [status, setStatus] = useState<GitAccessStatus | null>(null);
  const [device, setDevice] = useState<Extract<GitSignInState, { phase: 'waiting' }> | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const signingIn = useRef(false);
  useEffect(() => { alive.current = true; return () => {
    alive.current = false; clearTimeout(poll.current);
    // Leaving the step (Skip / Change setup choice) must not leave a gh login waiting in main.
    if (signingIn.current) void signIn('cancel').catch(() => undefined);
  }; }, []);
  const busy = [network, auth, access].some(s => s === 'run' || s === 'finishing');
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  // A successful connect advances the wizard and unmounts this step before
  // setAccess('ok') can run. Release the parent's navigation lock on exit.
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);

  const tryMarketplace = async (current: GitAccessStatus) => {
    setAccess('run'); setDetail(null);
    try {
      await connect();
      if (!alive.current) return;
      setAccess('ok');
      if (current.signedIn !== 'yes') setAuth('ok');
    } catch (reason) {
      if (!alive.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setDetail(message);
      // A gh login does not prove Git authenticated, and download failures can
      // also be network, certificate or repository errors. Never infer a grant.
      if (current.signedIn === 'yes') setAccess('bad');
      else { setAccess('idle'); setAuth(current.cli === 'missing' ? 'nogh' : 'need'); }
    }
  };

  const runChecks = async () => {
    if (busy) return;
    clearTimeout(poll.current);
    setNetwork('run'); setAuth('idle'); setAccess('idle'); setDetail(null); setDevice(null);
    let current: GitAccessStatus;
    try { current = await fetchStatus(); } catch {
      if (alive.current) { setNetwork('idle'); setDetail('Could not run the access check. Try again.'); setAccess('bad'); }
      return;
    }
    if (!alive.current) return;
    setStatus(current);
    if (!current.reachable) { setNetwork('bad'); return; }
    setNetwork('ok');
    setAuth(current.signedIn === 'yes' ? 'ok' : 'run');
    await tryMarketplace(current);
  };

  const follow = (state: GitSignInState) => {
    signingIn.current = ['starting', 'waiting', 'finishing'].includes(state.phase);
    if (!alive.current) return;
    if (state.phase === 'waiting') { setDevice(state); setAuth('code'); }
    else if (state.phase === 'starting') setAuth('code');
    else if (state.phase === 'finishing') { setDevice(null); setAuth('finishing'); }
    if (state.phase === 'starting' || state.phase === 'waiting' || state.phase === 'finishing') {
      poll.current = setTimeout(() => { void signIn(null).then(follow, () => follow({ phase: 'failed', error: 'Lost track of the sign-in. Try again.' })); }, POLL_MS);
      return;
    }
    setDevice(null);
    if (state.phase === 'succeeded') { void runChecks(); return; }
    if (state.phase === 'expired') setAuth('expired');
    else if (state.phase === 'failed') { setAuth(/not installed/i.test(state.error) ? 'nogh' : 'failed'); setDetail(state.error); }
    else setAuth('need');
  };
  const startSignIn = () => {
    setDetail(null); setAccess('idle'); setAuth('code'); signingIn.current = true;
    void signIn('start').then(follow, () => follow({ phase: 'failed', error: 'Could not start the browser sign-in.' }));
  };
  const cancelSignIn = () => {
    clearTimeout(poll.current); signingIn.current = false; setDevice(null); setAuth('need');
    void signIn('cancel').catch(() => undefined);
  };
  const copyCode = () => {
    if (!device) return;
    void copyText(device.code).then(() => { if (!alive.current) return; setCopied(true); setTimeout(() => { if (alive.current) setCopied(false); }, 1500); });
  };
  const openDevicePage = () => { if (device) globalThis.open(device.verificationUrl, '_blank', 'noopener'); };

  const minutes = device ? Math.max(1, Math.round((device.expiresAt - Date.now()) / 60_000)) : 0;
  const login = status?.login;
  const accessError = detail ? explainGitCloneError(detail) : null;
  const authTitle = auth === 'ok' ? 'Signed in to Git' : 'Sign in to Git';
  const authDetail: Record<Auth, ReactNode> = {
    idle: `Zana uses your ${host} account to download the marketplace.`,
    run: 'Looking for an existing Git sign-in…',
    need: `You’re not signed in to ${host} yet. Sign in once with your browser — no password or token to paste.`,
    code: device ? `Enter this code on ${host} when asked.` : 'Starting browser sign-in…',
    finishing: 'Approved — saving your Git sign-in…',
    ok: login ? undefined : 'Your existing Git credentials work.',
    nogh: 'Browser sign-in needs the GitHub CLI, which isn’t installed.',
    expired: 'That code expired before it was approved.',
    failed: detail ?? 'Sign-in did not complete.'
  };
  const footerButton = <button type="button" className="settings-btn primary" disabled={busy || auth === 'code'} onClick={() => { void runChecks(); }}>
    {busy ? <><Loader2 size={14} /> Checking access…</> : <><RefreshCw size={14} /> {network === 'idle' && access === 'idle' && auth === 'idle' ? 'Check access and continue' : 'Retry access check'}</>}
  </button>;

  return <>
    <p>{profile.organization} plugin bundles come from an internal Git marketplace. We’ll check each step and only ask you to act when needed.</p>
    <section className="onboarding-card" aria-label="Marketplace access checks">
      <ul className="onboarding-checks">
        <CheckRow state={network} title={network === 'ok' ? 'Connected to the corporate network' : 'Corporate network (VPN)'}
          detail={network === 'bad' ? `Can’t reach ${host}. Connect to the VPN, then retry.` : network === 'run' ? `Checking that ${host} is reachable…` : network === 'ok' ? `${host} is reachable.` : 'Required to reach the internal marketplace.'} />
        <CheckRow state={auth} title={authTitle} detail={authDetail[auth]}
          action={auth === 'need' ? <button type="button" className="settings-btn primary" onClick={startSignIn}>Sign in with browser</button>
            : auth === 'expired' || auth === 'failed' ? <button type="button" className="settings-btn primary" onClick={startSignIn}>{auth === 'expired' ? 'Get a new code' : 'Try again'}</button>
              : auth === 'ok' && login ? <span className="onboarding-who"><span aria-hidden="true">{login.slice(0, 2).toUpperCase()}</span>{login}@{host}</span> : null}>
          {auth === 'code' && device ? <div className="onboarding-device" role="group" aria-label="One-time sign-in code">
            <span className="onboarding-device-label">Your one-time code</span>
            <output className="onboarding-device-code" aria-live="polite">{device.code}</output>
            <div className="onboarding-device-actions">
              <button type="button" className="settings-btn primary" onClick={openDevicePage}>Open {host} <ExternalLink size={13} /></button>
              <button type="button" className="settings-btn" onClick={copyCode}>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy code</>}</button>
            </div>
            <div className="onboarding-device-foot"><span className="onboarding-pulse" aria-hidden="true" /> Waiting for approval in your browser… We’ll continue automatically.
              <span className="onboarding-device-expiry">Expires in {minutes} min</span>
              <button type="button" className="onboarding-link" onClick={cancelSignIn}><X size={12} /> Cancel</button></div>
          </div> : null}
          {auth === 'nogh' ? <div className="onboarding-callout warn">Install the GitHub CLI, then retry:
            <code className="onboarding-cmd">brew install gh</code>
            Prefer your own setup? Sign in with SSH keys or your Git credential manager in a terminal, then retry.</div> : null}
        </CheckRow>
        <CheckRow state={access} title={access === 'ok' ? 'Marketplace access confirmed' : 'Marketplace access'}
          detail={access === 'run' ? 'Downloading the marketplace catalogue…' : access === 'ok' ? 'Marketplace connected.'
            : access === 'bad' && login ? `Signed in as ${login}, but the marketplace download failed.`
              : access === 'bad' ? detail : 'Your account needs read access to the marketplace repository.'}
          action={access === 'bad' && login ? <button type="button" className="settings-btn" onClick={startSignIn}>Use a different account</button> : null}>
          {access === 'bad' && login && accessError ? <div className="onboarding-callout err">
            <strong>{accessError.title}</strong>
            {accessError.guidance.map(text => <p key={text}>{text}</p>)}
          </div> : null}
        </CheckRow>
      </ul>
      <details className="onboarding-details"><summary>Details</summary>
        <code className="onboarding-source">{profile.marketplaceSource}</code>
        <p className="settings-help">Browser sign-in uses the GitHub CLI. Your token stays in its credential store and Git is configured to use it; Zana never sees your password or token.</p>
        {detail && auth !== 'failed' && !(access === 'bad' && !login) ? <p className="settings-help onboarding-git-detail">{detail}</p> : null}
      </details>
    </section>
    {footerTarget ? createPortal(footerButton, footerTarget) : null}
  </>;
}
