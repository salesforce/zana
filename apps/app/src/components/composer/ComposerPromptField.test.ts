import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ComposerPromptField', () => {
  it('owns the shared editor chrome without launch or thread create', () => {
    const ui = readFileSync(new URL('./ComposerPromptField.tsx', import.meta.url), 'utf8');
    const field = readFileSync(new URL('./use-composer-prompt-field.ts', import.meta.url), 'utf8');
    expect(ui).toContain('ComposerImageThumbs');
    expect(ui).toContain('ComposerTypeaheadMenu');
    expect(ui).toContain('Make prompt box larger');
    expect(ui).toContain('EditorContent');
    expect(ui).not.toContain('createTerminal');
    expect(ui).not.toContain('product.threads.create');
    expect(field).toContain("kind === 'cli'");
    expect(field).toContain('filterCliComposerCommands');
    expect(field).toContain("slashCatalog.kind === 'cli' ? [] : threadRows");
    expect(field).toContain('product.threads.commands');
    expect(field).not.toContain('createTerminal');
    expect(field).not.toContain('product.threads.create');
    expect(field).not.toContain('ComposerModePicker');
  });
});
