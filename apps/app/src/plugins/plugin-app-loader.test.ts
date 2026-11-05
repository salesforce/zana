import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { listComposerCustomizations, listCreateProjectActions, listHomepageSections, listNavPanels, listPendingInteractionSlots, listProjectTabs } from './plugin-slots.js';
import { pluginAppIsLoadable, reconcilePluginApps, refreshPluginApps, reloadPluginApp, usePluginAppModules } from './plugin-app-loader.js';
import { product } from '../lib/product-client.js';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';

// The real product client creates a new HTTP family on each property access.
// Hold a stable family here so spies and the refresh-race tests exercise it.
vi.mock('../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/product-client.js')>();
  const pluginApps = { ...actual.product.pluginApps, list: async () => [] };
  return { ...actual, product: new Proxy(actual.product, {
    get(target, key) { return key === 'pluginApps' ? pluginApps : Reflect.get(target, key); }
  }) };
});

afterEach(async () => {
  await reconcilePluginApps([]);
});

describe('plugin page recovery', () => {
  afterEach(() => vi.restoreAllMocks());
  const entry: PluginAppEntry = {
    id: 'dashboard', name: 'Team dashboard', description: '', icon: 'LayoutDashboard', enabled: true,
    provenance: 'direct', sourceKind: 'path', status: 'running', appUrl: '/plugins/dashboard/assets/app.js?v=1'
  };
  const valid = async () => ({ default: {
    __zccPluginApp: true,
    setup(app: { slots: { navPanel(registration: object): void; projectTab(registration: object): void; homepageSection(registration: object): void } }) {
      app.slots.navPanel({ id: 'main', path: 'overview', title: 'Dashboard', icon: 'LayoutDashboard', component: () => null });
      app.slots.navPanel({ id: 'details', placement: 'extensions', title: 'Details', icon: 'List', component: () => null });
      app.slots.navPanel({ id: 'hidden', placement: 'unlisted', title: 'Hidden', icon: 'List', component: () => null });
      app.slots.projectTab({ id: 'project', label: 'Dashboard', global: false, order: 7, component: () => null });
      app.slots.homepageSection({ id: 'summary', title: 'Summary', component: () => null });
    }
  } });

  it.each(['throw', 'invalid', 'setup'])('keeps known page destinations while removing executable contributions after %s', async failure => {
    await reconcilePluginApps([entry], { importer: valid });
    const oldComponent = listNavPanels()[0]!.component;
    const importer = async () => {
      if (failure === 'throw') throw new Error('Import failed');
      return { default: failure === 'invalid' ? {} : { __zccPluginApp: true, setup() { throw new Error('Setup failed'); } } };
    };
    await reconcilePluginApps([{ ...entry, appUrl: `${entry.appUrl}2` }], { importer });
    expect(listNavPanels()).toMatchObject([
      { id: 'main', path: 'overview', title: 'Dashboard' },
      { id: 'details', placement: 'extensions' },
      { id: 'hidden', placement: 'unlisted' }
    ]);
    expect(listNavPanels()[0]!.component).not.toBe(oldComponent);
    expect(listProjectTabs()).toMatchObject([{ id: 'project', global: false, order: 7 }]);
    expect(listHomepageSections()).toEqual([]);
    expect(usePluginAppModules.getState().modules[0]).toMatchObject({
      id: entry.id, loadError: expect.any(String), projectTab: { global: false, order: 7 }
    });
    expect(usePluginAppModules.getState().modules[0]?.panel).toBeTypeOf('function');
    expect(usePluginAppModules.getState().runtimeLoadedIds.size).toBe(0);
    await reconcilePluginApps([{ ...entry, appUrl: `${entry.appUrl}3` }], { importer: valid });
    expect(usePluginAppModules.getState().modules[0]?.loadError).toBeUndefined();
    expect(listNavPanels()).toHaveLength(3);
    expect(listHomepageSections()).toHaveLength(1);
  });

  it('keeps known pages when the backend degrades, then removes them on disable', async () => {
    await reconcilePluginApps([entry], { importer: valid });
    const importer = vi.fn(valid);
    await reconcilePluginApps([{ ...entry, status: 'degraded', statusDetail: 'Factory failed' }], { importer });
    expect(importer).not.toHaveBeenCalled();
    expect(listNavPanels()).toHaveLength(3);
    expect(usePluginAppModules.getState().modules[0]?.loadError).toBe('Factory failed');
    await reconcilePluginApps([{ ...entry, status: 'degraded', statusDetail: null }]);
    expect(usePluginAppModules.getState().modules[0]?.loadError).toBe('Plugin is not running.');
    await reconcilePluginApps([{ ...entry, status: 'disabled', enabled: false }]);
    expect(listNavPanels()).toEqual([]);
    expect(usePluginAppModules.getState().modules).toEqual([]);
  });

  it('does not invent pages for a first-load or slot-only failure', async () => {
    await reconcilePluginApps([entry], { importer: async () => ({ default: { __zccPluginApp: true, setup() {} } }) });
    await reconcilePluginApps([{ ...entry, appUrl: `${entry.appUrl}2` }], { importer: async () => { throw new Error('No UI'); } });
    expect(listNavPanels()).toEqual([]);
    expect(listProjectTabs()).toEqual([]);
    expect(usePluginAppModules.getState().modules[0]?.panel).toBeUndefined();
  });

  it.each(['/plugins/dashboard/assets/app.js', '/plugins/dashboard/assets/app.js?v=1'])('retries a cached failure at a fresh URL without remounting unrelated apps: %s', async url => {
    const target = { ...entry, appUrl: url };
    const other = { ...entry, id: 'other', appUrl: '/plugins/other/assets/app.js?v=1' };
    const importer = vi.fn(async (requested: string) => {
      if (requested === url) throw new Error('Network failed');
      return valid();
    });
    await reconcilePluginApps([target, other], { importer });
    await reconcilePluginApps([target, other], { importer });
    expect(importer).toHaveBeenCalledTimes(2);
    await reconcilePluginApps([target, other], { importer, retryPluginId: entry.id });
    expect(importer).toHaveBeenCalledTimes(3);
    expect(importer.mock.calls[2]![0]).toMatch(new RegExp(`${url.includes('?') ? '&' : '\\?'}zccRetry=\\d+$`));
    expect(usePluginAppModules.getState().modules.find(module => module.id === entry.id)?.loadError).toBeUndefined();
    // The host event can finish the reload before its HTTP acknowledgement.
    // Verifying that success must not remount the already-healthy pages again.
    await reconcilePluginApps([target, other], { importer, retryPluginId: entry.id });
    expect(importer).toHaveBeenCalledTimes(3);
  });

  it.each(['Rejected by host', ''])('reports a rejected reload before fetching a new snapshot: %s', async message => {
    vi.spyOn(product.pluginApps, 'reload').mockResolvedValue({ ok: false, message });
    const list = vi.spyOn(product.pluginApps, 'list');
    await expect(reloadPluginApp(entry.id)).rejects.toThrow(message || 'Reload failed');
    expect(list).not.toHaveBeenCalled();
  });

  it.each([
    { entries: [] },
    { entries: [{ ...entry, enabled: false, status: 'disabled' as const }] },
    { entries: [{ ...entry, status: 'degraded' as const, statusDetail: 'Factory crashed' }] }
  ])('checks backend health after an accepted reload', async ({ entries }) => {
    vi.spyOn(product.pluginApps, 'reload').mockResolvedValue({ ok: true });
    vi.spyOn(product.pluginApps, 'list').mockResolvedValue(entries);
    await expect(reloadPluginApp(entry.id)).rejects.toThrow(entries[0]?.statusDetail || 'Plugin is not running');
  });

  it('does not treat an accepted reload as proof the UI imported', async () => {
    vi.spyOn(product.pluginApps, 'reload').mockResolvedValue({ ok: true });
    vi.spyOn(product.pluginApps, 'list').mockResolvedValue([entry]);
    await expect(reloadPluginApp(entry.id)).rejects.toThrow();
    expect(usePluginAppModules.getState().modules[0]?.loadError).toBeTruthy();
  });

  it('accepts a healthy reload when the plugin no longer declares a UI', async () => {
    vi.spyOn(product.pluginApps, 'reload').mockResolvedValue({ ok: true });
    vi.spyOn(product.pluginApps, 'list').mockResolvedValue([{ ...entry, appUrl: null }]);
    await expect(reloadPluginApp(entry.id)).resolves.toBeUndefined();
  });

  it('does not overwrite a newer lifecycle snapshot with a stale reload response', async () => {
    vi.spyOn(product.pluginApps, 'reload').mockResolvedValue({ ok: true });
    let resolveList!: (entries: PluginAppEntry[]) => void;
    vi.spyOn(product.pluginApps, 'list').mockImplementation(() => new Promise(resolve => { resolveList = resolve; }));
    const reload = reloadPluginApp(entry.id);
    await vi.waitFor(() => expect(resolveList).toBeTypeOf('function'));
    await reconcilePluginApps([]);
    resolveList([entry]);
    await reload;
    expect(usePluginAppModules.getState().modules).toEqual([]);
  });
});

