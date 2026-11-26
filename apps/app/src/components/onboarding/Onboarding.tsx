import { useEffect, useState } from 'react';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { isScopedWindow } from '../../lib/windowScope.js';
import { BASIC_UI_SESSION_KEY, isBasicUiRouteSupported, setBasicUiMode } from '../../lib/basic-ui.js';
import { useData, useUi } from '../../store.js';
import { SidebarFooterPortal } from '../sidebar/SidebarFooterSlot.js';
import { OnboardingCompanion } from './OnboardingCompanion.js';
import { OnboardingResumePill } from './OnboardingResumePill.js';
import { loadOnboarding, openOnboarding, useOnboarding } from './onboarding-store.js';
import './onboarding.css';

export { OnboardingCompanion } from './OnboardingCompanion.js';
export { OnboardingResumePill } from './OnboardingResumePill.js';

function hasSessionViewChoice(): boolean {
  try { return window.sessionStorage.getItem(BASIC_UI_SESSION_KEY) !== null; } catch { return false; }
}

/**
 * First run starts in Basic: while setup is pending and "Meet Advanced" is still open, a window
 * that has not picked a view this session opens in Basic. An explicit choice always wins.
 */
export function startPendingSetupInBasic(pathname = window.location.pathname): boolean {
  const { open, progress } = useOnboarding.getState();
  if (!open || progress?.completedAt || (progress && progress.steps.advanced !== 'todo')) return false;
  if (hasSessionViewChoice() || !isBasicUiRouteSupported(pathname)) return false;
  setBasicUiMode('basic');
  return true;
}

/** Mounts the non-blocking setup companion once per primary desktop window. */
export function OnboardingHost() {
  const configLoaded = useData(s => s.configLoaded);
  const open = useOnboarding(s => s.open);
  const profile = useOnboarding(s => s.profile);
  useEffect(() => {
    if (!configLoaded) return;
    if (!hasDesktopBridge() || isScopedWindow()) {
      useOnboarding.setState({ loaded: true });
      return;
    }
    const loader = loadOnboarding();
    let disposed = false;
    void loader.ready.then(() => { if (!disposed) startPendingSetupInBasic(); });
    return () => { disposed = true; loader.dispose(); };
  }, [configLoaded]);
  useEffect(() => {
    if (open) {
      useUi.setState({ walkthroughOpen: false, setupOpen: false });
      return () => { useUi.setState({ walkthroughOpen: false, setupOpen: false }); };
    }
  }, [open]);
  if (!open || !hasDesktopBridge() || isScopedWindow()) return null;
  return <>
    <OnboardingCompanion profile={profile} />
    <SidebarFooterPortal><OnboardingResumePill /></SidebarFooterPortal>
  </>;
}

/** Settings entry: reopens the companion (also without a distribution profile). */
export function OnboardingSettingsAction() {
  const progress = useOnboarding(s => s.progress);
  const error = useOnboarding(s => s.error);
  const [retrying, setRetrying] = useState(false);
  if (!hasDesktopBridge() || isScopedWindow()) return null;
  const reopen = async () => {
    if (error) {
      setRetrying(true);
      const loader = loadOnboarding();
      await loader.ready;
      loader.dispose();
      setRetrying(false);
      if (useOnboarding.getState().error) return;
    }
    openOnboarding();
  };
  const pending = !!progress && !progress.completedAt;
  return <div className="onboarding-settings-action" data-settings-target="global.onboarding">
    <div><strong>Set up Zana</strong><p className="settings-help">{error ?? 'Confirm your coding agent, connect your tools, and meet Advanced mode.'}</p></div>
    <button type="button" className="settings-btn" disabled={retrying} onClick={() => { void reopen(); }}>
      {retrying ? 'Loading…' : pending ? 'Resume setup' : 'Configure'}
    </button>
  </div>;
}
