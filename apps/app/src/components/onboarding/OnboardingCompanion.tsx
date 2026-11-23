import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { onboardingStepsSettled, type OnboardingProfile, type OnboardingStepId, type OnboardingStepState } from '@zana-ai/zcc-domain/onboarding';
import type { PluginPackInstallation } from '@zana-ai/zcc-domain';
import { useUi } from '../../store.js';
import zanaLogo from '../../assets/zana-favicon.svg';
import { setBasicUiMode, useBasicUi } from '../../lib/basic-ui.js';
import { AdvancedCoachmark } from './AdvancedCoachmark.js';
import { AdvancedStep } from './AdvancedStep.js';
import { BundleStep } from './BundleStep.js';
import { HarnessStep } from './HarnessStep.js';
import { WorkplaceStep } from './WorkplaceStep.js';
import { saveOnboarding, setMinimized, setStep, useOnboarding } from './onboarding-store.js';
import { isHandled, stepStates, summarizeSteps, visibleSteps } from './onboarding-steps.js';
import './onboarding.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const CELEBRATE_MS = 1600;
const LEAVE_MS = 380;

const toast = (message: string, kind: 'info' | 'error' = 'info') => { useUi.getState().pushToast(message, kind); };

/**
 * Non-blocking setup companion: a floating complementary region (no backdrop, no focus trap).
 * It stays mounted while minimized so a background marketplace connection keeps running.
 */
