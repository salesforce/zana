/**
 * Thread-scoped automation for the visible local WebContentsView.
 *
 * Per-id hashed cookie partitions (`hashedAutomationPartition`) isolate agent
 * jars. Personal in-app tabs stay on persist:zcc-browser.
 */

import { createHash } from 'node:crypto';

export interface AutomationTargetRow {
  targetId: string;
  tabId: string;
  url: string;
  title: string | null;
}

/** Prefix for hashed agent cookie jars. Personal in-app tabs stay on persist:zcc-browser. */
export const ZCC_BROWSER_AUTOMATION_PARTITION = 'persist:zcc-browser-automation';

export function hashedAutomationPartition(id: string): string {
  return `${ZCC_BROWSER_AUTOMATION_PARTITION}-${createHash('sha256').update(id).digest('hex')}`;
}

export const HIDDEN_AUTOMATION_VIEW_BOUNDS = { x: 0, y: 0, width: 1280, height: 720 };

const pendingAutomationTabIds = new Set<string>();

export function rememberPendingAutomationTab(tabId: string): void {
  if (tabId.length === 0) return;
  pendingAutomationTabIds.add(tabId);
}

export function forgetPendingAutomationTab(tabId: string): void {
  pendingAutomationTabIds.delete(tabId);
}

export function isPendingAutomationTab(tabId: string): boolean {
  return tabId.length > 0 && pendingAutomationTabIds.has(tabId);
}

export function partitionForBrowserTab(
  tabIsAutomation: boolean,
  personalPartition = 'persist:zcc-browser',
  automationId = 'shared'
): string {
  return tabIsAutomation ? hashedAutomationPartition(automationId) : personalPartition;
}

export function shouldBroadcastAutomationOpen(visible: boolean): boolean {
  return visible !== false;
}

export function pickLiveBrowserWindow<
  T extends { isDestroyed(): boolean; isFocused(): boolean; webContents: { isDestroyed(): boolean } }
>(windows: readonly T[]): T | null {
  const live = windows.filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed());
  return live.find((win) => win.isFocused()) ?? live[0] ?? null;
}

export function browserPartitionForThread(threadId: string): string {
  const safe = threadId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'thread';
  return `persist:zcc-browser-${safe}`;
}

export function filterAutomationTargetsForThread(
  targets: readonly AutomationTargetRow[],
  threadByTarget: ReadonlyMap<string, string>,
  threadId: string | undefined
): AutomationTargetRow[] {
  if (!threadId) return [...targets];
  return targets.filter((row) => threadByTarget.get(row.targetId) === threadId);
}

export function assertAutomationTargetThread(
  targetId: string,
  threadByTarget: ReadonlyMap<string, string>,
  threadId: string | undefined
): void {
  if (!threadId) return;
  if (threadByTarget.get(targetId) !== threadId) {
    throw new Error('unknown automation target');
  }
}
