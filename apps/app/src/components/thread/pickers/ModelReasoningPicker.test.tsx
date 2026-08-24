import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelReasoningPicker, showHarnessTabs } from './ModelReasoningPicker.js';
import { stripModelBrandPrefix } from './model-brand-prefix.js';
import { humanThreadModelLabel, humanThreadReasoningLabel } from './thread-execution-labels.js';

const providers = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' }
];
const models = [
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { value: 'claude-opus-5[1m]', label: 'Claude Opus 5 (1M)' }
];

describe('showHarnessTabs', () => {
  it('shows provider tabs only when the new-thread callback is present', () => {
    expect(showHarnessTabs(undefined, 2)).toBe(false);
    expect(showHarnessTabs(() => undefined, 1)).toBe(false);
    expect(showHarnessTabs(() => undefined, 2)).toBe(true);
  });
});

describe('ModelReasoningPicker', () => {
  it('shows the brand-stripped model on the trigger without reasoning', () => {
    const html = renderToStaticMarkup(
      <ModelReasoningPicker
        providerOptions={providers}
        selectedProviderId="claude-code"
        onSelectedProviderChange={() => undefined}
        modelValue="claude-sonnet-5"
        modelOptions={models}
        onModelChange={() => undefined}
      />
    );
    expect(html).toContain('data-testid="model-reasoning-picker-trigger"');
    expect(html).toContain('Sonnet 5');
    expect(html).toContain('<svg');
    expect(html).not.toContain('model-reasoning-picker-trigger-reasoning');
    expect(html).not.toMatch(/model-reasoning-picker-trigger-icon"[^>]*>C</);
    expect(html).not.toContain('role="tablist"');
  });

  it('locks an existing thread by omitting the provider-change callback', () => {
    const html = renderToStaticMarkup(
      <ModelReasoningPicker
        providerOptions={providers}
        selectedProviderId="claude-code"
        modelValue="claude-sonnet-5"
        modelOptions={models}
        onModelChange={() => undefined}
      />
    );
    expect(html).toContain('Sonnet 5');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('data-testid="model-reasoning-provider-codex"');
  });

  it('falls back to a letter when the harness has no brand mark', () => {
    const html = renderToStaticMarkup(
      <ModelReasoningPicker
        providerOptions={[{ value: 'fake', label: 'Fake' }]}
        selectedProviderId="fake"
        modelValue="claude-sonnet-5"
        modelOptions={models}
        onModelChange={() => undefined}
      />
    );
    expect(html).toMatch(/model-reasoning-picker-trigger-icon"[^>]*>F</);
  });

  it('keeps extra models behind a More models row instead of dumping them in the primary list', () => {
    const source = readFileSync(new URL('./ModelReasoningPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('More models');
    expect(source).toContain('data-testid="model-reasoning-more-toggle"');
    expect(source).toContain('data-testid="model-reasoning-more-menu"');
    expect(source).toContain('model-reasoning-picker-more');
    expect(source).not.toContain('model-reasoning-level-');
  });
});

describe('thread execution labels', () => {
  it('strips the Claude brand and maps xhigh to X-High', () => {
    expect(stripModelBrandPrefix('Claude Sonnet 5', 'claude-code')).toBe('Sonnet 5');
    expect(humanThreadModelLabel('claude-sonnet-5', 'claude-code')).toBe('Sonnet 5');
    expect(humanThreadReasoningLabel('xhigh')).toBe('X-High');
    expect(humanThreadReasoningLabel(null)).toBeNull();
  });
});
