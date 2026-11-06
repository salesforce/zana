import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Layers, Loader2, RefreshCw } from 'lucide-react';
import type { OnboardingProfile, OnboardingProgress } from '@zana-ai/zcc-domain/onboarding';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import type { PluginPackInstallation } from '@zana-ai/zcc-domain';
import { product } from '../../lib/product-client.js';
import { appNavigate } from '../../lib/app-navigate.js';
import { getPluginDetailRoutePath, TOOLS_PLUGIN_BROWSE_ROUTE_PATH, TOOLS_PLUGINS_ROUTE_PATH } from '../../lib/route-paths.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { isScopedWindow } from '../../lib/windowScope.js';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap.js';
import { useData, useUi } from '../../store.js';
import { PluginPacksCollection } from '../../views/extensions/PluginPacksCollection.js';
import { loadOnboarding, openOnboarding, saveOnboarding, useOnboarding } from './onboarding-store.js';
import './onboarding.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

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
    return loader.dispose;
  }, [configLoaded]);
  useEffect(() => {
    if (open) {
      useUi.setState({ walkthroughOpen: false, setupOpen: false });
      return () => { useUi.setState({ walkthroughOpen: false, setupOpen: false }); };
    }
  }, [open]);
  if (!open || !profile || !hasDesktopBridge() || isScopedWindow()) return null;
  return <Onboarding profile={profile} />;
}

/** Settings entry also permits changing the audience without resetting installed plugins. */
export function OnboardingSettingsAction() {
  const progress = useOnboarding(s => s.progress);
  const error = useOnboarding(s => s.error);
  const profile = useOnboarding(s => s.profile);
  const [retrying, setRetrying] = useState(false);
  if (!hasDesktopBridge() || isScopedWindow()) return null;
  if (!profile && !error) return null;
  const reopen = async () => {
    if (profile) { openOnboarding(); return; }
    setRetrying(true);
    const loader = loadOnboarding();
    await loader.ready;
    loader.dispose();
    setRetrying(false);
    if (useOnboarding.getState().profile) openOnboarding();
  };
  return <div className="onboarding-settings-action" data-settings-target="global.onboarding">
    <div><strong>Set up Zana</strong><p className="settings-help">{error ?? 'Choose your setup, browse plugin bundles, or finish connecting your tools.'}</p></div>
    <button type="button" className="settings-btn" disabled={retrying} onClick={() => { void reopen(); }}>
      {retrying ? 'Loading…' : progress && progress.step !== 'complete' ? 'Resume setup' : 'Configure'}
    </button>
  </div>;
}

