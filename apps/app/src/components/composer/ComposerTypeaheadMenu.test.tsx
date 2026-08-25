import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComposerTypeaheadMenu } from './ComposerTypeaheadMenu.js';

describe('ComposerTypeaheadMenu', () => {
  it('renders sectioned mention rows and marks the highlighted option', () => {
    const html = renderToStaticMarkup(
      <ComposerTypeaheadMenu
        triggerKind="mention"
        selectedIndex={1}
        onApply={() => undefined}
        suggestions={[
          { kind: 'thread', threadId: 't1', projectId: 'p1', title: 'Review', projectName: 'Zana' },
          { kind: 'path', path: 'src/foo.ts', name: 'foo.ts', entryKind: 'file' }
        ]}
      />
    );
    expect(html).toContain('data-testid="composer-typeahead-menu"');
    expect(html).toContain('Threads');
    expect(html).toContain('Files');
    expect(html).toContain('foo.ts');
    expect(html).toContain('Zana');
    expect(html).toContain('title="Review · Zana"');
    expect(html).toContain('aria-selected="true"');
  });

  it('shows an empty mention state', () => {
    const html = renderToStaticMarkup(
      <ComposerTypeaheadMenu
        triggerKind="mention"
        selectedIndex={0}
        suggestions={[]}
        onApply={() => undefined}
      />
    );
    expect(html).toContain('No matching mentions');
  });
});
