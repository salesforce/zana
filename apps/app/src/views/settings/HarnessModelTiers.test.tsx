/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { HarnessModelTiers, usesTierRules } from './HarnessModelTiers.js';

afterEach(cleanup);

const NONE = { low: undefined, medium: undefined, high: undefined, 'extra-high': undefined };

function descriptor(over: Partial<HarnessAdapterDescriptor['targets']> = {}, enabled = true): HarnessAdapterDescriptor {
  return {
    id: 'opencode',
    label: 'OpenCode',
    availability: { enabled, installed: enabled, reason: enabled ? undefined : 'Not installed' },
    targets: {
      roles: [],
      models: [
        { id: 'p/terra-1', label: 'Terra 1' },
        { id: 'p/terra-2', label: 'Terra 2' },
        { id: 'p/luna-1', label: 'Luna 1' }
      ],
      modelLevelMapping: NONE,
      defaultModelTierRules: { high: ['terra'] },
      ...over
    }
  } as unknown as HarnessAdapterDescriptor;
}

function setup(opts: { d?: HarnessAdapterDescriptor; config?: Partial<AppConfig> } = {}) {
  const onUpdate = vi.fn(async () => {});
  render(
    <HarnessModelTiers
      family="opencode"
      label="OpenCode"
      descriptor={opts.d ?? descriptor()}
      config={(opts.config ?? {}) as AppConfig}
      onUpdate={onUpdate}
    />
  );
  return onUpdate;
}

const trigger = (tier: string) => screen.getByRole('button', { name: `${tier} tier model` });
const pick = (tier: string, option: string) => {
  fireEvent.click(trigger(tier));
  fireEvent.click(screen.getByText(option));
};

describe('HarnessModelTiers', () => {
  it('shows one picker per tier with the default model named, never a free-text field', () => {
    setup();
    expect(trigger('High').textContent).toContain('Default (Terra 2)');
    expect(trigger('Low').textContent).toContain('Default (Harness default model)');
    expect(screen.getAllByRole('button', { name: /tier model$/ })).toHaveLength(4);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('shows the user pick as the selected model', () => {
    setup({ config: { harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTierRules: { high: ['luna'] } } } } } as AppConfig });
    expect(trigger('High').textContent).toContain('Luna 1');
    expect(screen.getByText('Custom model. Choose Default to follow the latest.')).toBeTruthy();
  });

  it('picking a model writes that id and preserves other fields', () => {
    const onUpdate = setup({
      config: { harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { executionState: 'plan' }, codex: { modelTargetId: 'x' } } } } as AppConfig
    });
    pick('Low', 'Luna 1');
    expect(onUpdate).toHaveBeenCalledWith({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: { executionState: 'plan', modelTierRules: { low: ['p/luna-1'] } },
          codex: { modelTargetId: 'x' }
        }
      }
    });
  });

  it('choosing Default removes the tier and clears empty routing', () => {
    const onUpdate = setup({
      config: { harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTierRules: { high: ['luna'] } } } } } as AppConfig
    });
    pick('High', 'Default (Terra 2)');
    expect(onUpdate).toHaveBeenCalledWith({ harnessRouting: undefined });
  });

  it('choosing Default keeps other tiers and fields', () => {
    const onUpdate = setup({
      config: { harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'm', modelTierRules: { high: ['luna'], low: ['terra'] } } } } } as AppConfig
    });
    pick('High', 'Default (Terra 2)');
    expect(onUpdate).toHaveBeenCalledWith({
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'm', modelTierRules: { low: ['terra'] } } } }
    });
  });

  it('names the fixed mapping model as the default (Claude)', () => {
    const d = descriptor({
      models: [{ id: 'haiku', label: 'Haiku (latest)' }, { id: 'opus', label: 'Opus (latest)' }],
      modelLevelMapping: { ...NONE, low: 'haiku', high: 'opus' },
      defaultModelTierRules: undefined
    } as never);
    setup({ d });
    expect(trigger('Low').textContent).toContain('Default (Haiku (latest))');
    expect(trigger('High').textContent).toContain('Default (Opus (latest))');
  });

  it('renders nothing when the harness lists no models', () => {
    const empty = descriptor({ models: [] });
    expect(usesTierRules(empty)).toBe(false);
    expect(usesTierRules(undefined)).toBe(false);
    const { container } = render(
      <HarnessModelTiers family="claude" label="Claude" descriptor={empty} config={{} as AppConfig} onUpdate={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
    const none = render(<HarnessModelTiers family="opencode" label="X" config={{} as AppConfig} onUpdate={vi.fn()} />);
    expect(none.container.innerHTML).toBe('');
  });

  it('disables the pickers when the harness is unavailable', () => {
    setup({ d: descriptor({}, false) });
    expect((trigger('Low') as HTMLButtonElement).disabled).toBe(true);
  });
});
