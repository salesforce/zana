// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { EditorView } from './EditorView.js';
import { RevealContext, type RevealState } from '../../lib/settings-search/reveal.js';
import { entries } from '../../lib/settings-search/entries/editor.js';

vi.mock('@/components/ui/PopoverPicklist', () => ({
  PopoverPicklist: (props: any) => (
    <select aria-label={props.ariaLabel} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>
      {props.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}));

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

  it.each([
    ['Win32', 'pwsh'],
    ['MacIntel', 'iTerm']
  ])('suggests a %s terminal app in the placeholder', (platform, placeholder) => {
    const real = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
    try {
      const { container } = render(ui({ target: 'editor.terminal-app', reveal: 'advanced' }));
      const field = container.querySelector('[data-settings-target="editor.terminal-app"] input');
      expect(field?.getAttribute('placeholder')).toBe(placeholder);
    } finally {
      if (real) Object.defineProperty(navigator, 'platform', real);
      else delete (navigator as { platform?: string }).platform;
    }
  });

  it('does not open when the reveal kind or target does not match', () => {
    const a = render(ui({ target: 'editor.cursor-binary', reveal: null }));
    expect(ids(a.container)).not.toContain('editor.cursor-binary');
    a.unmount();
    const b = render(ui({ target: 'editor.codex-binary', reveal: 'advanced' }));
    expect(ids(b.container)).not.toContain('editor.code-binary');
  });
});

describe('EditorView explorer minimap', () => {
  const pickers = ['Minimap width', 'Minimap vertical size', 'Minimap slider', 'Minimap side'];

  it('defaults to the VS Code-style settings and saves each change', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<EditorView config={{} as AppConfig} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    expect(screen.getByRole('switch', { name: 'Minimap' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Render characters' }).getAttribute('aria-checked')).toBe('true');
    const expected: Record<string, string> = {
      'Minimap width': 'default',
      'Minimap vertical size': 'proportional',
      'Minimap slider': 'mouseover',
      'Minimap side': 'right'
    };
    for (const name of pickers) expect((screen.getByLabelText(name) as HTMLSelectElement).value).toBe(expected[name]);
    expect([...(screen.getByLabelText('Minimap width') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Narrow', 'Default', 'Wide']);

    fireEvent.change(screen.getByLabelText('Minimap width'), { target: { value: 'wide' } });
    fireEvent.change(screen.getByLabelText('Minimap vertical size'), { target: { value: 'fit' } });
    fireEvent.change(screen.getByLabelText('Minimap slider'), { target: { value: 'always' } });
    fireEvent.change(screen.getByLabelText('Minimap side'), { target: { value: 'left' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Render characters' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Minimap' }));
    expect(onUpdate.mock.calls.map((c) => c[0])).toEqual([
      { explorerMinimapWidth: 'wide' },
      { explorerMinimapVerticalSize: 'fit' },
      { explorerMinimapSlider: 'always' },
      { explorerMinimapSide: 'left' },
      { explorerMinimapRenderCharacters: false },
      { explorerMinimapEnabled: false }
    ]);
  });

  it('disables the dependent pickers when the minimap is off', () => {
    render(<EditorView config={{ explorerMinimapEnabled: false } as AppConfig} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Minimap' }).getAttribute('aria-checked')).toBe('false');
    for (const name of pickers) expect((screen.getByLabelText(name) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Render characters' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('labels the current values in search', () => {
    const value = (id: string, config: Partial<AppConfig> = {}) =>
      entries.find((e) => e.id === id)?.value?.({ config } as never);
    expect(value('editor.explorer-minimap')).toBe('On');
    expect(value('editor.explorer-minimap', { explorerMinimapEnabled: false })).toBe('Off');
    expect(value('editor.explorer-minimap-width', { explorerMinimapWidth: 'narrow' })).toBe('Narrow');
    expect(value('editor.explorer-minimap-characters', { explorerMinimapRenderCharacters: false })).toBe('Off');
    expect(value('editor.explorer-minimap-vertical-size')).toBe('Proportional');
    expect(value('editor.explorer-minimap-slider', { explorerMinimapSlider: 'always' })).toBe('Always');
    expect(value('editor.explorer-minimap-side', { explorerMinimapSide: 'left' })).toBe('Left');
  });
});

describe('EditorView file icon theme', () => {
  it('defaults to Seti and saves the chosen theme', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<EditorView config={{} as AppConfig} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    const picker = screen.getByLabelText('File icon theme') as HTMLSelectElement;
    expect(picker.value).toBe('seti');
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Seti (VS Code)', 'Minimal', 'None']);
    fireEvent.change(picker, { target: { value: 'none' } });
    expect(onUpdate).toHaveBeenCalledWith({ explorerFileIconTheme: 'none' });
  });

  it('shows the stored theme, and falls back to Seti for an unknown one', () => {
    render(<EditorView config={{ explorerFileIconTheme: 'minimal' } as AppConfig} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />);
    expect((screen.getByLabelText('File icon theme') as HTMLSelectElement).value).toBe('minimal');
    cleanup();
    render(<EditorView config={{ explorerFileIconTheme: 'bogus' } as unknown as AppConfig} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />);
    expect((screen.getByLabelText('File icon theme') as HTMLSelectElement).value).toBe('seti');
  });

  it('labels the current value in search', () => {
    const value = (config: Partial<AppConfig> = {}) =>
      entries.find((e) => e.id === 'editor.explorer-file-icons')?.value?.({ config } as never);
    expect(value()).toBe('Seti (VS Code)');
    expect(value({ explorerFileIconTheme: 'none' })).toBe('None');
  });
});
