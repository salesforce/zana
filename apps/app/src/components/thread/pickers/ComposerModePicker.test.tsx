import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerModePicker } from './ComposerModePicker.js';
import {
  applyComposerModePrefix,
  composerActionsFromProvider,
  composerModesForActions,
  nextComposerWorkMode
} from './composer-mode.js';

describe('composerModesForActions', () => {
  it('always includes Agent and adds Plan/Goal from the provider', () => {
    expect(composerModesForActions([])).toEqual(['agent']);
    expect(composerModesForActions(['plan'])).toEqual(['agent', 'plan']);
    expect(composerModesForActions(['plan', 'goal'])).toEqual(['agent', 'plan', 'goal']);
  });
});

describe('nextComposerWorkMode', () => {
  it('wraps through every offered mode', () => {
    expect(nextComposerWorkMode(['agent', 'plan'], 'agent')).toBe('plan');
    expect(nextComposerWorkMode(['agent', 'plan'], 'plan')).toBe('agent');
    expect(nextComposerWorkMode(['agent', 'plan', 'goal'], 'plan')).toBe('goal');
    expect(nextComposerWorkMode(['agent', 'plan', 'goal'], 'goal')).toBe('agent');
    expect(nextComposerWorkMode(['agent'], 'agent')).toBe('agent');
    expect(nextComposerWorkMode(['agent', 'plan'], 'goal')).toBe('plan');
    expect(nextComposerWorkMode([], 'agent')).toBe('agent');
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
    expect(html).toContain('aria-keyshortcuts="Shift+Tab"');
    expect(html).toContain('Shift+Tab');
  });

  it('does not offer CLI Agent in the work-mode menu', () => {
    const html = renderToStaticMarkup(
      <ComposerModePicker
        value="agent"
        modes={['agent']}
        onChange={() => undefined}
      />
    );
    expect(html).toContain('data-testid="composer-mode-picker-trigger"');
    expect(html).not.toContain('CLI Agent');
    expect(html).not.toContain('Legacy Agent');
    expect(html).not.toContain('composer-mode-legacy');
  });
});