describe('server plugin app loader', () => {
  it('registers a running app and exposes its nav module', async () => {
    await reconcilePluginApps(
      [
        {
          id: 'tasks',
          name: 'Tasks',
          description: 'Track work items',
          icon: 'ListTodo',
          enabled: true,
          provenance: 'builtin',
          status: 'running',
          appUrl: '/plugins/tasks/assets/dist/app.js?v=1'
        }
      ],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: { slots: { navPanel(registration: object): void; homepageSection(registration: object): void } }) {
              app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
              app.slots.homepageSection({ id: 'summary', title: 'Summary', component: () => null });
            }
          }
        })
      }
    );

    expect(usePluginAppModules.getState().modules.map((module) => module.id)).toEqual(['tasks']);
    expect([...usePluginAppModules.getState().runtimeLoadedIds]).toEqual(['tasks']);
    expect(listNavPanels().map((panel) => panel.pluginId)).toContain('tasks');
    expect(listHomepageSections().map((section) => section.pluginId)).toContain('tasks');
  });

  it('loads a needs-configuration app so setup UI can mount', async () => {
    await reconcilePluginApps(
      [
        {
          id: 'salesforce',
          name: 'Salesforce',
          description: 'Needs an org alias',
          icon: 'Cloud',
          enabled: true,
          provenance: 'direct',
          status: 'needs-configuration',
          appUrl: '/plugins/salesforce/assets/app.js?v=1'
        }
      ],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: {
              slots: {
                projectTab(registration: object): void;
                experimental_createProjectAction(registration: object): void;
              };
            }) {
              app.slots.projectTab({ id: 'salesforce', label: 'Salesforce', icon: 'Cloud', global: false, component: () => null });
              app.slots.projectTab({ id: 'soql', label: 'SOQL', icon: 'Database', global: false, component: () => null });
              app.slots.experimental_createProjectAction({
                id: 'dx-project',
                title: 'Salesforce DX project',
                icon: 'Cloud',
                run: () => undefined
              });
            }
          }
        })
      }
    );

    expect(usePluginAppModules.getState().modules).toMatchObject([
      { id: 'salesforce', title: 'Salesforce', icon: 'Cloud' }
    ]);
    expect([...usePluginAppModules.getState().runtimeLoadedIds]).toEqual(['salesforce']);
    expect(listNavPanels()).toEqual([]);
    expect(listProjectTabs().map((tab) => tab.id)).toEqual(['salesforce', 'soql']);
    expect(listCreateProjectActions().map((action) => action.title)).toEqual(['Salesforce DX project']);
  });

  it('pluginAppIsLoadable keeps setup-needed plugins and skips broken ones', () => {
    expect(pluginAppIsLoadable({ status: 'running', appUrl: '/plugins/a/assets/app.js' })).toBe(true);
    expect(pluginAppIsLoadable({ status: 'needs-configuration', appUrl: '/plugins/a/assets/app.js' })).toBe(true);
    expect(pluginAppIsLoadable({ status: 'disabled', appUrl: '/plugins/a/assets/app.js' })).toBe(false);
    expect(pluginAppIsLoadable({ status: 'degraded', appUrl: '/plugins/a/assets/app.js' })).toBe(false);
    expect(pluginAppIsLoadable({ status: 'running', appUrl: null })).toBe(false);
  });

  it('clears prior slots when a plugin stops running', async () => {
    await reconcilePluginApps(
      [{ id: 'tasks', name: 'Tasks', description: '', icon: 'ListTodo', enabled: true, provenance: 'builtin', status: 'running', appUrl: '/plugins/tasks/assets/app.js?v=1' }],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: { slots: { navPanel(registration: object): void } }) {
              app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
            }
          }
        })
      }
    );

    await reconcilePluginApps([{ id: 'tasks', name: 'Tasks', description: '', icon: 'ListTodo', enabled: false, provenance: 'builtin', status: 'disabled', appUrl: null }]);

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(usePluginAppModules.getState().runtimeLoadedIds.size).toBe(0);
    expect(listNavPanels().some((panel) => panel.pluginId === 'tasks')).toBe(false);
  });

  it('does not register slots from an import superseded by a disabled snapshot', async () => {
    let resolveImport!: (value: { default: unknown }) => void;
    const pendingImport = new Promise<{ default: unknown }>((resolve) => {
      resolveImport = resolve;
    });
    const entry = {
      id: 'tasks', name: 'Tasks', description: '', icon: 'ListTodo', enabled: true,
      provenance: 'builtin' as const, status: 'running' as const,
      appUrl: '/plugins/tasks/assets/app.js?v=1'
    };

    const stale = reconcilePluginApps([entry], { importer: async () => pendingImport });
    await reconcilePluginApps([{ ...entry, enabled: false, status: 'disabled', appUrl: null }]);
    resolveImport({
      default: {
        __zccPluginApp: true,
        setup(app: { slots: { navPanel(registration: object): void } }) {
          app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
        }
      }
    });
    await stale;

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(usePluginAppModules.getState().runtimeLoadedIds.size).toBe(0);
    expect(listNavPanels().some((panel) => panel.pluginId === 'tasks')).toBe(false);
  });

  it('does not clear newer slots when a superseded import fails', async () => {
    let rejectImport!: (error: Error) => void;
    const pendingImport = new Promise<{ default: unknown }>((_, reject) => {
      rejectImport = reject;
    });
    const entry = {
      id: 'tasks', name: 'Tasks', description: '', icon: 'ListTodo', enabled: true,
      provenance: 'builtin' as const, status: 'running' as const,
      appUrl: '/plugins/tasks/assets/app.js?v=1'
    };
    const validApp = {
      default: {
        __zccPluginApp: true,
        setup(app: { slots: { navPanel(registration: object): void } }) {
          app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
        }
      }
    };

    const stale = reconcilePluginApps([entry], { importer: async () => pendingImport });
    await reconcilePluginApps([{ ...entry, appUrl: '/plugins/tasks/assets/app.js?v=2' }], {
      importer: async () => validApp
    });
    rejectImport(new Error('old bundle failed'));
    await stale;

    expect([...usePluginAppModules.getState().runtimeLoadedIds]).toEqual(['tasks']);
    expect(listNavPanels().some((panel) => panel.pluginId === 'tasks')).toBe(true);
  });

  it('surfaces an import failure without leaving stale slot registrations', async () => {
    await reconcilePluginApps(
      [{ id: 'broken', name: 'Broken', description: '', icon: 'Bug', enabled: true, provenance: 'direct', status: 'running', appUrl: '/plugins/broken/assets/app.js?v=1' }],
      { importer: async () => { throw new Error('bundle exploded'); } }
    );

    expect(usePluginAppModules.getState().modules[0]).toMatchObject({ id: 'broken', loadError: 'bundle exploded' });
    expect(usePluginAppModules.getState().modules[0]?.panel).toBeUndefined();
    expect(usePluginAppModules.getState().runtimeLoadedIds.size).toBe(0);
    expect(listNavPanels().some((panel) => panel.pluginId === 'broken')).toBe(false);
  });

  it('does not activate a leftover extension.json RendererEntry as a plugin app', async () => {
    const Panel = () => null;
    await reconcilePluginApps(
      [{
        id: 'gus',
        name: 'GUS',
        description: 'GUS',
        icon: 'Ticket',
        enabled: true,
        provenance: 'direct',
        status: 'running',
        appUrl: '/plugins/gus/assets/renderer.js?v=1'
      }],
      {
        importer: async () => ({
          default: {
            activate: () => ({ panel: Panel, settingsPanel: Panel })
          }
        })
      }
    );

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(usePluginAppModules.getState().runtimeLoadedIds.size).toBe(0);
    expect(listNavPanels().some((panel) => panel.pluginId === 'gus')).toBe(false);
  });

  it('does not treat a leftover activate() as a failed plugin-app import', async () => {
    await reconcilePluginApps(
      [{
        id: 'empty',
        name: 'Empty',
        description: '',
        icon: 'Puzzle',
        enabled: true,
        provenance: 'direct',
        status: 'running',
        appUrl: '/plugins/empty/assets/renderer.js?v=1'
      }],
      {
        importer: async () => ({
          default: { activate: () => ({}) }
        })
      }
    );

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(usePluginAppModules.getState().runtimeLoadedIds.size).toBe(0);
    expect(usePluginAppModules.getState().modules.some((module) => module.loadError)).toBe(false);
  });

  it('does not create a nav module for a slot-only plugin app', async () => {
    await reconcilePluginApps(
      [{
        id: 'ask-user-question',
        name: 'Ask user question',
        description: '',
        icon: 'CircleHelp',
        enabled: true,
        provenance: 'builtin',
        status: 'running',
        appUrl: '/plugins/ask-user-question/assets/app.js?v=1'
      }],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: { slots: { pendingInteraction(registration: object): void } }) {
              app.slots.pendingInteraction({ id: 'ask-user-question', component: () => null });
            }
          }
        })
      }
    );

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect([...usePluginAppModules.getState().runtimeLoadedIds]).toEqual(['ask-user-question']);
    expect(listNavPanels()).toEqual([]);
    expect(listPendingInteractionSlots().map((slot) => slot.pluginId)).toEqual(['ask-user-question']);
  });

  it('does not re-import a plugin whose appUrl is unchanged', async () => {
    const urls: string[] = [];
    const importer = async (url: string) => {
      urls.push(url);
      return {
        default: {
          __zccPluginApp: true,
          setup(app: { slots: { navPanel(registration: object): void } }) {
            app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
          }
        }
      };
    };
    const entry = {
      id: 'tasks',
      name: 'Tasks',
      description: '',
      icon: 'ListTodo',
      enabled: true,
      provenance: 'builtin' as const,
      status: 'running' as const,
      appUrl: '/plugins/tasks/assets/app.js?v=1'
    };
    await reconcilePluginApps([entry], { importer });
    await reconcilePluginApps([{ ...entry }], { importer });
    expect(urls).toEqual(['/plugins/tasks/assets/app.js?v=1']);
    expect([...usePluginAppModules.getState().runtimeLoadedIds]).toEqual(['tasks']);
    await reconcilePluginApps([{ ...entry, appUrl: '/plugins/tasks/assets/app.js?v=2' }], { importer });
    expect(urls).toEqual(['/plugins/tasks/assets/app.js?v=1', '/plugins/tasks/assets/app.js?v=2']);
  });

  it('registers composer-only apps that have no nav panel or project tab', async () => {
    await reconcilePluginApps(
      [{
        id: 'harness-claude',
        name: 'Claude Code CLI Agent',
        description: '',
        icon: 'Bot',
        enabled: true,
        provenance: 'builtin',
        status: 'running',
        appUrl: '/plugins/harness-claude/assets/app.js?v=1'
      }],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: {
              composer: { customize(registration: object): void };
            }) {
              app.composer.customize({
                id: 'chip',
                scopes: ['cli-agent'],
                meta: [{ id: 'chip', component: () => null }]
              });
            }
          }
        })
      }
    );
    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect([...usePluginAppModules.getState().runtimeLoadedIds]).toEqual(['harness-claude']);
    expect(listComposerCustomizations()).toEqual([
      expect.objectContaining({ pluginId: 'harness-claude', id: 'chip' })
    ]);
  });

  it('installs the plugin runtime from a static import so composer context is shared', () => {
    const source = readFileSync(new URL('./plugin-app-loader.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { installPluginRuntime } from './plugin-runtime.js'");
    expect(source).not.toContain("import('./plugin-runtime.js')");
  });

  it('ignores a stale refresh response when a newer refresh starts', async () => {
    const staleEntry = {
      id: 'stale', name: 'Stale', description: '', icon: 'Bug', enabled: true,
      provenance: 'direct' as const, status: 'running' as const,
      appUrl: '/plugins/stale/assets/app.js?v=1'
    };
    let resolveFirst!: (entries: typeof staleEntry[]) => void;
    const first = new Promise<typeof staleEntry[]>((resolve) => {
      resolveFirst = resolve;
    });
    let calls = 0;
    const list = () => {
      calls += 1;
      return calls === 1 ? first : Promise.resolve([]);
    };
    const originalList = product.pluginApps.list;
    product.pluginApps.list = list;
    try {
      const stale = refreshPluginApps();
      await refreshPluginApps();
      resolveFirst([staleEntry]);
      await stale;
      expect(usePluginAppModules.getState().modules).toEqual([]);
      expect(usePluginAppModules.getState().runtimeLoadedIds.size).toBe(0);
    } finally {
      product.pluginApps.list = originalList;
    }
  });

  it('routes approval requests to desktop main and fails closed elsewhere', async () => {
    const originalList = product.pluginApps.list;
    product.pluginApps.list = async () => [];
    const request = { binding: { action: 'agent.publish', target: 'org', targetLabel: 'dev', subject: 'Help' }, title: 'Publish' };
    try {
      await refreshPluginApps();
      const host = (globalThis as { __ZCC_PLUGIN_HOST__?: { requestApproval?: (id: string, req: typeof request) => Promise<unknown> } }).__ZCC_PLUGIN_HOST__;
      await expect(host?.requestApproval?.('salesforce', request)).resolves.toEqual({ approved: false, reason: 'unavailable' });
      vi.stubGlobal('window', {});
      await expect(host?.requestApproval?.('salesforce', request)).resolves.toEqual({ approved: false, reason: 'unavailable' });
      const approve = vi.fn(async () => ({ approved: true, token: 't', expiresAt: 1 }));
      vi.stubGlobal('window', { cc: { pluginApprovals: { request: approve } } });
      await expect(host?.requestApproval?.('salesforce', request)).resolves.toEqual({ approved: true, token: 't', expiresAt: 1 });
      expect(approve).toHaveBeenCalledWith({ ...request, pluginId: 'salesforce' });
    } finally {
      vi.unstubAllGlobals();
      product.pluginApps.list = originalList;
    }
  });
});
