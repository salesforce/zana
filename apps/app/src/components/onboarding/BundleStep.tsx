import { useState } from 'react';
import type { PluginPackInstallation } from '@zana-ai/zcc-domain';
import type { OnboardingProfile, OnboardingProgress, OnboardingStepState } from '@zana-ai/zcc-domain/onboarding';
import { appNavigate } from '../../lib/app-navigate.js';
import { getPluginSettingsRoutePath, TOOLS_PLUGIN_BROWSE_ROUTE_PATH } from '../../lib/route-paths.js';
import { PluginPacksCollection } from '../../views/extensions/PluginPacksCollection.js';

/**
 * Step 3: starter bundle. Organization members choose from the connected marketplace;
 * everyone else is pointed at Browse plugins (no public pack source exists today).
 */
export function BundleStep({ profile, progress, workplace, onInstalled, onBrowse, onSkip }: {
  profile: OnboardingProfile | null;
  progress: OnboardingProgress | undefined;
  workplace: OnboardingStepState;
  onInstalled: (installation: PluginPackInstallation) => void | Promise<void>;
  onBrowse: () => void;
  onSkip: () => void;
}) {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [review, setReview] = useState(false);
  const source = progress?.audience === 'organization' ? progress.marketplaceSource : undefined;
  const org = !!profile && !!source;
  const waiting = !!profile && progress?.audience === 'organization' && !source;
  return <>
    {org ? <>
      <p>Curated by {profile.organization}. Each plugin asks for its own sign-in later; installing never signs you in.</p>
      <PluginPacksCollection mode="browse" presentation="onboarding" marketplaceSource={source} footerTarget={footer}
        onReviewChange={setReview} onInstalled={onInstalled}
        onOpenPlugin={id => appNavigate(getPluginSettingsRoutePath(id))} />
    </> : waiting ? <p role="status">Bundles load when the {profile.organization} marketplace is ready{workplace === 'background' ? ' (still connecting in the background)' : ''}. You can skip this and come back.</p>
      : <p>Start small. Browse public plugins and add what you need. You can add more from Plugins at any time.</p>}
    <div className="onb-row">
      <button type="button" className="onb-btn q sm" onClick={onSkip}>Skip</button>
      <span className="onb-sp" />
      <div ref={setFooter} className="onb-footer-slot" data-review={review ? 'open' : undefined} />
      {org ? null : <button type="button" className="onb-btn p" onClick={() => { onBrowse(); appNavigate(TOOLS_PLUGIN_BROWSE_ROUTE_PATH); }}>Browse plugins</button>}
    </div>
  </>;
}
