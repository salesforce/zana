import { product } from '../lib/product-client.js';
import { useEffect, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { GITHUB_REPO_URL } from '@zana-ai/zcc-domain/product';
import { isScopedWindow } from '../lib/windowScope.js';

/**
 * First-run "star us" nudge: shown once until dismissed or acted on, gated on
 * AppConfig.sponsorPromptDismissed (same pattern as the walkthrough). Starts
 * hidden and only opens once the flag is confirmed absent/false, so it never
 * flashes on a machine that already dismissed it. Dedicated project windows
 * never show it.
 */
export function SponsorNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isScopedWindow()) return;
    product.config
      .get()
      .then((c) => setShow(!c.sponsorPromptDismissed))
      .catch(() => {});
  }, []);

  if (isScopedWindow() || !show) return null;

  const dismiss = () => {
    setShow(false);
    product.config.set({ sponsorPromptDismissed: true }).catch(() => {});
  };
  const openSponsor = () => {
    window.open(GITHUB_REPO_URL, '_blank', 'noopener');
    dismiss();
  };

  return (
    <div className="sponsor-nudge" role="dialog" aria-label="Support Zana">
      <Heart size={16} className="sponsor-nudge-heart" aria-hidden />
      <div className="sponsor-nudge-text">
        <strong>Enjoying Zana?</strong>
        <span>A GitHub ⭐ helps the project — it's free.</span>
      </div>
      <button type="button" className="sponsor-nudge-cta" onClick={openSponsor}>
        Star on GitHub
      </button>
      <button
        type="button"
        className="sponsor-nudge-close"
        onClick={dismiss}
        title="Dismiss"
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
