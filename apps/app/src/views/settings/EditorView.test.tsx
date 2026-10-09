// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { EditorView } from './EditorView.js';
import { RevealContext, type RevealState } from '../../lib/settings-search/reveal.js';
import { entries } from '../../lib/settings-search/entries/editor.js';

const state = vi.hoisted(() => ({ refresh: vi.fn(async () => undefined) }));
vi.mock('@/store', () => ({
  useData: (select: (value: unknown) => unknown) => select({ editorStatus: [{ target: 'cursor', installed: true, version: '1.0' }], refreshEditorStatus: state.refresh })
}));

afterEach(cleanup);

function ui(reveal?: RevealState) {
  const view = <EditorView config={{} as AppConfig} onConfigDraft={vi.fn()} onUpdate={vi.fn(async () => undefined)} />;
  return reveal ? <RevealContext.Provider value={reveal}>{view}</RevealContext.Provider> : view;
}
const ids = (c: HTMLElement) => [...c.querySelectorAll('[data-settings-target]')].map((e) => e.getAttribute('data-settings-target'));

describe('EditorView settings-search targets', () => {
  it('collapsed: renders the non-advanced entries only', () => {
    const { container } = render(ui());
    const rendered = ids(container);
    for (const id of ['editor.bar-intro', 'editor.cursor', 'editor.code', 'editor.intellij', 'editor.finder', 'editor.terminal', 'editor.recheck']) {
      expect(rendered).toContain(id);
    }
    expect(rendered).not.toContain('editor.cursor-binary');
    expect(state.refresh).toHaveBeenCalled();
  });

  it.each(['editor.cursor', 'editor.code', 'editor.intellij', 'editor.terminal'])('opens the Advanced block of %s when revealed', (row) => {
    const children = entries.filter((e) => e.id.startsWith(`${row}-`)).map((e) => e.id);
    expect(children.length).toBeGreaterThan(0);
    const { container } = render(ui({ target: children[0], reveal: 'advanced' }));
    const rendered = ids(container);
    for (const id of children) expect(rendered).toContain(id);
  });

  it('does not open when the reveal kind or target does not match', () => {
    const a = render(ui({ target: 'editor.cursor-binary', reveal: null }));
    expect(ids(a.container)).not.toContain('editor.cursor-binary');
    a.unmount();
    const b = render(ui({ target: 'editor.codex-binary', reveal: 'advanced' }));
    expect(ids(b.container)).not.toContain('editor.code-binary');
  });
});
