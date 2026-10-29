/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { PluginAssistantContext } from './plugin-assistant-context.js';
import { PluginMarkdownDirectives } from './PluginMarkdownDirectives.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';

vi.mock('../lib/product-client.js', () => ({
  product: {
    threads: {
      onOpen: () => () => undefined
    }
  }
}));

describe('PluginMarkdownDirectives', () => {
  afterEach(() => {
    clearPluginSlots('docs');
  });

  it.each([null, 'docs', 'another-plugin'])('hides only opted-in navigation cards beside their own plugin (%s)', (owner) => {
    const navigation = vi.fn(() => <span>Open document</span>);
    interpretPluginApp('docs', definePluginApp((app) => {
      app.slots.messageDirective({ id: 'doc', hideInAssistant: true, component: navigation });
      app.slots.messageDirective({ id: 'operation', component: () => <span>Compile passed</span> });
    }));
    const html = renderToStaticMarkup(
      <PluginAssistantContext.Provider value={owner}>
        <PluginMarkdownDirectives
          text={'Status remains visible.\n\n::doc{id="one"}\n\n::operation{id="compile"}\n\nLocal change only.'}
          threadId="thr-1"
          messageId="msg-1"
        />
      </PluginAssistantContext.Provider>
    );
    expect(html).toContain('Status remains visible.');
    expect(html).toContain('Compile passed');
    expect(html).toContain('Local change only.');
    expect(html.includes('Open document')).toBe(owner !== 'docs');
    expect(navigation).toHaveBeenCalledTimes(owner === 'docs' ? 0 : 1);
    expect(html).not.toContain('::doc');
  });

  it('wires openWorkspaceFile on thread surfaces and allows an explicit override', () => {
    interpretPluginApp(
      'docs',
      definePluginApp((app) => {
        app.slots.messageDirective({
          id: 'doc',
          component: (props) => (
            <span data-testid="directive-opener">
              {typeof props.openWorkspaceFile === 'function' ? 'wired' : 'null'}
            </span>
          )
        });
      })
    );

    const withThread = renderToStaticMarkup(
      <PluginMarkdownDirectives
        text={'See this doc:\n\n::doc{path="findings/auth.md"}\n'}
        threadId="thr-1"
        messageId="msg-1"
      />
    );
    expect(withThread).toContain('wired');

    const overridden = renderToStaticMarkup(
      <PluginMarkdownDirectives
        text={'See this doc:\n\n::doc{path="findings/auth.md"}\n'}
        threadId="thr-1"
        messageId="msg-1"
        openWorkspaceFile={null}
      />
    );
    expect(overridden).toContain('null');

    const withoutThread = renderToStaticMarkup(
      <PluginMarkdownDirectives
        text={'See this doc:\n\n::doc{path="findings/auth.md"}\n'}
        messageId="msg-1"
      />
    );
    expect(withoutThread).toContain('null');
  });
});
