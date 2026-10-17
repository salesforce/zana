import { randomBytes } from 'node:crypto';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { PluginApprovalRequest } from '@zana-ai/zcc-server/http/plugin-approval-proof';

/**
 * The approval sheet main draws for a plugin's own button (Publish, Activate).
 * It is its own sandboxed window with no preload, and main writes every byte
 * of its markup, so no renderer or plugin code can click it or change what it
 * says. The page answers by setting its document title, which main reads from
 * `page-title-updated`. Chromium blocks a data: page from navigating its top
 * frame, even to its own hash, so a URL answer never arrives.
 */
export const APPROVAL_SHEET_TITLE = 'Zana approval';
const SHEET_WIDTH = 480;
/** The sheet closes itself after this, before the token window would matter. */
export const APPROVAL_SHEET_TIMEOUT_MS = 5 * 60_000;
/** Approve stays off this long after the sheet gains focus. */
export const ARM_DELAY_MS = 500;

export interface ApprovalSheetView {
  /** The requesting plugin's display name, from main's own plugin list. */
  pluginName: string;
  request: PluginApprovalRequest;
}

export type ApprovalSheetOutcome = { kind: 'approved'; typed: string } | { kind: 'cancelled' };

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** A long revision (a SHA) shows its first 12 characters; the full value is the tooltip. */
function revisionCell(revision: string): string {
  const short = revision.length > 12 ? `${revision.slice(0, 12)}…` : revision;
  return `<code title="${escapeHtml(revision)}">${escapeHtml(short)}</code>`;
}

export function approvalSheetHtml(view: ApprovalSheetView, nonce: string): string {
  const { request } = view;
  const { binding } = request;
  const danger = request.tone === 'danger';
  const rows: Array<[string, string]> = [
    ['Action', `<code>${escapeHtml(binding.action)}</code>`],
    ['Target', escapeHtml(binding.targetLabel)],
    ['Applies to', escapeHtml(binding.subject)]
  ];
  if (binding.revision) rows.push(['Revision', revisionCell(binding.revision)]);
  const details = request.details?.length
    ? `<ul class="details">${request.details.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : '';
  const typed = binding.confirmText
    ? `<label class="typed" for="typed">Type <code>${escapeHtml(binding.confirmText)}</code> to approve</label>
<input id="typed" autocomplete="off" spellcheck="false" autofocus>`
    : '';
  const expected = JSON.stringify(binding.confirmText ?? '').replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>${APPROVAL_SHEET_TITLE}</title>
<style nonce="${nonce}">
:root { color-scheme: light dark; --fg: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.12); --bg: #fff; --accent: #0a66d8; --danger: #c62828; }
@media (prefers-color-scheme: dark) { :root { --fg: #f2f2f2; --muted: #a1a1a6; --line: rgba(255,255,255,.14); --bg: #1e1e20; --accent: #4c9bff; --danger: #ff5a52; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 26px 26px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
.who { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; }
h1 { font-size: 15px; margin: 0 0 10px; }
p.summary { margin: 0 0 12px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.details { margin: 0 0 12px; padding-left: 18px; color: var(--muted); }
.typed { display: block; margin: 0 0 6px; }
input { width: 100%; padding: 6px 8px; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--fg); }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
button.approve { background: var(--accent); border-color: transparent; color: #fff; }
button.approve.danger { background: var(--danger); }
button:disabled { opacity: .45; cursor: default; }
</style></head>
<body>
<p class="who">${escapeHtml(view.pluginName)} asks for approval</p>
<h1>${escapeHtml(request.title)}</h1>
${request.summary ? `<p class="summary">${escapeHtml(request.summary)}</p>` : ''}
<dl>${rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl>
${details}
${typed}
<div class="actions">
<button id="cancel" type="button">Cancel</button>
<button id="approve" type="button" class="approve${danger ? ' danger' : ''}">${escapeHtml(request.confirmLabel ?? 'Approve')}</button>
</div>
<script nonce="${nonce}">
(() => {
  const expected = ${expected};
  const typed = document.getElementById('typed');
  const approve = document.getElementById('approve');
  const answer = (value) => { document.title = value; };
  // Keys already on their way when the sheet takes focus must not approve it.
  let armed = false;
  let arming = 0;
  const ready = () => armed && (!expected || (typed && typed.value === expected));
  const sync = () => { approve.disabled = !ready(); };
  const arm = () => { armed = false; sync(); clearTimeout(arming); arming = setTimeout(() => { armed = true; sync(); }, ${ARM_DELAY_MS}); };
  window.addEventListener('focus', arm);
  if (typed) typed.addEventListener('input', sync);
  arm();
  approve.addEventListener('click', () => { if (ready()) answer('approve:' + encodeURIComponent(typed ? typed.value : '')); });
  document.getElementById('cancel').addEventListener('click', () => answer('cancel'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') answer('cancel');
    // Enter approves from the typed field only; on a button it presses that button.
    if (event.key === 'Enter' && event.target === typed && ready()) answer('approve:' + encodeURIComponent(typed.value));
  });
  if (!typed) document.getElementById('cancel').focus();
})();
</script>
</body></html>`;
}

