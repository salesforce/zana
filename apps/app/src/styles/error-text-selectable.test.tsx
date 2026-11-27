// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadFilePreviewView } from '../components/thread/secondary-panel/ThreadFilePreviewTab.js';

/**
 * Error surfaces whose text users need to copy. The app chrome sets
 * `user-select: none` on the body, so each opts back in. This list is the
 * allow-list; any error surface not named here keeps the chrome default.
 */
const ERROR_CLASSES = [
  'thread-file-preview-error', // "Could not open this file / File not found"
  'thread-command-error', // "Squad launch failed: ..." banner in the composer
  'modal-error', 'launch-error', 'cc-error', 'peers-error', 'machine-reconnect-error',
  'team-requirement-failure', 'api-error-resume-error', 'sidebar-navigation-error',
  'thread-file-preview-reveal-error', 'add-machine-error', 'machine-cli-row-error', 'cc-row-error',
  'thread-timeline-load-error', 'thread-pending-banner-error', 'thread-diff-error',
  'thread-browser-error-detail', 'session-move-error', 'project-checkout-error', 'plugin-setting-error',
  'panel-agent-tab-error', 'host-repair-agent-error', 'host-install-drawer-error', 'git-project-error',
  'ext-actions-error', 'cc-rail-error', 'agent-monitor-row-error', 'agent-modal-catchup-error',
  'thread-queued-failure', 'toast',
  // Squad launch preview and composer status text ("Launch preview could not validate ...", Location line)
  'team-launch-settings-status', 'squad-launch-preview', 'team-composer-limit-message'
];

const source = readFileSync(join(__dirname, 'global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { selector: string; decls: Map<string, string>; order: number }

/** Every flat `selector { decls }` rule in order, one entry per comma-separated selector. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) decls.set(decl.slice(0, colon).trim().toLowerCase(), decl.slice(colon + 1).trim().toLowerCase());
    }
    for (const selector of (match[1] ?? '').split(',')) rules.push({ selector: selector.trim().replace(/\s+/g, ' '), decls, order: order++ });
  }
  return rules;
}

/** Specificity as a comparable number: ids, then classes/attributes/pseudo-classes, then elements. */
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.replace(/\.[\w-]+|#[\w-]+|\[[^\]]*\]|:+[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + elements;
}

const rules = parseRules(source);
const textRule = (cls: string) => rules.find((rule) => rule.selector === `.${cls}` && rule.decls.get('user-select') === 'text');

/** Rules that could switch the error element itself back to `none` (not its buttons). */
function overriding(cls: string, text: Rule): Rule[] {
  return rules.filter((rule) => {
    const value = rule.decls.get('user-select') ?? rule.decls.get('-webkit-user-select');
    if (!value || value === 'text' || rule === text) return false;
    const last = rule.selector.split(/[\s>+~]+/).pop() ?? '';
    if (!new RegExp(`\.${cls}(?![\w-])`).test(last)) return false;
    return specificity(rule.selector) > specificity(text.selector) || (specificity(rule.selector) === specificity(text.selector) && rule.order > text.order);
  });
}

describe('error text is selectable', () => {
  it.each(ERROR_CLASSES)('.%s is selectable in both prefixes and nothing later or more specific turns it off', (cls) => {
    const rule = textRule(cls);
    expect(rule, `no user-select: text rule for .${cls}`).toBeDefined();
    expect(rule?.decls.get('-webkit-user-select')).toBe('text');
    expect(overriding(cls, rule!).map((r) => r.selector)).toEqual([]);
  });

  it.each(ERROR_CLASSES)('buttons inside .%s stay chrome (not selectable text)', (cls) => {
    const rule = rules.find((r) => r.selector === `.${cls} button`);
    expect(rule?.decls.get('user-select')).toBe('none');
    expect(rule?.decls.get('-webkit-user-select')).toBe('none');
  });

  it('the app chrome is still unselectable by default', () => {
    const body = rules.find((r) => r.selector === 'body' || r.selector === '#root' || r.selector === 'html');
    expect(body, 'a root rule').toBeDefined();
    expect(rules.some((r) => ['html', 'body', '#root'].includes(r.selector) && r.decls.get('user-select') === 'none')).toBe(true);
  });

  it('detects an override: a later rule that sets none on an error class fails the cascade check', () => {
    const bad = parseRules('.x-error { user-select: text; } .panel .x-error { user-select: none; }');
    const text = bad[0]!;
    const hit = bad.filter((r) => r !== text && r.decls.get('user-select') === 'none' && specificity(r.selector) > specificity(text.selector));
    expect(hit).toHaveLength(1);
  });
});

describe('rendered file-preview error panel', () => {
  afterEach(cleanup);

  it('resolves the real stylesheet to selectable text for the message and none for Try again', () => {
    const style = document.createElement('style');
    style.textContent = source;
    document.head.append(style);
    try {
      const { container, getByText } = render(<ThreadFilePreviewView path="missing.ts" content={null} error="File not found: missing.ts" onRetry={() => undefined} />);
      const panel = container.querySelector('.thread-file-preview-error') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(getByText('File not found: missing.ts').tagName).toBe('P');
      expect(getComputedStyle(panel).userSelect || getComputedStyle(panel).getPropertyValue('-webkit-user-select')).toBe('text');
      const button = getByText('Try again');
      expect(getComputedStyle(button).userSelect || getComputedStyle(button).getPropertyValue('-webkit-user-select')).toBe('none');
    } finally {
      style.remove();
    }
  });
});
