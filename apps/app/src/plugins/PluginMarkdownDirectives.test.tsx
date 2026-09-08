/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
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
