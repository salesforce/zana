import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import type { AppModule } from '@shared/module-api';

const h = vi.hoisted(() => {
  const cache = new Map<string, unknown>();
  const state = {
    nav: 'projects',
    moduleBadgeRevision: 0,
    setNav: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    exitProjectFocus: vi.fn(),
    selectProject: vi.fn()
  };
  const data = { projects: [], suggestionsEnabled: false };
  return {
    cache,
    state,
    data,
    modules: [] as AppModule[],
    host: {
      moduleId: 'badge-module',
      cache: {
        get: <T = unknown>(key: string) => cache.get(key) as T | undefined,
        set: (key: string, value: unknown) => cache.set(key, value),
        delete: (key: string) => cache.delete(key),
        refreshBadge: () => {
          state.moduleBadgeRevision += 1;
        }
      }
    }
  };
});

// Sidebar pulls in renderer stores (which close over window.cc / IPC) at module
// load. Stub enough surface to render the rail through React SSR.
vi.mock('../../store', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  }),
  useData: (selector: (state: typeof h.data) => unknown) => selector(h.data),
  useUnreadInboxCount: () => 0,
  useEnabledSchedulerCount: () => 0,
  useRunningSchedulerCount: () => 0,
  useAgentNavCounts: () => ({ active: 0, blocked: 0 })
}));
vi.mock('../../modules', () => ({ useMergedModules: () => h.modules }));
vi.mock('../../modules/ModulePanelHost', () => ({ getHost: () => h.host }));
vi.mock('../AgentTray', () => ({ AgentTray: () => null }));

import { contributesSurface, Sidebar } from '../Sidebar.js';

const base = (over: Partial<AppModule>): AppModule =>
  ({ id: 'm', title: 'M', icon: 'Box', ...over }) as AppModule;

describe('Sidebar.contributesSurface — rail-entry gate', () => {
  it('a surfaceless module (no panel/commands/navBadge) earns NO rail entry', () => {
    // The dissolved Zana manifest: id/title/icon/permissions only.
    expect(contributesSurface(base({}))).toBe(false);
  });

  it('a panel-only module STILL earns a rail entry', () => {
    expect(contributesSurface(base({ panel: (() => null) as unknown as AppModule['panel'] }))).toBe(true);
  });

  it('a commands-only module STILL earns a rail entry', () => {
    expect(contributesSurface(base({ commands: () => [] }))).toBe(true);
  });

  it('a navBadge-only module STILL earns a rail entry', () => {
    expect(contributesSurface(base({ navBadge: () => 1 }))).toBe(true);
  });

  it("a placement:'settings' module stays out regardless of surface", () => {
    expect(
      contributesSurface(
        base({ placement: 'settings', panel: (() => null) as unknown as AppModule['panel'], commands: () => [] })
      )
    ).toBe(false);
  });

  it('a projectTab module KEEPS its global sidebar entry (it also surfaces as a project tab)', () => {
    expect(
      contributesSurface(
        base({ panel: (() => null) as unknown as AppModule['panel'], projectTab: { label: 'X' } })
      )
    ).toBe(true);
  });

  it("a projectTab:{global:false} module is project-tab ONLY — no rail entry", () => {
    expect(
      contributesSurface(
        base({ panel: (() => null) as unknown as AppModule['panel'], projectTab: { label: 'X', global: false } })
      )
    ).toBe(false);
  });

  it('projectTab.global:true is explicit dual-surface (keeps the rail entry)', () => {
    expect(
      contributesSurface(
        base({ panel: (() => null) as unknown as AppModule['panel'], projectTab: { label: 'X', global: true } })
      )
    ).toBe(true);
  });
});

describe('Sidebar extension nav badges', () => {
  it('renders new cache-backed badge value after refreshBadge without navigation', () => {
    h.cache.clear();
    h.state.nav = 'projects';
    h.state.moduleBadgeRevision = 0;
    h.modules = [
      base({
        id: 'badge-module',
        title: 'Badge module',
        navBadge: (host) => host.cache.get<number>('unreadCount') ?? null
      })
    ];

    expect(renderToStaticMarkup(<Sidebar />)).not.toContain('>3<');

    h.host.cache.set('unreadCount', 3);
    h.host.cache.refreshBadge();

    // Nav state is unchanged; the host-triggered revision is Sidebar's reactive
    // dependency, so its navBadge factory reads the new cache value immediately.
    expect(h.state.nav).toBe('projects');
    expect(h.state.moduleBadgeRevision).toBe(1);
    expect(renderToStaticMarkup(<Sidebar />)).toContain('>3<');
  });
});