/** Reads the page's answer from its title; anything unexpected is no answer. */
export function sheetAnswer(title: string): ApprovalSheetOutcome | null {
  if (title === 'cancel') return { kind: 'cancelled' };
  if (!title.startsWith('approve:')) return null;
  try {
    return { kind: 'approved', typed: decodeURIComponent(title.slice('approve:'.length)) };
  } catch {
    return null;
  }
}

/** A tall enough sheet for its rows; it scrolls past the cap. */
export function sheetHeight(request: PluginApprovalRequest): number {
  const summaryLines = request.summary ? Math.ceil(request.summary.length / 54) : 0;
  const detailLines = (request.details ?? []).reduce((sum, line) => sum + Math.ceil(line.length / 46), 0);
  const rows = request.binding.revision ? 4 : 3;
  const estimate = 190 + rows * 22 + summaryLines * 19 + detailLines * 19 + (request.binding.confirmText ? 64 : 0);
  return Math.max(240, Math.min(720, estimate));
}

export function approvalSheetWindowOptions(parent: BrowserWindow, request: PluginApprovalRequest): BrowserWindowConstructorOptions {
  return {
    parent,
    modal: true,
    show: false,
    width: SHEET_WIDTH,
    height: sheetHeight(request),
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: APPROVAL_SHEET_TITLE,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
      spellcheck: false,
      navigateOnDragDrop: false
    }
  };
}

type SheetWindow = Pick<BrowserWindow, 'once' | 'on' | 'close' | 'isDestroyed' | 'show' | 'loadURL'> & {
  webContents: Pick<BrowserWindow['webContents'], 'on' | 'setWindowOpenHandler'>;
};

/**
 * Open the sheet over `parent` and wait for the person. Closing the sheet, the
 * parent closing, a navigation away, or the timeout all count as cancel.
 */
export function showApprovalSheet(
  parent: BrowserWindow,
  view: ApprovalSheetView,
  createWindow: (options: BrowserWindowConstructorOptions) => SheetWindow,
  timeoutMs = APPROVAL_SHEET_TIMEOUT_MS
): Promise<ApprovalSheetOutcome> {
  const nonce = randomBytes(16).toString('base64');
  const sheet = createWindow(approvalSheetWindowOptions(parent, view.request));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ApprovalSheetOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parent.removeListener('closed', onParentClosed);
      if (!sheet.isDestroyed()) sheet.close();
      resolve(outcome);
    };
    const onParentClosed = () => finish({ kind: 'cancelled' });
    const timer = setTimeout(() => finish({ kind: 'cancelled' }), timeoutMs);
    parent.once('closed', onParentClosed);
    sheet.on('closed', () => finish({ kind: 'cancelled' }));
    sheet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    sheet.webContents.on('will-navigate', (event) => {
      event.preventDefault();
      finish({ kind: 'cancelled' });
    });
    // Read the page's answer directly. Native modal windows do not reliably
    // forward title updates on macOS. Keep the native window's title unchanged.
    sheet.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      const answer = sheetAnswer(title);
      if (answer) finish(answer);
    });
    sheet.once('ready-to-show', () => { if (!settled) sheet.show(); });
    const html = approvalSheetHtml(view, nonce);
    sheet.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`).catch(() => finish({ kind: 'cancelled' }));
  });
}