export function Onboarding({ profile }: { profile: OnboardingProfile }) {
  const saved = useOnboarding(s => s.progress);
  const initial: OnboardingProgress = saved?.profileId === profile.id ? saved : {
    version: 1, profileId: profile.id, audience: 'undecided', step: 'welcome'
  };
  // Reopening a completed employee flow shows the connection checklist.
  const [progress, setProgress] = useState<OnboardingProgress>(() => initial.audience === 'organization' && initial.step === 'complete'
    ? { ...initial, step: initial.pluginIds?.length ? 'connections' : 'marketplace' } : initial);
  const [busy, setBusy] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);
  const locked = busy || bundleBusy;
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [plugins, setPlugins] = useState<PluginAppEntry[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const persist = async (next: OnboardingProgress) => {
    await saveOnboarding(next);
    if (active.current) setProgress(next);
  };
  const run = async (action: () => Promise<void>) => {
    if (locked) return;
    setBusy(true); setError(null);
    try { await action(); }
    catch (reason) { if (active.current) setError(errorText(reason)); }
    finally { if (active.current) setBusy(false); }
  };
  const finishLater = () => {
    if (locked || reviewOpen) return;
    void run(async () => {
      await persist(progress);
      useOnboarding.setState({ open: false });
    });
  };
  useDialogFocusTrap(dialog, finishLater, !reviewOpen);
  useEffect(() => {
    if (progress.step !== 'connections') return;
    let cancelled = false;
    setPluginsLoading(true);
    const refresh = () => { void product.pluginApps.list().then(rows => {
      if (!cancelled) { setPlugins(rows); setError(null); }
    }).catch(() => { if (!cancelled) setError('Could not read plugin status. Reopen setup to retry.'); })
      .finally(() => { if (!cancelled) setPluginsLoading(false); }); };
    refresh();
    const off = product.pluginApps.onChanged(refresh);
    return () => { cancelled = true; off(); };
  }, [progress.step]);

  const choose = (audience: 'organization' | 'general' | 'undecided') => void run(() => persist({
    version: 1, profileId: profile.id, audience,
    step: audience === 'organization' ? 'marketplace' : audience === 'general' ? 'complete' : 'welcome'
  }));
  const connectMarketplace = () => void run(async () => {
    const catalogs = await product.marketplaces.list();
    const existing = catalogs.find(row => row.source === profile.marketplaceSource);
    const row = existing ? await product.marketplaces.refresh(existing.source) : await product.marketplaces.add(profile.marketplaceSource);
    if (row.lastError) throw new Error(row.lastError);
    if (!active.current) return;
    await persist({ ...progress, step: 'bundles', marketplaceSource: row.source });
  });
  const installed = async (installation: PluginPackInstallation) => {
    await persist({ ...progress, step: 'connections', packId: installation.identity.packId,
      pluginIds: installation.members.filter(member => member.selected && member.status === 'installed').map(member => member.pluginId) });
  };
  const openPlugin = (id: string) => {
    useOnboarding.setState({ open: false });
    appNavigate(`${getPluginDetailRoutePath(id, { view: 'installed' })}#plugin-configure`);
  };
  const complete = (openTools = false) => void run(async () => {
    await persist({ ...progress, step: 'complete' });
    if (!active.current) return;
    useOnboarding.setState({ open: false });
    if (openTools) appNavigate(TOOLS_PLUGINS_ROUTE_PATH);
  });
  const general = progress.audience === 'general';
  const step = progress.step;
  const title = general ? 'Find your tools' : step === 'welcome' ? 'Make Zana yours' : step === 'marketplace'
    ? 'Connect the internal marketplace' : step === 'bundles' ? 'Choose your starting bundle' : 'Finish connecting your tools';

  return createPortal(<div className="onboarding-backdrop" style={reviewOpen ? { display: 'none' } : undefined}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Set up Zana" className="onboarding-dialog">
      <header className="onboarding-header"><span className="onboarding-eyebrow">{general || step === 'welcome' ? 'Welcome to Zana' : `${profile.organization} employee setup`}</span>
        <button type="button" className="settings-btn" disabled={locked} onClick={finishLater}>Skip for now</button></header>
      <div className="onboarding-body">
        <div className="onboarding-symbol"><Layers size={27} /></div>
        <h1>{title}</h1>
        {!general && step !== 'welcome' ? <ol className="onboarding-steps" aria-label="Setup progress">{[
          ['marketplace', 'Marketplace'], ['bundles', 'Bundle'], ['connections', 'Connect']
        ].map(([id, label], index) => <li key={id} aria-current={step === id ? 'step' : undefined}>{index + 1} · {label}</li>)}</ol> : null}
        {step === 'welcome' ? <>
          <p>We’ll help you find the tools for your work.</p>
          <section className="onboarding-card"><h2>{profile.question}</h2><p>Employees can connect the internal marketplace and install curated plugin bundles.</p>
            <div className="onboarding-actions"><button type="button" className="settings-btn" disabled={locked} onClick={() => choose('general')}>No, continue with general setup</button>
              <button type="button" className="settings-btn primary" disabled={locked} onClick={() => choose('organization')}>Yes, set up {profile.organization} tools <ArrowRight size={14} /></button></div>
          </section><p className="settings-help">You can change your choice or resume setup from Settings → Preferences.</p>
        </> : general ? <>
          <p>Choose a coding agent and discover public plugins. Your setup choice is saved.</p>
          <div className="onboarding-card"><h2>Start with the tools you need</h2><div className="onboarding-actions">
            <button type="button" className="settings-btn" onClick={() => { useOnboarding.setState({ open: false }); appNavigate('/settings/agents'); }}>Configure coding agents</button>
            <button type="button" className="settings-btn" onClick={() => { useOnboarding.setState({ open: false }); appNavigate(TOOLS_PLUGIN_BROWSE_ROUTE_PATH); }}>Browse plugins</button>
          </div></div>
        </> : step === 'marketplace' ? <section className="onboarding-card">
          <h2>{profile.organization} internal marketplace</h2><p>{profile.prerequisite}</p><code className="onboarding-source">{profile.marketplaceSource}</code>
          <p className="settings-help">We’ll check access and reuse an existing marketplace or add it if missing.</p>
          <button type="button" className="settings-btn primary" disabled={locked} onClick={connectMarketplace}>{busy ? <><Loader2 size={14} /> Checking access…</> : <><RefreshCw size={14} /> {error ? 'Retry access check' : 'Check access and continue'}</>}</button>
          {error ? <p className="settings-help">Check your corporate connection and Git sign-in, then retry. You can finish setup later.</p> : null}
        </section> : step === 'bundles' ? <>
          <p>Choose the plugins you need. You can add more later.</p>
          <PluginPacksCollection mode="browse" presentation="onboarding" onBusyChange={setBundleBusy} marketplaceSource={progress.marketplaceSource ?? profile.marketplaceSource}
            onReviewChange={setReviewOpen} onInstalled={installed} onOpenPlugin={(id, installation) => {
              void run(async () => {
                if (installation) await persist({ ...progress, step: 'connections', packId: installation.identity.packId,
                  pluginIds: installation.members.filter(member => member.selected && member.status === 'installed').map(member => member.pluginId) });
                openPlugin(id);
              });
            }} />
          <button type="button" className="settings-btn" disabled={locked} onClick={() => { void run(() => persist({ ...progress, step: 'marketplace' })); }}>Back to access check</button>
        </> : <>
          <p>Your selected plugins are installed. Open each plugin to finish its account sign-in or environment setup.</p>
          <div className="onboarding-card">
            {pluginsLoading ? <p role="status">Loading plugin status…</p> : (progress.pluginIds ?? []).map(id => {
              const plugin = plugins.find(row => row.id === id);
              return <div key={id} className="onboarding-plugin"><div><strong>{plugin?.name ?? id}</strong>
                <p className="settings-help">{plugin?.status === 'needs-configuration' ? 'Needs configuration' : plugin?.status === 'disabled' ? 'Disabled — enable in Plugins' : plugin?.status === 'degraded' ? 'Needs attention — open Plugins' : plugin ? 'Installed — review account and environment setup' : 'Unavailable — check Plugins'}</p></div>
                <button type="button" className="settings-btn" onClick={() => openPlugin(id)}>Open plugin settings</button></div>;
            })}
            {!pluginsLoading && !progress.pluginIds?.length ? <p>Manage your installed tools from Plugins.</p> : null}
          </div><p className="settings-help">Installing a plugin does not sign you in. Each plugin owns its connection checks and permissions.</p>
        </>}
        {error ? <p role="alert" className="modal-error">{error}</p> : null}
      </div>
      {step !== 'welcome' ? <footer className="onboarding-footer"><button type="button" className="settings-btn" disabled={locked} onClick={() => choose('undecided')}><ArrowLeft size={14} /> Change setup choice</button>
        {general || step === 'connections' ? <div className="onboarding-finish-actions">
          <button type="button" className={`settings-btn${general ? ' primary' : ''}`} disabled={busy || pluginsLoading} onClick={() => complete()}><CheckCircle2 size={14} /> {general ? 'Continue to Zana' : 'Done'}</button>
          {!general ? <button type="button" className="settings-btn primary" disabled={busy || pluginsLoading} onClick={() => complete(true)}>Open {profile.organization} tools <ArrowRight size={14} /></button> : null}
        </div> : null}
      </footer> : null}
    </div>
  </div>, document.body);
}
