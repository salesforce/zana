import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVAL_SHEET_TITLE,
  approvalSheetHtml,
  approvalSheetWindowOptions,
  sheetAnswer,
  sheetHeight,
  showApprovalSheet,
  type ApprovalSheetView
} from './approval-sheet.js';

const binding = { action: 'agent.activate', target: '00D000000000001', targetLabel: 'agentaidev (sandbox)', subject: 'Help_Agent v3' };
const view: ApprovalSheetView = { pluginName: 'Salesforce', request: { binding, title: 'Activate Help_Agent' } };

describe('approvalSheetHtml', () => {
  it('escapes every plugin-supplied string and locks the page to its nonce', () => {
    const html = approvalSheetHtml({
      pluginName: '<b>Evil</b>',
      request: {
        binding: { ...binding, subject: '"><script>alert(1)</script>', revision: 'abcdef0123456789abcdef' },
        title: 'T & <i>',
        summary: "it's <live>",
        details: ['<img src=x>'],
        confirmLabel: '<Go>'
      }
    }, 'NONCE');
    expect(html).toContain("default-src 'none'; style-src 'nonce-NONCE'; script-src 'nonce-NONCE'");
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; asks for approval');
    expect(html).toContain('<h1>T &amp; &lt;i&gt;</h1>');
    expect(html).toContain('<p class="summary">it&#39;s &lt;live&gt;</p>');
    expect(html).toContain('<li>&lt;img src=x&gt;</li>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<code title="abcdef0123456789abcdef">abcdef012345…</code>');
    expect(html).toContain('>&lt;Go&gt;</button>');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain(`<title>${APPROVAL_SHEET_TITLE}</title>`);
  });

  it('keeps short revisions whole and leaves optional sections out', () => {
    const html = approvalSheetHtml({ ...view, request: { ...view.request, binding: { ...binding, revision: 'v12' } } }, 'n');
    expect(html).toContain('<code title="v12">v12</code>');
    expect(html).not.toContain('class="summary"');
    expect(html).not.toContain('class="details"');
    expect(html).not.toContain('id="typed"');
    expect(html).toContain('const expected = "";');
    expect(html).toContain('class="approve">Approve</button>');
  });

  it('asks for typed text and paints a danger approve button', () => {
    const html = approvalSheetHtml({
      ...view,
      request: { ...view.request, tone: 'danger', binding: { ...binding, confirmText: 'prod</script>' } }
    }, 'n');
    expect(html).toContain('Type <code>prod&lt;/script&gt;</code> to approve');
    expect(html).toContain('<input id="typed"');
    expect(html).toContain('const expected = "prod\\u003c/script>";');
    expect(html).toContain('class="approve danger"');
  });
});

describe('sheetAnswer', () => {
  it('reads cancel and approve answers from the title', () => {
    expect(sheetAnswer('cancel')).toEqual({ kind: 'cancelled' });
    expect(sheetAnswer('approve:')).toEqual({ kind: 'approved', typed: '' });
    expect(sheetAnswer('approve:my%20prod')).toEqual({ kind: 'approved', typed: 'my prod' });
  });

  it('treats anything else as no answer', () => {
    for (const title of [APPROVAL_SHEET_TITLE, '', 'approve', 'other', 'cancel:', 'approve:%E0%A4%A']) {
      expect(sheetAnswer(title)).toBeNull();
    }
  });
});

describe('sheet geometry', () => {
  it('grows with content inside fixed bounds', () => {
    const base = sheetHeight(view.request);
    expect(base).toBeGreaterThanOrEqual(240);
    expect(sheetHeight({ ...view.request, binding: { ...binding, revision: 'r', confirmText: 'p' }, summary: 's'.repeat(200), details: ['d'] })).toBeGreaterThan(base);
    expect(sheetHeight({ ...view.request, summary: 's'.repeat(600), details: Array(8).fill('d'.repeat(240)) })).toBe(720);
  });

  it('opens a locked-down modal child', () => {
    const parent = {} as BrowserWindow;
    const options = approvalSheetWindowOptions(parent, view.request);
    expect(options).toMatchObject({ parent, modal: true, show: false, width: 480, resizable: false, title: APPROVAL_SHEET_TITLE });
    expect(options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false });
    expect(options.webPreferences).not.toHaveProperty('preload');
  });
});

