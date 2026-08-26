import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Prompts settings layout', () => {
  it('stretches paired editor inputs and groups the test run', () => {
    const view = readFileSync(fileURLToPath(new URL('./PromptsView.tsx', import.meta.url)), 'utf8');
    expect(view).toContain('className="settings-input-full"');
    expect(view).toContain('prompts-test-heading');
    expect(view).not.toContain('Test input —');

    const css = readFileSync(
      fileURLToPath(new URL('../../styles/global.css', import.meta.url)),
      'utf8'
    );
    expect(css).toMatch(/\.prompts-editor input\[type='text'\][\s\S]*?width:\s*100%/);
    expect(css).toMatch(/\.prompts-row \{[\s\S]*?minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.prompts-test \{[\s\S]*?align-items:\s*stretch/);
  });
});
