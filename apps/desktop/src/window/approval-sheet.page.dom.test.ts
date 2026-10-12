/**
 * @vitest-environment happy-dom
 */
import { runInThisContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARM_DELAY_MS, approvalSheetHtml, type ApprovalSheetView } from './approval-sheet.js';

const binding = { action: 'agent.activate', target: '00D000000000001', targetLabel: 'prod (production)', subject: 'Help_Agent v3' };

/** Runs the sheet's own page script against its own markup. */
function load(confirmText?: string) {
  const view: ApprovalSheetView = { pluginName: 'Salesforce', request: { binding: { ...binding, ...(confirmText ? { confirmText } : {}) }, title: 'Activate' } };
  const html = approvalSheetHtml(view, 'n');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  const script = html.slice(html.indexOf('>', html.indexOf('<script')) + 1, html.indexOf('</script>'));
  document.body.innerHTML = body;
  runInThisContext(script);
  return {
    approve: document.getElementById('approve') as HTMLButtonElement,
    cancel: document.getElementById('cancel') as HTMLButtonElement,
    typed: document.getElementById('typed') as HTMLInputElement | null
  };
}

function enter(target: Element) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('approval sheet page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('ignores approval until armed and again after the sheet regains focus', () => {
    const { approve, cancel } = load();
    expect(document.activeElement).toBe(cancel);
    expect(approve.disabled).toBe(true);
    approve.click();
    expect(document.title).toBe('');
    vi.advanceTimersByTime(ARM_DELAY_MS);
    expect(approve.disabled).toBe(false);
    window.dispatchEvent(new Event('focus'));
    expect(approve.disabled).toBe(true);
    vi.advanceTimersByTime(ARM_DELAY_MS);
    approve.click();
    expect(document.title).toBe('approve:');
  });

  it('never approves on an Enter that lands on Cancel', () => {
    const { cancel } = load();
    vi.advanceTimersByTime(ARM_DELAY_MS);
    enter(cancel);
    enter(document.body);
    expect(document.title).toBe('');
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.title).toBe('cancel');
  });

  it('approves on Enter in the typed field once the text matches', () => {
    const { approve, typed } = load('prod');
    vi.advanceTimersByTime(ARM_DELAY_MS);
    expect(approve.disabled).toBe(true);
    typed!.value = 'pro';
    typed!.dispatchEvent(new Event('input'));
    enter(typed!);
    expect(document.title).toBe('');
    typed!.value = 'prod';
    typed!.dispatchEvent(new Event('input'));
    expect(approve.disabled).toBe(false);
    enter(approve);
    expect(document.title).toBe('');
    enter(typed!);
    expect(document.title).toBe('approve:prod');
  });
});