class FakeSheet extends EventEmitter {
  destroyed = false;
  shown = false;
  url = '';
  openHandler: (() => { action: string }) | null = null;
  loadResult: Promise<void> = Promise.resolve();
  webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: (handler: () => { action: string }) => { this.openHandler = handler; }
  });
  isDestroyed() { return this.destroyed; }
  show() { this.shown = true; }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
  loadURL(url: string) {
    this.url = url;
    return this.loadResult;
  }
}

function open(timeoutMs?: number, configure?: (sheet: FakeSheet) => void) {
  const parent = new EventEmitter();
  const sheet = new FakeSheet();
  configure?.(sheet);
  const seen: unknown[] = [];
  const outcome = showApprovalSheet(parent as unknown as BrowserWindow, view, (options) => {
    seen.push(options);
    return sheet as never;
  }, timeoutMs);
  return { parent, sheet, outcome, seen };
}

describe('showApprovalSheet', () => {
  afterEach(() => vi.useRealTimers());

  it('loads main-written markup, shows when ready and resolves on approve', async () => {
    const { parent, sheet, outcome, seen } = open();
    expect(seen[0]).toMatchObject({ modal: true, parent });
    expect(sheet.url.startsWith('data:text/html;charset=utf-8;base64,')).toBe(true);
    const html = Buffer.from(sheet.url.split(',')[1]!, 'base64').toString();
    expect(html).toContain('Activate Help_Agent');
    expect(sheet.openHandler?.()).toEqual({ action: 'deny' });
    sheet.emit('ready-to-show');
    expect(sheet.shown).toBe(true);
    const loaded = { preventDefault: vi.fn() };
    sheet.webContents.emit('page-title-updated', loaded, APPROVAL_SHEET_TITLE);
    expect(loaded.preventDefault).toHaveBeenCalled();
    expect(sheet.destroyed).toBe(false);
    sheet.webContents.emit('page-title-updated', { preventDefault: vi.fn() }, 'approve:prod');
    await expect(outcome).resolves.toEqual({ kind: 'approved', typed: 'prod' });
    expect(sheet.destroyed).toBe(true);
    expect(parent.listenerCount('closed')).toBe(0);
  });

  it('cancels when the person cancels', async () => {
    const { sheet, outcome } = open();
    sheet.webContents.emit('page-title-updated', { preventDefault: vi.fn() }, 'cancel');
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('cancels when the sheet or its parent closes', async () => {
    const first = open();
    first.sheet.close();
    await expect(first.outcome).resolves.toEqual({ kind: 'cancelled' });
    const second = open();
    second.parent.emit('closed');
    await expect(second.outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(second.sheet.destroyed).toBe(true);
  });

  it('blocks and cancels any navigation away', async () => {
    const { sheet, outcome } = open();
    const event = { preventDefault: vi.fn() };
    sheet.webContents.emit('will-navigate', event, 'https://example.com');
    expect(event.preventDefault).toHaveBeenCalled();
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('cancels when the page fails to load', async () => {
    const { outcome } = open(undefined, (sheet) => { sheet.loadResult = Promise.reject(new Error('boom')); });
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('times out to cancel and ignores later answers', async () => {
    vi.useFakeTimers();
    const { sheet, outcome } = open(1000);
    vi.advanceTimersByTime(1000);
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    sheet.webContents.emit('page-title-updated', { preventDefault: vi.fn() }, 'approve:');
    sheet.emit('ready-to-show');
    expect(sheet.shown).toBe(false);
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });
});
