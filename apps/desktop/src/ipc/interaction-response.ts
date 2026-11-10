import type { BrowserWindow } from 'electron';
import { parsePluginApprovalRequest } from '@zana-ai/zcc-server/http/plugin-approval-proof';
import { createInteractionResponder, NativeSheetRequiredError } from '../interaction-proof.js';
import type { ApprovalSheetOutcome, ApprovalSheetView } from '../window/approval-sheet.js';

export const INTERACTION_RESPONSE_CHANNEL = 'interactions:respond';

export interface InteractionSheetDeps {
  /** Main's own view of installed plugins, never the renderer's. */
  listApps(): Promise<ReadonlyArray<{ id: string; name: string; enabled: boolean; status: string }>>;
  showSheet(parent: BrowserWindow, view: ApprovalSheetView): Promise<ApprovalSheetOutcome>;
}

/** What the sheet says the person is submitting: bounded, one line, never trusted markup. */
function responsePreview(value: unknown): string {
  let text: string;
  try { text = JSON.stringify(value) ?? 'null'; } catch { text = '[unprintable]'; }
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * A plugin asked for `requireHuman: 'native-sheet'`. The renderer cannot supply
 * that, so main draws the confirmation itself and signs the retry with a
 * `sheet:` source. Anything short of an explicit approve fails closed.
 */
async function confirmOnSheet(
  win: BrowserWindow, input: unknown, needed: NativeSheetRequiredError, sheet: InteractionSheetDeps
): Promise<boolean> {
  const app = (await sheet.listApps()).find(row => row.id === needed.pluginId);
  if (!app || !app.enabled || app.status !== 'running' || win.isDestroyed()) return false;
  const owner = input as { threadId?: unknown; interactionId?: unknown; value?: unknown };
  const parsed = parsePluginApprovalRequest({
    title: needed.title,
    summary: `${app.name} needs your confirmation before it continues.`,
    details: [`Response: ${responsePreview(owner.value)}`],
    confirmLabel: 'Submit',
    binding: {
      action: 'interaction.respond',
      target: String(owner.interactionId ?? ''),
      targetLabel: needed.title,
      subject: typeof owner.threadId === 'string' ? 'Thread interaction' : 'Terminal interaction'
    }
  });
  if (!parsed.ok) return false;
  const outcome = await sheet.showSheet(win, { pluginName: app.name, request: parsed.value });
  return outcome.kind === 'approved' && !win.isDestroyed();
}

export function registerInteractionResponseIpc(
  register: (channel: string, handler: (win: BrowserWindow, input: unknown) => Promise<unknown>, onError: (error: unknown) => never) => void,
  respond: ReturnType<typeof createInteractionResponder>,
  sheet?: InteractionSheetDeps
) {
  // The shared registrar verifies the sender frame belongs to a live app window.
  register(INTERACTION_RESPONSE_CHANNEL, async (win, input) => {
    if (win.isDestroyed()) throw new Error('Interaction window closed');
    try {
      return await respond(input, 'human', `window:${win.id}`);
    } catch (error) {
      if (!(error instanceof NativeSheetRequiredError)) throw error;
      if (!sheet || !(await confirmOnSheet(win, input, error, sheet))) {
        throw new Error('Confirmation required on the Zana approval sheet');
      }
      return respond(input, 'human', `sheet:${win.id}`);
    }
  }, error => { throw error; });
}
