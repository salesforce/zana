import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('PromptComposer Home variant', () => {
  it('keeps the Home-style launch action keyboard-safe and labelled', () => {
    const source = readFileSync(new URL('../PromptComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain("variant?: 'default' | 'home';");
    expect(source).toContain("if (!submitDisabled) onSubmit();");
    expect(source).toContain("className=\"prompt-composer-home-launch\"");
    expect(source).toContain('aria-label={submitLabel}');
  });
});
