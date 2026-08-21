import { describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  useMergedModules: vi.fn(),
  getHost: vi.fn((id: string) => ({ moduleId: id }))
}));

vi.mock('../index', () => ({ useMergedModules: mocks.useMergedModules }));
vi.mock('../ModulePanelHost', () => ({ getHost: mocks.getHost }));
vi.mock('../../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children
}));

import { ModuleBackgroundHost } from '../ModuleBackgroundHost.js';

describe('ModuleBackgroundHost', () => {
  it('mounts each merged background with its cached host and ignores modules without one', () => {
    const Background = ({ host }: { host: { moduleId: string } }) =>
      h('output', null, `background:${host.moduleId}`);
    mocks.useMergedModules.mockReturnValue([
      { id: 'active', title: 'Active', icon: 'Box', background: Background },
      { id: 'panel-only', title: 'Panel only', icon: 'Box', panel: () => null }
    ]);

    const html = renderToStaticMarkup(h(ModuleBackgroundHost));

    expect(html).toContain('background:active');
    expect(html).not.toContain('panel-only');
    expect(mocks.getHost).toHaveBeenCalledTimes(1);
    expect(mocks.getHost).toHaveBeenCalledWith('active');
  });
});
