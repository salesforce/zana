import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerModePicker } from './ComposerModePicker.js';
import { composerModeEntries } from '@zana-ai/zcc-domain/thread-runtime';
import {
  applyComposerModePrefix,
  applyComposerWorkMode,
  composerActionsFromProvider,
  composerModesForActions,
  composerWorkModeForNativeLabel,
  consumeComposerModeCycle,
  nextComposerWorkMode,
  nextNativeRoleValue
} from './composer-mode.js';

describe('composerModesForActions', () => {
  it('always includes Agent and adds Plan from the provider, not Goal', () => {
    expect(composerModesForActions([])).toEqual(['agent']);
    expect(composerModesForActions(['plan'])).toEqual(['agent', 'plan']);
    expect(composerModesForActions(['plan', 'goal'])).toEqual(['agent', 'plan']);
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

describe('nextNativeRoleValue', () => {
  it('wraps through catalog order without reordering', () => {
    const modes = [{ value: 'agent' }, { value: 'plan' }, { value: 'ask' }];
    expect(nextNativeRoleValue(modes, 'agent')).toBe('plan');
    expect(nextNativeRoleValue(modes, 'plan')).toBe('ask');
    expect(nextNativeRoleValue(modes, 'ask')).toBe('agent');
    expect(nextNativeRoleValue(modes, undefined)).toBe('plan');
    expect(nextNativeRoleValue(modes, 'unknown')).toBe('plan');
    expect(nextNativeRoleValue([{ value: 'agent' }], 'agent')).toBe('agent');
    expect(nextNativeRoleValue([], 'agent')).toBe('agent');
  });
});

const calls = { prevented: 0, stopped: 0 };

function cycleEvent(overrides: Partial<{
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}> = {}) {
  return {
    key: 'Tab',
    shiftKey: true,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: () => {
      calls.prevented += 1;
    },
    stopPropagation: () => {
      calls.stopped += 1;
    },
    ...overrides
  };
}

describe('consumeComposerModeCycle', () => {
  it('ignores keys that are not Shift+Tab', () => {
    calls.prevented = 0;
    calls.stopped = 0;
    const onChange = () => {
      calls.prevented += 10;
    };
    expect(consumeComposerModeCycle(cycleEvent({ shiftKey: false }), {
      kind: 'work',
      modes: ['agent', 'plan'],
      current: 'agent',
      onChange
    })).toBe(false);
    expect(consumeComposerModeCycle(cycleEvent({ key: 'Enter' }), {
      kind: 'work',
      modes: ['agent', 'plan'],
      current: 'agent',
      onChange
    })).toBe(false);
    expect(consumeComposerModeCycle(cycleEvent({ metaKey: true }), {
      kind: 'work',
      modes: ['agent', 'plan'],
      current: 'agent',
      onChange
    })).toBe(false);
    expect(calls.prevented).toBe(0);
    expect(calls.stopped).toBe(0);
  });

  it('cycles native ACP modes and work modes, and no-ops a single option', () => {
    calls.prevented = 0;
    calls.stopped = 0;
    const native: string[] = [];
    const work: string[] = [];
    expect(consumeComposerModeCycle(cycleEvent(), {
      kind: 'native',
      options: [{ value: 'agent' }, { value: 'plan' }, { value: 'ask' }],
      current: 'agent',
      onChange: (value) => {
        native.push(value ?? '');
      }
    })).toBe(true);
    expect(native).toEqual(['plan']);
    expect(consumeComposerModeCycle(cycleEvent(), {
      kind: 'work',
      modes: ['agent', 'plan', 'goal'],
      current: 'plan',
      onChange: (value) => {
        work.push(value);
      }
    })).toBe(true);
    expect(work).toEqual(['goal']);
    expect(consumeComposerModeCycle(cycleEvent(), {
      kind: 'native',
      options: [{ value: 'agent' }],
      current: 'agent',
      onChange: () => {
        native.push('x');
      }
    })).toBe(false);
    expect(consumeComposerModeCycle(cycleEvent(), {
      kind: 'work',
      modes: ['agent'],
      current: 'agent',
      onChange: () => {
        work.push('x');
      }
    })).toBe(false);
    expect(native).toEqual(['plan']);
    expect(work).toEqual(['goal']);
    expect(calls.prevented).toBe(2);
    expect(calls.stopped).toBe(2);
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

describe('applyComposerWorkMode', () => {
  it('inserts a /plan command mention and does not double an existing prefix', () => {
    expect(applyComposerWorkMode({ text: 'fix the tests', mentions: [] }, 'agent')).toEqual({
      text: 'fix the tests',
      mentions: []
    });
    const plan = applyComposerWorkMode({ text: 'fix the tests', mentions: [] }, 'plan');
    expect(plan.text).toBe('/plan fix the tests');
    expect(plan.mentions).toEqual([{
      start: 0,
      end: 5,
      resource: {
        kind: 'command',
        trigger: '/',
        name: 'plan',
        source: 'command',
        origin: 'builtin',
        label: 'plan',
        argumentHint: null
      }
    }]);
    const existing = applyComposerWorkMode({
      text: 'see @src/foo.ts',
      mentions: [{
        start: 4,
        end: 15,
        resource: {
          kind: 'path',
          source: 'workspace',
          entryKind: 'file',
          path: 'src/foo.ts',
          label: 'foo.ts'
        }
      }]
    }, 'plan');
    expect(existing.text).toBe('/plan see @src/foo.ts');
    expect(existing.mentions[0]).toMatchObject({ start: 0, end: 5, resource: { name: 'plan' } });
    expect(existing.mentions[1]).toMatchObject({ start: 10, end: 21 });
    const already = applyComposerWorkMode({ text: '/plan already', mentions: [] }, 'plan');
    expect(already.text).toBe('/plan already');
    expect(already.mentions).toHaveLength(1);
    const again = applyComposerWorkMode(already, 'plan');
    expect(again.mentions).toHaveLength(1);
  });
});

describe('composerActionsFromProvider', () => {
  it('accepts string ids or BB action objects', () => {
    expect(composerActionsFromProvider(['plan', 'goal'])).toEqual(['plan', 'goal']);
    expect(composerActionsFromProvider([{ kind: 'plan' }, { kind: 'skills' }])).toEqual(['plan']);
  });
});

describe('composerWorkModeForNativeLabel', () => {
  it('maps plan and goal labels onto composer work modes and treats the rest as agent', () => {
    expect(composerWorkModeForNativeLabel('plan')).toBe('plan');
    expect(composerWorkModeForNativeLabel('PLAN', 'Plan mode')).toBe('plan');
    expect(composerWorkModeForNativeLabel('goal')).toBe('goal');
    expect(composerWorkModeForNativeLabel('build')).toBe('agent');
    expect(composerWorkModeForNativeLabel('agent')).toBe('agent');
    expect(composerWorkModeForNativeLabel('code', 'Default')).toBe('agent');
  });
});

describe('ComposerModePicker', () => {
  it('shows the current mode on the trigger', () => {
    const html = renderToStaticMarkup(
      <ComposerModePicker
        value="plan"
        entries={composerModeEntries({ acpModeOptions: [], composerActions: ['plan'] })}
        onChange={() => undefined}
        onRefresh={() => undefined}
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
        entries={composerModeEntries({ acpModeOptions: [] })}
        onChange={() => undefined}
        onRefresh={() => undefined}
      />
    );
    expect(html).toContain('data-testid="composer-mode-picker-trigger"');
    expect(html).not.toContain('CLI Agent');
    expect(html).not.toContain('Legacy Agent');
    expect(html).not.toContain('composer-mode-legacy');
  });

  it('does not render Refresh roles unless the composer enables discovery', () => {
    const html = renderToStaticMarkup(
      <ComposerModePicker
        value="agent"
        entries={composerModeEntries({ acpModeOptions: [] })}
        onChange={() => undefined}
      />
    );
    expect(html).not.toContain('Refresh roles');
  });
});
