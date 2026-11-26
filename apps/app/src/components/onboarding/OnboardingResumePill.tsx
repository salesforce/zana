import { hasDesktopBridge } from '../../lib/app-surface.js';
import { isScopedWindow } from '../../lib/windowScope.js';
import { openOnboarding, useOnboarding } from './onboarding-store.js';
import { SHORT_TITLE, summarizeSteps } from './onboarding-steps.js';
import './onboarding.css';

/** Sidebar entry shown while the companion is minimized. Click restores it. */
export function OnboardingResumePill() {
  const open = useOnboarding(s => s.open);
  const progress = useOnboarding(s => s.progress);
  const profile = useOnboarding(s => s.profile);
  if (!open || !progress?.minimized || !hasDesktopBridge() || isScopedWindow()) return null;
  const { handled, total, remaining, settled } = summarizeSteps(progress, profile);
  if (settled) return null;
  const summary = remaining.map(id => SHORT_TITLE[id]).join(' · ');
  return <button type="button" className="onb-pill" onClick={openOnboarding} aria-label={`Finish setting up, ${handled} of ${total} done. Remaining: ${summary}`}>
    <span className="onb-ring" style={{ ['--p' as string]: Math.round((handled / total) * 100) }} data-label={`${handled}/${total}`} aria-hidden="true" />
    <span className="onb-pill-text"><strong>Finish setting up</strong><span>{summary}</span></span>
  </button>;
}