export function OnboardingCompanion({ profile }: { profile: OnboardingProfile | null }) {
  const progress = useOnboarding(s => s.progress);
  const interfaceMode = useBasicUi() ? 'basic' : 'advanced';
  const minimized = !!progress?.minimized;
  const { ids, steps, handled, total, settled } = summarizeSteps(progress, profile);
  const [openStep, setOpenStep] = useState<OnboardingStepId | null>(() => ids.find(id => !isHandled(steps[id])) ?? null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; timers.current.forEach(clearTimeout); }; }, []);

  // The centred card floats over the main column (see onboarding.css); mark the body while it is visible.
  useEffect(() => {
    if (minimized) return;
    document.body.dataset.onboardingCompanion = 'open';
    return () => { delete document.body.dataset.onboardingCompanion; };
  }, [minimized]);

  // Never in the way: typing into the app (composer, search…) tucks the card into the sidebar pill.
  const minimizeRef = useRef<(message?: string, focusPill?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    if (minimized) return;
    const onType = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || panel.current?.contains(target) || target.closest('.onb-coach')) return;
      if (target.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]), [contenteditable=""], [contenteditable="true"]')) {
        void minimizeRef.current('Setup is waiting in the sidebar', false);
      }
    };
    document.addEventListener('input', onType, true);
    return () => document.removeEventListener('input', onType, true);
  }, [minimized]);

  const showAdvanced = !minimized && openStep === 'advanced' && interfaceMode === 'basic';
  useEffect(() => { setCoachOpen(showAdvanced); }, [showAdvanced]);
  // Glow ring on the title-bar view switch while the Advanced step is open (see onboarding.css).
  useEffect(() => {
    if (!showAdvanced) return;
    document.body.dataset.onboardingSpotlight = 'interface-mode';
    return () => { delete document.body.dataset.onboardingSpotlight; };
  }, [showAdvanced]);

  const nextAfter = useCallback((from: StepFrom) => {
    const latest = stepStates(useOnboarding.getState().progress);
    const order = visibleSteps(profile);
    const start = from ? order.indexOf(from) + 1 : 0;
    return [...order.slice(start), ...order.slice(0, start)].find(id => id !== from && latest[id] === 'todo') ?? null;
  }, [profile]);

  const finish = useCallback(() => {
    toast('Setup complete. Welcome to Zana');
    setCelebrating(true);
    timers.current.push(setTimeout(() => {
      setLeaving(true);
      timers.current.push(setTimeout(() => { useOnboarding.setState({ open: false }); }, LEAVE_MS));
    }, CELEBRATE_MS));
  }, []);

  /** Persist one step, then auto-advance. Returns false when the write failed (the step stays actionable). */
  const mark = useCallback(async (id: OnboardingStepId, state: OnboardingStepState, advance = true) => {
    try {
      // Without a profile the workplace step never applies; settle it so completion can be recorded.
      if (!profile && stepStates(useOnboarding.getState().progress).workplace === 'todo') await setStep('workplace', 'skipped');
      await setStep(id, state);
    } catch (reason) {
      toast(`Could not save setup progress: ${errorText(reason)}`, 'error');
      return false;
    }
    if (!alive.current) return true;
    const latest = stepStates(useOnboarding.getState().progress);
    if (advance) setOpenStep(prev => prev === id || prev === null ? nextAfter(id) : prev);
    if (onboardingStepsSettled(latest)) finish();
    return true;
  }, [profile, nextAfter, finish]);

  // Switching view anywhere (title bar switch, "Open in Advanced") completes the Advanced step.
  useEffect(() => {
    if (interfaceMode === 'advanced' && steps.advanced === 'todo' && progress) void mark('advanced', 'done');
  }, [interfaceMode, steps.advanced, progress, mark]);

  const minimize = async (message?: string, focusPill = true) => {
    if (settled) { useOnboarding.setState({ open: false }); return; }
    try { await setMinimized(true); } catch (reason) { toast(`Could not minimize setup: ${errorText(reason)}`, 'error'); return; }
    if (message) toast(message);
    if (focusPill) setTimeout(() => document.querySelector<HTMLElement>('.onb-pill')?.focus(), 60);
  };
  minimizeRef.current = minimize;

  // Restoring (from the pill or Settings) moves focus into the panel without trapping it.
  const wasMinimized = useRef(minimized);
  useEffect(() => {
    if (wasMinimized.current && !minimized) panel.current?.focus();
    wasMinimized.current = minimized;
  }, [minimized]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !minimized) { event.preventDefault(); void minimize(); }
  };

  const meta: Record<OnboardingStepId, { title: string; sub: string }> = {
    harness: { title: 'Confirm your coding agent', sub: 'The CLI that runs your threads' },
    workplace: { title: `${profile?.organization ?? 'Workplace'} tools`, sub: 'Internal marketplace and bundles' },
    bundle: { title: 'Pick a starter bundle', sub: 'Plugins tailored to your work' },
    advanced: { title: 'Meet Advanced', sub: 'When you need more control' }
  };

  const body = (id: OnboardingStepId) => {
    if (id === 'harness') return <HarnessStep onSkip={() => { void mark('harness', 'skipped'); }}
      onDone={label => { void mark('harness', 'done').then(ok => { if (ok) toast(`${label} will run your threads`); }); }} />;
    if (id === 'workplace' && profile) return <WorkplaceStep profile={profile} state={steps.workplace}
      onSkip={() => { void mark('workplace', 'skipped'); }}
      onDecline={() => { void mark('workplace', 'skipped'); }}
      onBackground={() => { void mark('workplace', 'background').then(ok => { if (ok) toast('Marketplace keeps connecting in the background'); }); }}
      onConnected={() => {
        const already = stepStates(useOnboarding.getState().progress).workplace === 'done';
        void mark('workplace', 'done').then(ok => { if (ok && !already) toast(`${profile.organization} marketplace connected`); });
      }} />;
    if (id === 'bundle') return <BundleStep profile={profile} progress={progress} workplace={steps.workplace}
      onSkip={() => { void mark('bundle', 'skipped'); }}
      onBrowse={() => { void mark('bundle', 'done'); }}
      onInstalled={async (installation: PluginPackInstallation) => {
        const pluginIds = installation.members.filter(m => m.selected && m.status === 'installed').map(m => m.pluginId);
        const current = useOnboarding.getState().progress;
        if (current) await saveOnboarding({ ...current, packId: installation.identity.packId, pluginIds });
        const ok = await mark('bundle', 'done');
        if (ok) toast(`Installed ${pluginIds.length} plugin${pluginIds.length === 1 ? '' : 's'}. Each asks for its own sign-in in Plugin settings`);
      }} />;
    return <AdvancedStep mode={interfaceMode} coachOpen={coachOpen}
      onShow={() => setCoachOpen(true)}
      onStay={() => { void mark('advanced', interfaceMode === 'advanced' ? 'done' : 'skipped'); }}
      onSwitch={() => { setBasicUiMode('advanced'); }} />;
  };

  const rightLabel = (state: OnboardingStepState) => state === 'done' ? 'Done' : state === 'skipped' ? 'Skipped · resume' : state === 'background' ? 'Running…' : '';

  return <>
    <aside ref={panel} tabIndex={-1} role="complementary" aria-label="Set up Zana" className={`onb-comp${minimized ? ' min' : ''}${leaving ? ' leaving' : ''}`}
      data-testid="onboarding-companion" inert={minimized || undefined} aria-hidden={minimized || undefined} onKeyDown={onKeyDown}>
      <header className="onb-head">
        <img className="onb-logo" src={zanaLogo} alt="" width={28} height={28} />
        <div className="onb-head-text">
          <strong>{celebrating ? 'All set. Welcome to Zana' : settled ? 'Setup complete' : 'Let’s get you set up'}</strong>
          <span>{celebrating || settled ? 'Reopen from Settings → Preferences any time' : '~2 min · nothing here blocks you'}</span>
        </div>
        <span className="onb-sp" />
        <button type="button" className="onb-btn q sm" onClick={() => { void minimize(); }}>{settled ? 'Close' : 'Minimize'}</button>
      </header>
      <div className="onb-prog" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={handled}
        aria-valuetext={`${handled} of ${total} steps done`}>
        {ids.map(id => <i key={id} className={steps[id] === 'done' ? 'done' : steps[id] === 'skipped' ? 'skip' : steps[id] === 'background' ? 'bg' : ''}
          style={{ ['--w' as string]: openStep === id && steps[id] === 'todo' ? '35%' : '0%' }} />)}
      </div>
      <div className="onb-steps">
        {ids.map((id, index) => {
          const state = steps[id];
          const open = openStep === id;
          // A running background connection must stay mounted (hidden) so it can finish.
          const mounted = open || (id === 'workplace' && state === 'background');
          return <section key={id} className={`onb-st ${state}${open ? ' open' : ''}`} data-step={id} data-state={state}>
            <button type="button" className="onb-sh" aria-expanded={open} aria-controls={`onb-bd-${id}`} onClick={() => setOpenStep(open ? null : id)}>
              <span className="onb-bdg" aria-hidden="true">{state === 'done' ? <Check size={12} strokeWidth={3} /> : state === 'background' ? '' : index + 1}</span>
              <span className="onb-sh-text"><strong>{meta[id].title}</strong><small>{meta[id].sub}</small></span>
              <span className="onb-r">{rightLabel(state)}</span>
            </button>
            {mounted ? <div id={`onb-bd-${id}`} className="onb-bd" hidden={!open}>{body(id)}</div> : null}
          </section>;
        })}
      </div>
      <footer className="onb-foot">
        <span className="onb-lock"><span aria-hidden="true">🔒</span> Nothing is installed or signed in without your click</span>
        <span className="onb-sp" />
        {settled ? null : <button type="button" className="onb-btn q sm" onClick={() => { void minimize('Setup saved. Resume it from the sidebar'); }}>Finish later</button>}
      </footer>
    </aside>
    {coachOpen && showAdvanced ? <AdvancedCoachmark
      onGotIt={() => { setCoachOpen(false); void mark('advanced', 'done'); }}
      onSwitch={() => { setCoachOpen(false); setBasicUiMode('advanced'); }} /> : null}
  </>;
}

type StepFrom = OnboardingStepId | null;
