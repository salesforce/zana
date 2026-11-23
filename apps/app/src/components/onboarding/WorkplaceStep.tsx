import { useEffect, useRef, useState } from 'react';
import { emptyOnboardingSteps, type OnboardingProfile, type OnboardingProgress, type OnboardingStepState } from '@zana-ai/zcc-domain/onboarding';
import { product } from '../../lib/product-client.js';
import { ZanaSpinner } from '../fairy/ZanaSpinner.js';
import { GitAccessChecklist } from './GitAccessChecklist.js';
import { loadIdentityHint, saveOnboarding, useOnboarding } from './onboarding-store.js';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function baseProgress(profile: OnboardingProfile): OnboardingProgress {
  return useOnboarding.getState().progress ?? { version: 2, profileId: profile.id, audience: 'undecided', steps: emptyOnboardingSteps() };
}

/** Add or refresh the distribution's marketplace; throws with Git's message on failure. */
export async function connectProfileMarketplace(profile: OnboardingProfile): Promise<string> {
  const catalogs = await product.marketplaces.list();
  const existing = catalogs.find(row => row.source === profile.marketplaceSource);
  const row = existing ? await product.marketplaces.refresh(existing.source) : await product.marketplaces.add(profile.marketplaceSource);
  if (row.lastError) throw new Error(row.lastError);
  return row.source;
}

const CloudMark = () => <svg className="onb-cloud" viewBox="0 0 30 22" fill="currentColor" aria-hidden="true"><path d="M12.5 3.2A5.4 5.4 0 0 1 16.4 1.5c2 0 3.8 1.1 4.7 2.8a6.5 6.5 0 0 1 2.7-.6c3.6 0 6.5 3 6.5 6.6s-2.9 6.6-6.5 6.6c-.4 0-.9 0-1.3-.1a4.8 4.8 0 0 1-6.3 2 5.5 5.5 0 0 1-10.2-.4 5 5 0 0 1-1 .1C2.2 18.5 0 16.2 0 13.4c0-1.9 1-3.5 2.5-4.4a5.8 5.8 0 0 1 10-5.8z" /></svg>;

/**
 * Step 2 (only with a distribution profile): "Do you work at {organization}?".
 * Yes reuses the marketplace access flow and may keep running in the background:
 * the companion keeps this component mounted while the step is `background`.
 */
export function WorkplaceStep({ profile, state, onConnected, onBackground, onSkip, onDecline }: {
  profile: OnboardingProfile;
  state: OnboardingStepState;
  /** Marketplace is connected and saved. */
  onConnected: () => void;
  onBackground: () => void;
  onSkip: () => void;
  /** "No, or not now": the step is skipped. */
  onDecline: () => void;
}) {
  const hint = useOnboarding(s => s.identityHint);
  const audience = useOnboarding(s => s.progress?.audience);
  const [choice, setChoice] = useState<'yes' | 'no' | null>(audience === 'organization' ? 'yes' : audience === 'general' ? 'no' : null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!hint) void loadIdentityHint(); }, [hint]);

  const pick = (next: 'yes' | 'no') => {
    setChoice(next);
    void saveOnboarding({ ...baseProgress(profile), audience: next === 'yes' ? 'organization' : 'general' }).catch(() => undefined);
  };
  const connect = async () => {
    const source = await connectProfileMarketplace(profile);
    await saveOnboarding({ ...baseProgress(profile), audience: 'organization', marketplaceSource: source });
    onConnected();
  };
  const connectSimple = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await connect(); } catch (reason) { if (alive.current) setError(errorText(reason)); }
    finally { if (alive.current) setBusy(false); }
  };
  const gitAuth = profile.gitAuth;
  const connected = state === 'done';
  return <>
    {hint?.match ? <div className="onb-detect"><CloudMark />
      <div>It looks like you work at <b>{profile.organization}</b>{hint.email ? <>. Your Git identity uses <b>{hint.email}</b></> : null}. Connect internal tools?</div></div> : null}
    <p>{hint?.match ? 'We found a hint, but you decide.' : profile.question} Employees get the internal plugin marketplace.</p>
    <div className="onb-choice" role="group" aria-label={profile.question}>
      <button type="button" className="onb-ch" aria-pressed={choice === 'yes'} onClick={() => pick('yes')}>
        <strong>Yes, I’m an employee</strong><small>Internal marketplace and curated bundles</small></button>
      <button type="button" className="onb-ch" aria-pressed={choice === 'no'} onClick={() => pick('no')}>
        <strong>No, or not now</strong><small>Public plugins only. You can change this in Settings.</small></button>
    </div>
    {choice === 'yes' ? (gitAuth
      // The checklist stays available once connected so access can be re-checked.
      ? <div className="onb-access"><GitAccessChecklist profile={{ ...profile, gitAuth }} connect={connect} footerTarget={footer} /></div>
      : connected ? <div className="onb-bgtask" role="status">Marketplace connected</div>
        : <div className="onb-card">
          <p>{profile.prerequisite}</p><code className="onb-source">{profile.marketplaceSource}</code>
          {error ? <p className="onb-callout err" role="alert">{error}. Check your corporate connection and Git sign-in, then retry. You can finish later.</p> : null}
          <button type="button" className="onb-btn p" disabled={busy} onClick={() => { void connectSimple(); }}>
            {busy ? <><ZanaSpinner size={13} /> Checking access…</> : error ? 'Retry access check' : 'Check access and continue'}</button>
        </div>) : null}
    <div className="onb-row">
      <button type="button" className="onb-btn q sm" onClick={onSkip}>Skip</button>
      <span className="onb-sp" />
      {choice === 'yes' ? <div ref={setFooter} className="onb-footer-slot" /> : null}
      {choice === 'yes' && !connected && state !== 'background' ? <button type="button" className="onb-btn" onClick={onBackground}>Continue, finish in background</button> : null}
      {choice === 'no' ? <button type="button" className="onb-btn p" onClick={onDecline}>Continue</button> : null}
      {choice === 'yes' && connected ? <button type="button" className="onb-btn p" onClick={onConnected}>Continue</button> : null}
    </div>
  </>;
}
