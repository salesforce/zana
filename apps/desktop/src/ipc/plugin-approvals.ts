import type { BrowserWindow } from 'electron';
import type { PluginApprovalSheetResult } from '@zana-ai/zcc-desktop-contract';
import {
  parsePluginApprovalRequest,
  parsePluginToolApprovalRequest,
  PLUGIN_APPROVAL_TTL_MS,
  signPluginApproval,
  type PluginApprovalResult
} from '@zana-ai/zcc-server/http/plugin-approval-proof';
import type { ApprovalSheetOutcome, ApprovalSheetView } from '../window/approval-sheet.js';

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;

export interface PluginApprovalDeps {
  /** The product server's UI signing secret; renderers never see it. */
  secret(): string;
  /** Main's own view of installed plugins, never the renderer's. */
  listApps(): Promise<ReadonlyArray<{ id: string; name: string; enabled: boolean; status: string }>>;
  showSheet(parent: BrowserWindow, view: ApprovalSheetView, timeoutMs?: number): Promise<ApprovalSheetOutcome>;
  /** Main resolves a local, visible thread to an existing registered desktop window. */
  resolveToolWindow?(threadId: string, projectId: string): Promise<ParentWindow | null>;
  now?(): number;
}

type ParentWindow = Pick<BrowserWindow, 'id' | 'isDestroyed'>;

/**
 * `pluginApprovals:request`. The renderer only proposes: main parses the
 * request, checks the plugin runs, draws the sheet, compares any typed text
 * itself, and signs the binding it showed. One sheet per window at a time.
 */
export function createPluginApprovalHandler(deps: PluginApprovalDeps) {
  const open = new Set<number>();
  const show = async (win: ParentWindow, raw: unknown, tool = false, timeoutMs?: number, validateScope?: () => Promise<boolean>): Promise<PluginApprovalResult> => {
    const pluginId = raw && typeof raw === 'object' ? (raw as { pluginId?: unknown }).pluginId : undefined;
    if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) return { approved: false, reason: 'invalid' };
    const parsed = parsePluginApprovalRequest(raw);
    if (!parsed.ok) return { approved: false, reason: 'invalid' };
    // Renderers may request only unscoped button approvals, never tool proofs.
    if (!tool && (parsed.value.binding.threadId !== undefined || parsed.value.binding.invocationId !== undefined)) return { approved: false, reason: 'invalid' };
    const secret = deps.secret();
    if (secret.length < 32) return { approved: false, reason: 'unavailable' };
    if (open.has(win.id)) return { approved: false, reason: 'busy' };
    open.add(win.id);
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + (timeoutMs ?? PLUGIN_APPROVAL_TTL_MS);
    try {
      const work = async (): Promise<PluginApprovalResult> => {
        const app = (await deps.listApps()).find((row) => row.id === pluginId);
        if (expired || Date.now() >= deadline) return { approved: false, reason: 'timeout' };
        if (!app || !app.enabled || app.status !== 'running') return { approved: false, reason: 'invalid' };
        const view = { pluginName: app.name, request: parsed.value };
        const remaining = deadline - Date.now();
        const outcome = timeoutMs === undefined ? await deps.showSheet(win as BrowserWindow, view) : await deps.showSheet(win as BrowserWindow, view, remaining);
        if (expired || Date.now() >= deadline) return { approved: false, reason: 'timeout' };
        if (outcome.kind !== 'approved' || win.isDestroyed()) return { approved: false, reason: 'cancelled' };
        const expected = parsed.value.binding.confirmText;
        if (expected && outcome.typed !== expected) return { approved: false, reason: 'cancelled' };
        if (validateScope) {
          if (!(await validateScope()) || win.isDestroyed()) return { approved: false, reason: 'unavailable' };
          const currentApp = (await deps.listApps()).find(row => row.id === pluginId);
          if (!currentApp?.enabled || currentApp.status !== 'running') return { approved: false, reason: 'invalid' };
          if (expired || Date.now() >= deadline) return { approved: false, reason: 'timeout' };
        }
        const now = deps.now?.() ?? Date.now();
        return { approved: true, token: signPluginApproval(secret, pluginId, parsed.value.binding, now), expiresAt: now + PLUGIN_APPROVAL_TTL_MS };
      };
      return await Promise.race([work(), new Promise<PluginApprovalResult>(resolve => {
        timer = setTimeout(() => { expired = true; resolve({ approved: false, reason: 'timeout' }); }, timeoutMs ?? PLUGIN_APPROVAL_TTL_MS);
      })]);
    } finally {
      clearTimeout(timer);
      open.delete(win.id);
    }
  };
  const handler = (win: ParentWindow, raw: unknown): Promise<PluginApprovalSheetResult> => show(win, raw) as Promise<PluginApprovalSheetResult>;
  handler.requestToolApproval = async (raw: unknown): Promise<PluginApprovalResult> => {
    const parsed = parsePluginToolApprovalRequest(raw);
    const projectId = raw && typeof raw === 'object' ? (raw as { projectId?: unknown }).projectId : undefined;
    if (!parsed.ok || typeof projectId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(projectId)) return { approved: false, reason: 'invalid' };
    const timeoutMs = parsed.value.timeoutMs!;
    const started = deps.now?.() ?? Date.now();
    return new Promise(resolve => {
      let settled = false;
      const finish = (result: PluginApprovalResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ approved: false, reason: 'timeout' }), timeoutMs);
      void Promise.resolve().then(async () => {
        const win = await deps.resolveToolWindow?.(parsed.value.threadId!, projectId);
        if (settled) return;
        if (!win || win.isDestroyed()) { finish({ approved: false, reason: 'unavailable' }); return; }
        const remaining = timeoutMs - ((deps.now?.() ?? Date.now()) - started);
        if (remaining <= 0) { finish({ approved: false, reason: 'timeout' }); return; }
        finish(await show(win, { ...(raw as object), ...parsed.value }, true, remaining, async () => {
          const current = await deps.resolveToolWindow?.(parsed.value.threadId!, projectId);
          return !settled && Boolean(current && !current.isDestroyed() && current.id === win.id);
        }));
      }).catch(() => finish({ approved: false, reason: 'unavailable' }));
    });
  };
  return handler;
}
