import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentInsights } from '../AgentInsights';
import type { SessionStats } from '@shared/types';

/**
 * AgentInsights renders transcript-derived, display-only stats. Cost is
 * DELIBERATELY not rendered here: `costUsd` is a cumulative session total, and
 * pairing it with Context (a point-in-time window-fill figure) read as if the
 * cost belonged to those tokens. The dedicated Usage panel owns cost instead.
 * These pin the render path — context renders alone, and cost never leaks in —
 * using static server rendering (matching the project's dependency-light,
 * no-jsdom component-test style).
 */
const base: SessionStats = { files: [], queue: [] };

describe('AgentInsights — context render', () => {
  it('renders context tokens without any cost figure', () => {
    const html = renderToStaticMarkup(
      h(AgentInsights, { stats: { ...base, contextTokens: 44_900, costUsd: 0.42 } })
    );
    expect(html).toContain('44.9k');
    expect(html).toContain('agent-context-bar');
    expect(html).toContain('Context');
    // Cost is never rendered here, even when SessionStats carries it.
    expect(html).not.toContain('$0.42');
    expect(html).not.toContain('agent-context-sep');
    expect(html).not.toContain('Cost');
  });

  it('omits the context block and any cost when there is no context figure', () => {
    const html = renderToStaticMarkup(
      h(AgentInsights, { stats: { ...base, costUsd: 12.3 } })
    );
    expect(html).not.toContain('agent-context-figures');
    expect(html).not.toContain('agent-context-bar');
    expect(html).not.toContain('$12.30');
    expect(html).not.toContain('Cost');
  });

  it('omits the context block entirely when context is absent', () => {
    const html = renderToStaticMarkup(
      h(AgentInsights, { stats: { ...base, model: 'claude-sonnet-4-5-20250929' } })
    );
    expect(html).not.toContain('agent-context-figures');
    // But the model still renders.
    expect(html).toContain('sonnet-4-5');
  });
});

describe('AgentInsights — lifetime usage', () => {
  it('renders lifetime Usage after Context and before Files without rendering cost', () => {
    const html = renderToStaticMarkup(
      h(AgentInsights, {
        stats: {
          ...base,
          contextTokens: 44_900,
          costUsd: 12.3,
          tokens: { input: 1_200, output: 300, cacheRead: 400, cacheWrite: 100 },
          files: [{ path: '/src/example.ts', op: 'W' }]
        }
      })
    );

    expect(html).toContain('Usage');
    expect(html).toContain('session total');
    expect(html).toContain('2.0k');
    expect(html.indexOf('Context')).toBeLessThan(html.indexOf('Usage'));
    expect(html.indexOf('Usage')).toBeLessThan(html.indexOf('Files'));
    expect(html).not.toContain('$12.30');
    expect(html).not.toContain('Cost');
  });

  it('omits Usage when lifetime token totals are absent', () => {
    const html = renderToStaticMarkup(
      h(AgentInsights, { stats: { ...base, model: 'opencode/large' } })
    );

    expect(html).not.toContain('Usage');
    expect(html).not.toContain('session total');
  });

  it('does not infer Context from lifetime token totals', () => {
    const html = renderToStaticMarkup(
      h(AgentInsights, {
        stats: {
          ...base,
          model: 'opencode/large',
          tokens: { input: 1_200, output: 300, cacheRead: 400, cacheWrite: 100 }
        }
      })
    );

    expect(html).toContain('Usage');
    expect(html).not.toContain('agent-context-bar');
    expect(html).not.toContain('Context');
  });

  it('renders the OpenCode-supported subset without Context or cost', () => {
    const html = renderToStaticMarkup(
      h(AgentInsights, {
        stats: {
          ...base,
          model: 'gpt-5.6-terra',
          harnessVersion: '1.18.10',
          agent: 'build',
          costUsd: 3.2,
          tokens: { input: 59_389, output: 95, cacheRead: 59_366, cacheWrite: 0 },
          files: [{ path: '/repo/src/example.ts', op: 'W' }]
        }
      })
    );

    expect(html).toContain('gpt-5.6-terra');
    expect(html).toContain('1.18.10');
    expect(html).toContain('build');
    expect(html).toContain('session total');
    expect(html).toContain('Files');
    expect(html).not.toContain('Context');
    expect(html).not.toContain('Cost');
    expect(html).not.toContain('$3.20');
  });
});
