/**
 * Client-side plugin slot registry.
 *
 * Registrations are replaced wholesale per plugin id — never appended — so a
 * reload cannot duplicate a sidebar row. Every registration carries a
 * generation that mount sites fold into the React key.
 */

import type {
  ComposerCustomization,
  PluginContentScriptRegistration,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginMessageActionRegistration,
  PluginCommandPaletteActionRegistration,
  PluginMessageDirectiveRegistration,
  PluginNavPanelRegistration,
  PluginNewThreadPanelActionRegistration,
  PluginPendingInteractionRegistration,
  PluginProjectTabRegistration,
  PluginProviderIconRegistration,
  PluginRegistrationSet,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionRegistration,
  PluginThreadHeaderActionRegistration,
  PluginThreadListRegistration,
  PluginThreadPanelActionRegistration,
  PluginTimelineRendererRegistration
} from '@zana-ai/zcc-plugin-sdk';
import { collectPluginApp, emptyRegistrationSet, isPluginAppDefinition } from '@zana-ai/zcc-plugin-sdk';

const sets = new Map<string, PluginRegistrationSet>();
const generations = new Map<string, number>();
const listeners = new Set<() => void>();

/**
 * `useSyncExternalStore` compares snapshots by reference. Keep each derived
 * slot list stable until a registration changes; rebuilding it in a getter
 * makes every render look like a store update and can recurse indefinitely.
 */
let snapshot = emptySnapshot();

function emptySnapshot() {
  return {
    sets: [] as PluginRegistrationSet[],
    navPanels: [] as PluginNavPanelRegistration[],
    homepageSections: [] as PluginHomepageSectionRegistration[],
    settingsSections: [] as PluginSettingsSectionRegistration[],
    projectTabs: [] as PluginProjectTabRegistration[],
    sidebarFooterActions: [] as PluginSidebarFooterActionRegistration[],
    pendingInteractions: [] as PluginPendingInteractionRegistration[],
    threadPanelActions: [] as PluginThreadPanelActionRegistration[],
    newThreadPanelActions: [] as PluginNewThreadPanelActionRegistration[],
    threadLists: [] as PluginThreadListRegistration[],
    threadHeaderActions: [] as PluginThreadHeaderActionRegistration[],
    fileOpeners: [] as PluginFileOpenerRegistration[],
    messageDirectives: [] as PluginMessageDirectiveRegistration[],
    messageActions: [] as PluginMessageActionRegistration[],
    timelineRenderers: [] as PluginTimelineRendererRegistration[],
    commandPaletteActions: [] as PluginCommandPaletteActionRegistration[],
    providerIcons: [] as PluginProviderIconRegistration[],
    composerCustomizations: [] as ComposerCustomization[],
    contentScripts: [] as PluginContentScriptRegistration[]
  };
}

