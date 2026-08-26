import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PluginComposerChrome } from './PluginComposerChrome.js';

function render(scope: Parameters<typeof PluginComposerChrome>[0]['scope']) {
  return renderToStaticMarkup(
    <PluginComposerChrome
      scope={scope}
      text=""
      setText={() => undefined}
      focus={() => undefined}
    >
      <span>composer</span>
    </PluginComposerChrome>
  );
}

describe('PluginComposerChrome create-plugin action', () => {
  it('labels the new-thread action Create plugin', () => {
    const html = render({ kind: 'new-thread', projectId: null });
    expect(html).toContain('data-testid="composer-create-plugin"');
    expect(html).toContain('Create plugin');
    expect(html).not.toMatch(/>Plugin</);
  });

  it('hides the action on an existing thread', () => {
    const html = render({ kind: 'thread', threadId: 't1' });
    expect(html).not.toContain('composer-create-plugin');
    expect(html).not.toContain('Create plugin');
    expect(html).not.toContain('plugin-composer-actions');
  });
});
