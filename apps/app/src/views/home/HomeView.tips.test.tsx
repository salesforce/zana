// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeView } from './HomeView.js';
import { HelpProvider } from '../../components/help/HelpProvider.js';
import { setBasicUiMode } from '../../lib/basic-ui.js';
import { HOME_WIDGETS_KEY, HOME_WIDGETS_VISIBLE_KEY, newWidget } from './widgets/model.js';
import zanaGlyph from '../../assets/zana-glyph.svg';

const mocks = vi.hoisted(() => ({ sections: [] as unknown[], composer: vi.fn() }));
vi.mock('@/components/AuroraGrid', () => ({ AuroraGrid: () => <div /> }));
vi.mock('@/components/HomeAgentComposer', () => ({ HomeAgentComposer: (props: unknown) => {
  mocks.composer(props);
  return <input aria-label="Launcher draft" />;
} }));
vi.mock('@/plugins/PluginNewThreadActions', () => ({ PluginNewThreadActions: () => <button>Plugin action</button> }));
vi.mock('@/plugins/plugin-slots', () => ({
  subscribePluginSlots: () => () => undefined,
  listHomepageSections: () => mocks.sections
}));
vi.mock('@/plugins/PluginSlotBoundary', () => ({ PluginSlotBoundary: ({ children }: { children: React.ReactNode }) => children }));
afterEach(() => {
  cleanup();
  localStorage.removeItem(HOME_WIDGETS_KEY);
  localStorage.removeItem(HOME_WIDGETS_VISIBLE_KEY);
  mocks.sections = [];
  vi.clearAllMocks();
  setBasicUiMode('advanced');
});

it('presents Basic welcome without remounting its native draft or plugin surfaces', () => {
  mocks.sections = [{ id: 'example', generation: 1, title: 'Useful links', component: () => <button>Homepage tool</button> }];
  render(<MemoryRouter><HelpProvider><HomeView /></HelpProvider></MemoryRouter>);
  const draft = screen.getByRole('textbox', { name: 'Launcher draft' });
  const plugin = screen.getByRole('button', { name: 'Homepage tool' });
  fireEvent.change(draft, { target: { value: 'Keep this thought' } });
  act(() => setBasicUiMode('basic'));
  expect(screen.getByRole('heading', { name: 'What shall we work on today?' })).toBeTruthy();
  const mark = document.querySelector('.conversation-welcome > .zana-brand-icon') as HTMLElement;
  expect(mark.style.mask).toContain(zanaGlyph);
  expect(mark.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('.conversation-welcome svg')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Launcher draft' })).toBe(draft);
  expect(screen.queryByRole('button', { name: 'Homepage tool' })).toBeNull();
  expect(document.querySelector('.home-plugin-section button')).toBe(plugin);
  act(() => setBasicUiMode('advanced'));
  expect(screen.queryByRole('heading', { name: 'What shall we work on today?' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Homepage tool' })).toBe(plugin);
  expect((screen.getByRole('textbox', { name: 'Launcher draft' }) as HTMLInputElement).value).toBe('Keep this thought');
});

it('offers tips around the launcher and plugin shortcuts while preserving prompt seeding', () => {
  render(<MemoryRouter initialEntries={['/?prompt=Explain%20this%20project&focus=1']}><HelpProvider><HomeView /></HelpProvider></MemoryRouter>);
  expect(screen.getByRole('button', { name: /Need a few tips/ })).toBeTruthy();
  expect(mocks.composer).toHaveBeenCalledWith({ allowLegacyAgent: true, initialText: 'Explain this project', autoFocus: true });
  expect(screen.getByRole('button', { name: 'Plugin action' }).closest('.contextual-help-surface'))
    .toBe(screen.getByLabelText('Launcher draft').closest('.contextual-help-surface'));
  expect(document.querySelector('.home-plugin-sections')).toBeNull();
});

it('keeps plugin homepage sections outside the launcher guide', () => {
  mocks.sections = [{ id: 'example', generation: 1, title: 'Useful links', component: () => <button>Homepage tool</button> }];
  render(<MemoryRouter><HelpProvider><HomeView /></HelpProvider></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Useful links' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Homepage tool' }).closest('.home-launcher-tips')).toBeNull();
});

it('mounts a pinned plugin section once when switching between Basic and Advanced', () => {
  mocks.sections = [{ id: 'links', pluginId: 'example', generation: 1, title: 'Useful links', component: () => <button>Homepage tool</button> }];
  localStorage.setItem(HOME_WIDGETS_KEY, JSON.stringify([
    newWidget('links', { source: 'plugin:example:links', title: 'Useful links', display: 'list', content: '' })
  ]));
  setBasicUiMode('basic');
  render(<MemoryRouter><HelpProvider><HomeView /></HelpProvider></MemoryRouter>);
  expect(screen.queryByRole('article', { name: 'Useful links' })).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Show widgets' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('article', { name: 'Useful links' }).querySelector('button')?.textContent).toBe('Homepage tool');
  expect(screen.getAllByText('Homepage tool')).toHaveLength(1);
  act(() => setBasicUiMode('advanced'));
  expect(screen.queryByRole('article', { name: 'Useful links' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Homepage tool' }).closest('.home-plugin-section')).toBeTruthy();
});