function rebuildSnapshot(): void {
  const orderedSets = [...sets.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  snapshot = {
    sets: orderedSets,
    navPanels: orderedSets.flatMap((set) => set.navPanels),
    homepageSections: orderedSets.flatMap((set) => set.homepageSections),
    settingsSections: orderedSets.flatMap((set) => set.settingsSections),
    projectTabs: orderedSets.flatMap((set) => set.projectTabs),
    sidebarFooterActions: orderedSets.flatMap((set) => set.sidebarFooterActions),
    pendingInteractions: orderedSets.flatMap((set) => set.pendingInteractions),
    threadPanelActions: orderedSets.flatMap((set) => set.threadPanelActions),
    newThreadPanelActions: orderedSets.flatMap((set) => set.newThreadPanelActions),
    threadLists: orderedSets.flatMap((set) => set.threadLists),
    threadHeaderActions: orderedSets.flatMap((set) => set.threadHeaderActions),
    fileOpeners: orderedSets.flatMap((set) => set.fileOpeners),
    messageDirectives: orderedSets.flatMap((set) => set.messageDirectives),
    messageActions: orderedSets.flatMap((set) => set.messageActions),
    timelineRenderers: orderedSets.flatMap((set) => set.timelineRenderers),
    commandPaletteActions: orderedSets.flatMap((set) => set.commandPaletteActions),
    providerIcons: orderedSets.flatMap((set) => set.providerIcons),
    composerCustomizations: orderedSets.flatMap((set) => set.composerCustomizations),
    contentScripts: orderedSets.flatMap((set) => set.contentScripts)
  };
}

function bump(pluginId: string): number {
  const next = (generations.get(pluginId) ?? 0) + 1;
  generations.set(pluginId, next);
  return next;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribePluginSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function replacePluginSlots(pluginId: string, set: PluginRegistrationSet): void {
  sets.set(pluginId, set);
  rebuildSnapshot();
  emit();
}

export function clearPluginSlots(pluginId: string): void {
  if (!sets.delete(pluginId)) return;
  rebuildSnapshot();
  emit();
}

export function interpretPluginApp(pluginId: string, exported: unknown): PluginRegistrationSet {
  const generation = bump(pluginId);
  if (!isPluginAppDefinition(exported)) {
    const empty = emptyRegistrationSet(pluginId, generation);
    replacePluginSlots(pluginId, empty);
    return empty;
  }
  const set = collectPluginApp(pluginId, generation, exported);
  replacePluginSlots(pluginId, set);
  return set;
}

export function getPluginRegistrationSets(): PluginRegistrationSet[] {
  return snapshot.sets;
}

export function listNavPanels(): PluginNavPanelRegistration[] {
  return snapshot.navPanels;
}

export function listHomepageSections(): PluginHomepageSectionRegistration[] {
  return snapshot.homepageSections;
}

export function listSettingsSections(): PluginSettingsSectionRegistration[] {
  return snapshot.settingsSections;
}

export function listProjectTabs(): PluginProjectTabRegistration[] {
  return snapshot.projectTabs;
}

export function listSidebarFooterActions(): PluginSidebarFooterActionRegistration[] {
  return snapshot.sidebarFooterActions;
}

export function listPendingInteractionSlots(): PluginPendingInteractionRegistration[] {
  return snapshot.pendingInteractions;
}

export function listThreadPanelActions(): PluginThreadPanelActionRegistration[] {
  return snapshot.threadPanelActions;
}

export function listNewThreadPanelActions(): PluginNewThreadPanelActionRegistration[] {
  return snapshot.newThreadPanelActions;
}

export function listThreadLists(): PluginThreadListRegistration[] {
  return snapshot.threadLists;
}

export function listThreadHeaderActions(): PluginThreadHeaderActionRegistration[] {
  return snapshot.threadHeaderActions;
}

export function listFileOpeners(): PluginFileOpenerRegistration[] {
  return snapshot.fileOpeners;
}

export function listMessageDirectives(): PluginMessageDirectiveRegistration[] {
  return snapshot.messageDirectives;
}

export function listMessageActions(): PluginMessageActionRegistration[] {
  return snapshot.messageActions;
}

export function listTimelineRenderers(): PluginTimelineRendererRegistration[] {
  return snapshot.timelineRenderers;
}

export function listCommandPaletteActions(): PluginCommandPaletteActionRegistration[] {
  return snapshot.commandPaletteActions;
}

export function listProviderIcons(): PluginProviderIconRegistration[] {
  return snapshot.providerIcons;
}

export function listComposerCustomizations(): ComposerCustomization[] {
  return snapshot.composerCustomizations;
}

export function listContentScripts(): PluginContentScriptRegistration[] {
  return snapshot.contentScripts;
}

/**
 * `arrangePluginNavPanels`: never-ordered panels append in registry order;
 * stored keys that are not currently registered keep their slot so a slow load
 * does not shorten the user's saved order.
 */
export function arrangePluginNavPanels(
  panels: readonly PluginNavPanelRegistration[],
  storedOrder: readonly string[],
  hiddenKeys: ReadonlySet<string>
): { visible: PluginNavPanelRegistration[]; hidden: PluginNavPanelRegistration[]; normalizedOrder: string[] } {
  const keyOf = (panel: PluginNavPanelRegistration) => `${panel.pluginId}/${panel.path ?? panel.id}`;
  const byKey = new Map(panels.map((panel) => [keyOf(panel), panel]));
  const normalizedOrder = [...storedOrder];
  for (const panel of panels) {
    const key = keyOf(panel);
    if (!normalizedOrder.includes(key)) normalizedOrder.push(key);
  }
  const visible: PluginNavPanelRegistration[] = [];
  const hidden: PluginNavPanelRegistration[] = [];
  for (const key of normalizedOrder) {
    const panel = byKey.get(key);
    if (!panel) continue;
    if (hiddenKeys.has(key)) hidden.push(panel);
    else visible.push(panel);
  }
  return { visible, hidden, normalizedOrder };
}
