import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Selectors of the error surfaces whose text users need to copy. */
const ERROR_SELECTORS = [
  '.thread-file-preview-error', // "Could not open this file / File not found"
  '.thread-command-error', // "Squad launch failed: ..." banner in the composer
  '.modal-error',
  '.launch-error',
  '.cc-error',
  '.peers-error',
  '.machine-reconnect-error',
  '.team-requirement-failure',
  '.api-error-resume-error',
  '.sidebar-navigation-error',
  '.thread-file-preview-reveal-error'
];

const css = readFileSync(join(__dirname, 'global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Selectors of every rule that sets `user-select: text`, with its body. */
function selectableSelectors(): Set<string> {
  const found = new Set<string>();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;|\s)user-select:\s*text/.test(rule[2] ?? '')) continue;
    for (const selector of (rule[1] ?? '').split(',')) found.add(selector.trim());
  }
  return found;
}

describe('error text is selectable', () => {
  it.each(ERROR_SELECTORS)('%s opts back into text selection', (selector) => {
    expect(selectableSelectors().has(selector)).toBe(true);
  });

  it('the app chrome is still unselectable by default', () => {
    expect(css).toMatch(/overflow: hidden;\s*user-select: none;/);
  });
});
