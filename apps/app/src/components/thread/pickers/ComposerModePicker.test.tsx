import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerModePicker } from './ComposerModePicker.js';
import {
  applyComposerModePrefix,
  composerActionsFromProvider,
  composerModesForActions
} from './composer-mode.js';

describe('composerModesForActions', () => {
  it('always includes Agent and adds Plan/Goal from the provider', () => {
    expect(composerModesForActions([])).toEqual(['agent']);
    expect(composerModesForActions(['plan'])).toEqual(['agent', 'plan']);
    expect(composerModesForActions(['plan', 'goal'])).toEqual(['agent', 'plan', 'goal']);
  });
});

describe('applyComposerModePrefix', () => {
  it('prefixes /plan or /goal without doubling an existing slash command', () => {
    expect(applyComposerModePrefix('fix the tests', 'agent')).toBe('fix the tests');
    expect(applyComposerModePrefix('fix the tests', 'plan')).toBe('/plan fix the tests');
    expect(applyComposerModePrefix('/plan already', 'plan')).toBe('/plan already');
    expect(applyComposerModePrefix('ship it', 'goal')).toBe('/goal ship it');
  });
});

describe('composerActionsFromProvider', () => {
  it('accepts string ids or BB action objects', () => {
    expect(composerActionsFromProvider(['plan', 'goal'])).toEqual(['plan', 'goal']);
    expect(composerActionsFromProvider([{ kind: 'plan' }, { kind: 'skills' }])).toEqual(['plan']);
  });
});

describe('ComposerModePicker', () => {
  it('shows the current mode on the trigger', () => {
    const html = renderToStaticMarkup(
      <ComposerModePicker
        value="plan"
        modes={['agent', 'plan']}
        onChange={() => undefined}
      />
    );
    expect(html).toContain('data-testid="composer-mode-picker-trigger"');
    expect(html).toContain('Plan');
    expect(html).toContain('aria-label="Composer mode"');
  });
});
