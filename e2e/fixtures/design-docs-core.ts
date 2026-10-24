import { expect } from '@playwright/test';
import type { AppHandle } from './app.js';
import { answerApprovalSheet, pairComputers } from './core-peer-use.js';
import type { PeerApp } from './peer-apps.js';

export const USE_SHEET = 'Allow a plugin to use a connection';

export type Member = { machineId: string; replicaId: string; authorized: boolean; connected?: boolean };
export type GroupStatus = {
  configured: boolean; replicaId: string; members: Member[]; lifecycleAvailable?: boolean;
  enrolled: Array<{ id: string; name: string; connected: boolean }>;
};
export type DdConnection = {
  computerId: string; hostname: string; state: 'connected' | 'reconnecting' | 'disconnected' | 'removing';
  usedByThisPlugin: boolean; use?: string; [key: string]: unknown;
};

export const ddRpc = <T,>(app: AppHandle, method: string, args?: unknown): Promise<T> => app.window.evaluate(
  ({ method, args }) => window.cc.pluginApps.callRpc('design-docs', method, args), { method, args }) as Promise<T>;
export const ddGroup = (app: AppHandle) => ddRpc<GroupStatus>(app, 'groupStatus');
export const ddConnections = (app: AppHandle) => ddRpc<DdConnection[]>(app, 'connections');

/** Installs the bundled Design Docs plugin and waits until its peer lifecycle answers. */
export async function installDesignDocs(app: AppHandle): Promise<void> {
  expect(await app.window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
  const trust = app.window.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => app.window.evaluate(async () =>
    (await window.cc.pluginApps.list()).find(plugin => plugin.id === 'design-docs')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  await expect.poll(() => ddGroup(app).then(status => status.lifecycleAvailable, () => null), { timeout: 30_000 }).toBe(true);
}

/** Design Docs -> Settings -> Peers panel (the plugin's own computer list). */
export async function openDesignDocsPeers(app: AppHandle) {
  const window = app.window;
  if (!await window.locator('.dd-peers-view').isVisible().catch(() => false)) {
    // Core Settings replaces the rail; leave it first.
    await window.evaluate(() => {
      window.history.pushState({}, '', '/inbox');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await window.getByRole('button', { name: 'Design Docs', exact: true }).click();
    await window.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  }
  const region = window.locator('.dd-peers-view').getByRole('region', { name: 'Database sync peers' });
  await expect(region).toBeVisible({ timeout: 30_000 });
  return region;
}

/** The single computer `app` has linked, once core reports it connected. */
export async function connectedComputer(app: AppHandle): Promise<DdConnection> {
  let found: DdConnection | undefined;
  await expect.poll(async () => { found = (await ddConnections(app))[0]; return found?.state; }, { timeout: 60_000 }).toBe('connected');
  return found!;
}

/** The connection `app` has that is not in `known` (a freshly paired computer), once core reports it connected. */
export async function newComputer(app: AppHandle, known: string[]): Promise<DdConnection> {
  let found: DdConnection | undefined;
  await expect.poll(async () => { found = (await ddConnections(app)).find(c => !known.includes(c.computerId)); return found?.state; }, { timeout: 60_000 }).toBe('connected');
  return found!;
}

/** Design Docs on `requester` asks to use the connection; both owners approve their main-process sheet. */
export async function useDesignDocsOnBothSides(requester: PeerApp, other: PeerApp, target?: DdConnection): Promise<string[]> {
  target ??= await connectedComputer(requester);
  const asked = await ddRpc<{ status: string }>(requester, 'useConnection', { computerId: target.computerId });
  expect(asked.status).toBe('pending');
  const texts = await Promise.all([answerApprovalSheet(requester, USE_SHEET), answerApprovalSheet(other, USE_SHEET)]);
  await expect.poll(async () => (await ddConnections(requester)).find(c => c.computerId === target.computerId)?.usedByThisPlugin, { timeout: 90_000 }).toBe(true);
  await expect.poll(async () => (await ddConnections(other)).some(c => c.usedByThisPlugin), { timeout: 90_000 }).toBe(true);
  return texts;
}

/** Pair through the core UI, approve Design Docs' use on both computers, wait until the sync group has both members. */
export async function connectDesignDocs(inviter: PeerApp, redeemer: PeerApp): Promise<void> {
  await pairComputers(inviter, redeemer);
  await useDesignDocsOnBothSides(inviter, redeemer);
  await expect.poll(async () => `${(await ddGroup(inviter)).members.length},${(await ddGroup(redeemer)).members.length}`, { timeout: 120_000 }).toBe('2,2');
}

/** Trigger sync from both sides until `reader` lists `docId`. */
export async function syncUntilListed(writer: AppHandle, reader: AppHandle, docId: string): Promise<void> {
  await expect.poll(async () => {
    await ddRpc(writer, 'syncNow').catch(() => {}); await ddRpc(reader, 'syncNow').catch(() => {});
    return (await ddRpc<Array<{ id: string }>>(reader, 'list')).some(doc => doc.id === docId);
  }, { timeout: 90_000 }).toBe(true);
}
