import type { BrowserWindow } from 'electron';
import type { PluginApprovalSheetResult } from '@zana-ai/zcc-desktop-contract';
import {
  parsePluginApprovalRequest,
  PLUGIN_APPROVAL_TTL_MS,
  signPluginApproval
} from '@zana-ai/zcc-server/http/plugin-approval-proof';
import type { ApprovalSheetOutcome, ApprovalSheetView } from '../window/approval-sheet.js';

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;

export interface PluginApprovalDeps {
  /** The product server's UI signing secret; renderers never see it. */
  secret(): string;
  /** Main's own view of installed plugins, never the renderer's. */
  listApps(): Promise<ReadonlyArray<{ id: string; name: string; enabled: boolean; status: string }>>;
  showSheet(parent: BrowserWindow, view: ApprovalSheetView): Promise<ApprovalSheetOutcome>;
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
  return async (win: ParentWindow, raw: unknown): Promise<PluginApprovalSheetResult> => {
    const pluginId = raw && typeof raw === 'object' ? (raw as { pluginId?: unknown }).pluginId : undefined;
    if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) return { approved: false, reason: 'invalid' };
    const parsed = parsePluginApprovalRequest(raw);
    if (!parsed.ok) return { approved: false, reason: 'invalid' };
    const secret = deps.secret();
    if (secret.length < 32) return { approved: false, reason: 'unavailable' };
    if (open.has(win.id)) return { approved: false, reason: 'busy' };
    open.add(win.id);
    try {
      const app = (await deps.listApps()).find((row) => row.id === pluginId);
      if (!app || !app.enabled || app.status === 'disabled') return { approved: false, reason: 'invalid' };
      const outcome = await deps.showSheet(win as BrowserWindow, { pluginName: app.name, request: parsed.value });
      if (outcome.kind !== 'approved' || win.isDestroyed()) return { approved: false, reason: 'cancelled' };
      const expected = parsed.value.binding.confirmText;
      if (expected && outcome.typed !== expected) return { approved: false, reason: 'cancelled' };
      const now = deps.now?.() ?? Date.now();
      return {
        approved: true,
        token: signPluginApproval(secret, pluginId, parsed.value.binding, now),
        expiresAt: now + PLUGIN_APPROVAL_TTL_MS
      };
    } finally {
      open.delete(win.id);
    }
  };
}
