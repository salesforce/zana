import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { CcApi } from '../../packages/desktop-contract/src/cc-api.js';
import type { AppHandle } from './app.js';
import { openCorePeers, type PeerApp } from './peer-apps.js';

export const PROBE_ID = 'peer-use-probe';
export const PROBE_NAME = 'Peer Use Probe';

export interface ProbeConnection { computerId: string; hostname: string; state: string; usedByThisPlugin: boolean }

/** Writes a path plugin that exercises `sdk.peers.connections`; the hook mode is switched over RPC. */
export function writeProbePlugin(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: PROBE_ID, version: '0.1.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: PROBE_NAME, description: 'Disposable core-connection use probe', branding: { icon: 'Puzzle' }, server: './server.mjs', app: './app.js' }
  }));
  writeFileSync(join(dir, 'server.mjs'), `export default api => {
    const peers = api.sdk.peers;
    const removing = [];
    let hookMode = 'ok';
    peers.handle('echo', async request => ({ text: request.body.text }));
    peers.connections.onConnectionRemoving(async computerId => {
      removing.push(computerId);
      if (hookMode === 'fail') throw new Error('cleanup refused');
      if (hookMode === 'hang') await new Promise(() => {});
    });
    api.rpc.method('connections', () => peers.connections.list());
    api.rpc.method('requestUse', args => peers.connections.requestUse(args.computerId));
    api.rpc.method('stopUsing', args => peers.connections.stopUsing(args.computerId));
    api.rpc.method('hookMode', args => { hookMode = args.mode; return hookMode; });
    api.rpc.method('enrolled', () => peers.enrolled());
    api.rpc.method('enable', args => peers.enable(args.peerId, { scope: args.scope }));
    api.rpc.method('removing', () => removing.slice());
    api.rpc.method('echo', args => peers.call(args.computerId, 'echo', { text: args.text }, { scope: 'connection', timeoutMs: 10000 }));
  };`);
  writeFileSync(join(dir, 'app.js'), `const React = globalThis.__ZCC_HOST_REACT__;
    function Panel() { return React.createElement('section', null, React.createElement('h2', null, ${JSON.stringify(PROBE_NAME)})); }
    export default { __zccPluginApp: true, setup(app) { app.slots.navPanel({ id: 'main', title: ${JSON.stringify(PROBE_NAME)}, icon: 'Puzzle', component: Panel }); } };`);
}

/** Seeds the probe plugin as an installed, enabled path plugin in `isolatedHome` (use as `prelaunch`). */
export function installProbePlugin(isolatedHome: string, source: string): void {
  const store = join(isolatedHome, '.zcc', 'plugins');
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: PROBE_ID, version: '0.1.0', name: PROBE_NAME, enabled: true, status: 'running', provenance: 'direct',
    sourceKind: 'path', source: `path:${source}`, rootDir: source, serverEntry: './server.mjs', appEntry: './app.js',
    installedAt: Date.now(), updatedAt: Date.now()
  }] }));
}

export function probeRpc<T>(app: AppHandle, method: string, args?: unknown): Promise<T> {
  return app.window.evaluate(
    ({ id, method, args }) => (window as unknown as { cc: CcApi }).cc.pluginApps.callRpc(id, method, args),
    { id: PROBE_ID, method, args }
  ) as Promise<T>;
}

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Core pairing end to end: `inviter` (must have the private sshd endpoint) invites, `redeemer` joins, inviter approves. */
export async function pairComputers(inviter: PeerApp, redeemer: PeerApp, rows: { inviter: number; redeemer: number } = { inviter: 1, redeemer: 1 }): Promise<void> {
  const { window } = await openCorePeers(inviter);
  await window.getByRole('button', { name: 'Add computer', exact: true }).click();
  const add = window.getByTestId('add-computer');
  const token = add.getByRole('textbox', { name: 'Invitation', exact: true });
  await expect(token).toHaveValue(/^zccinv1\./, { timeout: 60_000 });
  const invitation = await token.inputValue();
  // The join panel now takes both the invitation and the spoken approval code the inviter shows.
  const approvalCode = (await add.getByTestId('approval-code').locator('strong').innerText()).trim();

  const joiner = (await openCorePeers(redeemer)).window;
  await joiner.getByRole('button', { name: 'Join computer', exact: true }).click();
  const join = joiner.getByTestId('join-computer');
  await join.getByRole('textbox', { name: 'Invitation', exact: true }).fill(invitation);
  await join.getByRole('textbox', { name: 'Approval code', exact: true }).fill(approvalCode);
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  const shown = join.getByTestId('pairing-code');
  await expect(shown).toHaveText(CODE, { timeout: 90_000 });
  const code = (await shown.innerText()).trim();

  const approve = window.getByTestId('peer-approve');
  await expect(approve).toBeVisible({ timeout: 90_000 });
  await approve.getByRole('textbox').fill(code);
  await approve.getByRole('button', { name: 'Approve', exact: true }).click();
  for (const [app, count] of [[inviter, rows.inviter], [redeemer, rows.redeemer]] as const) {
    const row = app.window.getByTestId('peer-computer');
    await expect(row).toHaveCount(count, { timeout: 120_000 });
    await expect(row.filter({ hasText: 'Linked' })).toHaveCount(count, { timeout: 120_000 });
  }
}

/** Answers the pending main-process "Zana approval" sheet on `app`: waits for `title`, then clicks Approve (or Cancel). */
export async function answerApprovalSheet(app: AppHandle, title: string, decision: 'approve' | 'deny' = 'approve'): Promise<string> {
  const sheet = <T,>(script: string) => app.electron.evaluate(async ({ BrowserWindow }, script) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === 'Zana approval' &&
      !w.webContents.getTitle().startsWith('approve:') && w.webContents.getTitle() !== 'cancel');
    return win ? await win.webContents.executeJavaScript(script) as T : null;
  }, script);
  await expect.poll(() => sheet<string>('document.body.innerText'), { timeout: 60_000 }).toContain(title);
  const text = (await sheet<string>('document.body.innerText'))!;
  const id = decision === 'approve' ? 'approve' : 'cancel';
  await expect.poll(() => sheet<boolean>(`(() => { const button = document.getElementById(${JSON.stringify(id)}); if (button && !button.disabled) setTimeout(() => button.click(), 0); return true; })()`), { timeout: 15_000 }).toBeNull();
  return text;
}

/** Leaves and reopens Settings → Peers so its link list reloads (the view loads on mount). */
export async function reopenCorePeers(app: AppHandle) {
  await app.window.evaluate(() => {
    window.history.pushState({}, '', '/inbox');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  return openCorePeers(app);
}
