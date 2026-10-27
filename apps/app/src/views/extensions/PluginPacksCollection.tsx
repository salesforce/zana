import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginPackCatalogEntry, PluginPackIdentity, PluginPackInstallation, PluginPackPlan } from '@zana-ai/zcc-domain';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { appNavigate } from '../../lib/app-navigate.js';
import { getPluginDetailRoutePath } from '../../lib/route-paths.js';
import { PluginPackCards, PluginPackForgetConfirm, PluginPackReview, type PluginPackCardModel, type PluginPackMemberResultModel, type PluginPackReviewModel } from './PluginPacks.js';

const identityKey = (identity: PluginPackIdentity) => JSON.stringify([identity.marketplaceSource, identity.packId]);
const planFingerprint = (plan: PluginPackPlan) => JSON.stringify([plan.displayName, plan.description, plan.members.map((member) => [member.pluginId, member.displayName, member.description, member.required, member.sourceLabel, member.targetVersion])]);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const memberResults = (installation: PluginPackInstallation): PluginPackMemberResultModel[] => installation.members.map((member) => ({ id: member.pluginId, status: member.status, error: member.error }));
const INSTALL_PROGRESS_INTERVAL_MS = 750;

/** A marketplace pack is a visible installation flow, never a hidden plugin dependency. */
export function PluginPacksCollection({ mode, query = '', catalogRevision }: { mode: 'browse' | 'installed'; query?: string; catalogRevision?: number }) {
  const [catalog, setCatalog] = useState<PluginPackCatalogEntry[]>([]);
  const [installations, setInstallations] = useState<PluginPackInstallation[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<Set<string> | null>(null);
  const [knownPlugins, setKnownPlugins] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [review, setReview] = useState<{ plan: PluginPackPlan; model: PluginPackReviewModel } | null>(null);
  const [results, setResults] = useState<PluginPackMemberResultModel[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [installBlocked, setInstallBlocked] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [forget, setForget] = useState<PluginPackCardModel | null>(null);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const identities = useRef(new Map<string, PluginPackIdentity>());
  const stopProgress = useRef<(() => void) | null>(null);
  const api = product.pluginPacks;
  const supported = hasDesktopBridge() && !!api;

  const refresh = useCallback(async () => {
    if (!supported) return;
    const generation = ++request.current;
    try {
      const [rows, saved, plugins] = await Promise.all([
        api.list(), api.listInstalled(), product.extensions.marketplaceList()
      ]);
      if (!mounted.current || generation !== request.current) return;
      setCatalog(rows);
      setInstallations(saved);
      if (plugins.ok) {
        setInstalledPlugins(new Set(plugins.value.filter((plugin) => plugin.installed).map((plugin) => plugin.id)));
        setKnownPlugins(new Map(plugins.value.map((plugin) => [plugin.id, plugin.title])));
      }
      setError(null);
    } catch (error) {
      if (mounted.current && generation === request.current) setError(message(error));
    }
  }, [api, supported]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const off = supported ? product.extensions.onChanged(() => { void refresh(); }) : () => {};
    const offApps = supported ? product.pluginApps?.onChanged?.(() => { void refresh(); }) : undefined;
    return () => { mounted.current = false; request.current += 1; off(); offApps?.(); };
  }, [refresh, supported, catalogRevision]);

  useEffect(() => () => { stopProgress.current?.(); }, [api, supported]);

  if (!supported) return null;

  const savedByKey = new Map(installations.map((installation) => [identityKey(installation.identity), installation]));
  const catalogByKey = new Map(catalog.map((row) => [identityKey(row.identity), row]));
  identities.current.clear();
  const cards: PluginPackCardModel[] = (mode === 'browse' ? catalog : installations).map((row) => {
    const identity = row.identity;
    const key = identityKey(identity);
    identities.current.set(key, identity);
    const entry = catalogByKey.get(key);
    const saved = savedByKey.get(key);
    const members = 'pack' in row ? row.pack.members : row.members.filter((member) => member.selected);
    return {
      key, id: identity.packId,
      title: 'pack' in row ? row.pack.displayName : row.displayName,
      description: 'pack' in row ? row.pack.description : row.description,
      marketplace: entry?.marketplaceDisplayName ?? 'Marketplace',
      memberNames: members.map((member) => saved?.members.find((savedMember) => savedMember.pluginId === member.pluginId)?.displayName ?? knownPlugins.get(member.pluginId) ?? member.pluginId),
      installedCount: installedPlugins && members.every((member) => knownPlugins.has(member.pluginId)) ? members.filter((member) => installedPlugins.has(member.pluginId)).length : undefined,
      memberCount: members.length,
      remembered: !!saved
    };
  }).filter((card) => !query.trim() || `${card.title} ${card.description ?? ''} ${card.memberNames.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const openReview = async (card: PluginPackCardModel) => {
    const identity = identities.current.get(card.key);
    if (!identity || loadingKey !== null) return;
    const saved = savedByKey.get(card.key);
    setLoadingKey(card.key); setError(null); setReviewError(null); setResults(undefined); setInstallBlocked(false);
    try {
      const plan = await api.plan(identity);
      if (!mounted.current) return;
      setReview({ plan, model: {
        pack: card,
        members: plan.members.map((member) => ({
          id: member.pluginId, title: member.displayName, description: member.description,
          source: (member.status === 'installed' ? member.installedSource ?? member.sourceLabel : member.sourceLabel) ?? 'Source unavailable',
          version: member.status === 'installed' ? member.installedVersion : member.targetVersion,
          optional: !member.required, installed: member.status === 'installed', available: member.status !== 'unavailable', error: member.status === 'unavailable' ? member.reason : undefined, note: member.status === 'installed' ? member.reason : undefined,
          defaultSelected: saved ? saved.members.some((previous) => previous.pluginId === member.pluginId && previous.selected) : undefined
        }))
      } });
    } catch (error) { if (mounted.current) setError(message(error)); }
    finally { if (mounted.current) setLoadingKey(null); }
  };

  const install = async (pluginIds: string[]) => {
    if (!review || busy || stopProgress.current) return;
    setBusy(true); setReviewError(null);
    setResults(review.plan.members.map((member) => ({
      id: member.pluginId,
      status: pluginIds.includes(member.pluginId) ? member.status === 'installed' ? 'installed' : 'pending' : 'skipped'
    })));
    const key = identityKey(review.plan.identity);
    const previous = installations.find((installation) => identityKey(installation.identity) === key);
    let stopped = false;
    let installationReceived = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (stopProgress.current === stop) stopProgress.current = null;
    };
    stopProgress.current = stop;
    const poll = async () => {
      if (stopped || !mounted.current) return;
      try {
        const saved = await api.listInstalled();
        if (stopped || !mounted.current) return;
        const current = saved.find((installation) => identityKey(installation.identity) === key);
        if (current && JSON.stringify(current) !== JSON.stringify(previous)) setResults(memberResults(current));
      } catch {
        // Installation is authoritative; a transient progress read must not fail it.
      } finally {
        if (!stopped && mounted.current) timer = setTimeout(() => { void poll(); }, INSTALL_PROGRESS_INTERVAL_MS);
      }
    };
    timer = setTimeout(() => { void poll(); }, INSTALL_PROGRESS_INTERVAL_MS);
    try {
      const installation = await api.install({ identity: review.plan.identity, planId: review.plan.planId, pluginIds });
      installationReceived = true;
      stop();
      if (!mounted.current) return;
      setResults(memberResults(installation));
      void refresh();
      if (installation.members.some((member) => member.status === 'failed')) {
        setInstallBlocked(true);
        const plan = await api.plan(review.plan.identity);
        if (!mounted.current) return;
        if (planFingerprint(plan) !== planFingerprint(review.plan)) {
          setReview({ plan, model: { pack: review.model.pack, members: plan.members.map((member) => ({
            id: member.pluginId, title: member.displayName, description: member.description,
            source: (member.status === 'installed' ? member.installedSource ?? member.sourceLabel : member.sourceLabel) ?? 'Source unavailable',
            version: member.status === 'installed' ? member.installedVersion : member.targetVersion,
            optional: !member.required, installed: member.status === 'installed', available: member.status !== 'unavailable', error: member.status === 'unavailable' ? member.reason : undefined, note: member.status === 'installed' ? member.reason : undefined,
            defaultSelected: pluginIds.includes(member.pluginId)
          })) } });
          setResults(undefined);
          setReviewError('This pack changed. Review its members and sources before installing again.');
        } else setReview((current) => current ? { ...current, plan } : current);
        setInstallBlocked(false);
      }
    } catch (error) { if (mounted.current) { if (!installationReceived) setResults(undefined); setInstallBlocked(true); setReviewError(`${message(error)} Close this review and open the pack again to retry.`); } }
    finally { stop(); if (mounted.current) setBusy(false); }
  };

  const forgetPack = async () => {
    if (!forget || busy) return;
    const identity = identities.current.get(forget.key);
    if (!identity) return;
    setBusy(true); setForgetError(null);
    try {
      await api.forget(identity);
      if (!mounted.current) return;
      setForget(null); void refresh();
    } catch (error) { if (mounted.current) setForgetError(message(error)); }
    finally { if (mounted.current) setBusy(false); }
  };

  return <>
    <PluginPackCards packs={cards} mode={mode} onReview={(card) => { void openReview(card); }} onForget={(card) => { setForgetError(null); setForget(card); }} />
    {loadingKey ? <p role="status" className="settings-help">Loading plugin pack…</p> : null}
    {error ? <p role="alert" className="modal-error">Plugin packs: {error}</p> : null}
    {review ? <PluginPackReview key={`${review.model.pack.key}:${planFingerprint(review.plan)}`} review={review.model} busy={busy} installBlocked={installBlocked} error={reviewError} results={results} onClose={() => setReview(null)} onInstall={(ids) => { void install(ids); }} onOpenPlugin={(id) => {
      setReview(null); appNavigate(getPluginDetailRoutePath(id, { view: 'installed' }));
    }} /> : null}
    {forget ? <PluginPackForgetConfirm pack={forget} busy={busy} error={forgetError} onClose={() => setForget(null)} onForget={() => { void forgetPack(); }} /> : null}
  </>;
}
