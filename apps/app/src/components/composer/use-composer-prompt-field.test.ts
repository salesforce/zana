import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('useComposerPromptField', () => {
  it('rerenders consumers when editor content changes', () => {
    const source = readFileSync(new URL('./use-composer-prompt-field.ts', import.meta.url), 'utf8');

    expect(source).toContain('setEditorRevision((current) => current + 1)');
    expect(source).toContain('const text = editor ? serializePromptEditor(editor.getJSON()).text :');
  });
});
