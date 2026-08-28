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
  it('shows provider tabs on a new thread whenever at least one harness is offered', () => {
    expect(showHarnessTabs(undefined, 2)).toBe(false);
    expect(showHarnessTabs(() => undefined, 0)).toBe(false);
    expect(showHarnessTabs(() => undefined, 1)).toBe(true);
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

  it('closes the menu after a model is chosen, including Enter from search', () => {
    const source = readFileSync(new URL('./ModelReasoningPicker.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(
      /const selectModel = \(value: string\) => \{\s*onModelChange\(value\);\s*setOpen\(false\);/
    );
  });

  it('keeps the last selected more-model in the primary list', () => {
    const source = readFileSync(new URL('./ModelReasoningPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('pinSelectedMoreModels');
    expect(source).toContain('displayed.modelOptions');
  });

  it('keeps extra models behind a More models row instead of dumping them in the primary list', () => {
    const source = readFileSync(new URL('./ModelReasoningPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('More models');
    expect(source).toContain('emptyModelsHint');
    expect(source).toContain('data-testid="model-reasoning-more-toggle"');
    expect(source).toContain('data-testid="model-reasoning-more-menu"');
    expect(source).toContain('model-reasoning-picker-more');
    expect(source).not.toContain('model-reasoning-level-');
  });

  it('names each icon-only harness tab so hover can show the label', () => {
    const source = readFileSync(new URL('./ModelReasoningPicker.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../../styles/global.css', import.meta.url), 'utf8');
    expect(source).toContain('aria-label={provider.label}');
    expect(source).toContain('aria-label="Harness"');
    expect(source).toContain('model-reasoning-picker-section-label">Harness');
    expect(source).not.toContain('title={provider.label}');
    expect(css).toContain('.model-reasoning-picker-tab:hover::after');
    expect(css).toContain('content: attr(aria-label)');
  });

  it('scrolls the model list instead of the whole popover', () => {
    const source = readFileSync(new URL('./ModelReasoningPicker.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../../styles/global.css', import.meta.url), 'utf8');
    expect(source).toContain('model-reasoning-picker-menu--models');
    expect(css).toContain('.model-reasoning-picker-menu--models {');
    expect(css).toContain('.model-reasoning-picker-menu--models .model-reasoning-picker-section');
    expect(css).toMatch(
      /\.model-reasoning-picker-menu--models \.model-reasoning-picker-section\s*\{[^}]*overflow:\s*auto/
    );
  });

  it('holds the trigger and model-list layout with skeletons while loading', () => {
    const html = renderToStaticMarkup(
      <ModelReasoningPicker
        providerOptions={providers}
        selectedProviderId="claude-code"
        modelValue=""
        modelOptions={[]}
        modelIsLoading
        onModelChange={() => undefined}
      />
    );
    expect(html).toContain('data-model-loading-placeholder="trigger-model"');
    expect(html).toContain('data-model-loading-placeholder="trigger-reasoning"');
    expect(html).toContain('sr-only');
    expect(html).toContain('Loading models');
    expect(html).not.toContain('model-reasoning-picker-trigger-model');
    const source = readFileSync(new URL('./ModelReasoningPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('data-model-loading-row');
    expect(source).toContain('aria-label="Loading models"');
    expect(source).toContain("['80px', '112px', '96px', '128px']");
    expect(source).not.toContain('Loading models…');
    const css = readFileSync(new URL('../../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.model-reasoning-picker-loading-row');
    expect(css).toContain('.zcc-skeleton');
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
