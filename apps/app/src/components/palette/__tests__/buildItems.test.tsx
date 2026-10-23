import { describe, it, expect, vi } from 'vitest';
import { buildPaletteItems, type PaletteBuildContext } from '../buildItems.js';
import { useUi } from '../../../store.js';
import type { WhenContext } from '../whenContext.js';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { Project, TerminalSession, ScheduledTask, Persona } from '@zana-ai/zcc-domain/product';

// The builder calls getHost(moduleId) for any module that contributes commands;
// stub the module-host bridge so we don't pull in the live store/IPC wiring.
vi.mock('../../../modules/ModulePanelHost', () => ({
  getHost: (id: string) => ({ moduleId: id, toast: () => {} })
}));
// The builder imports `useUi` only for imperative `.getState()` calls inside
// run handlers — never at build time — but the module-load still resolves it.
vi.mock('../../../store', async () => {
  return {
    useUi: {
      getState: vi.fn(() => ({ exitProjectFocus: () => {}, enterProjectFocus: () => {} }))
    },
    visibleTerminals: (list: TerminalSession[] | undefined) => list ?? []
  };
});
vi.mock('../../thread/pickers/model-refresh.js', () => ({ refreshModelsWithToast: vi.fn() }));
import { refreshModelsWithToast } from '../../thread/pickers/model-refresh.js';
const noop = () => {};
const asyncNoop = async () => null;

const whenCtx: WhenContext = {
  activeNav: 'projects',
  hasActiveProject: true,
  hasActiveTab: true,
  tabCount: 1,
  activeTabStatus: 'running',
  activeTabProfile: 'claude',
  projectView: 'terminals',
  platform: 'darwin',
  panelFocused: false,
  scopedWindow: false
};

function makeProject(id: string): Project {
  return { id, name: `proj-${id}`, path: `/tmp/${id}` } as Project;
}
function makeTab(id: string): TerminalSession {
  return { id, title: `tab-${id}`, status: 'running', profile: 'claude', pinned: false } as TerminalSession;
}

function baseCtx(over: Partial<PaletteBuildContext> = {}): PaletteBuildContext {
  const project = makeProject('p1');
  const tab = makeTab('t1');
  return {
    projects: [project],
    terminals: { p1: [tab] },
    selectedProject: project,
    selectedProjectTabs: [tab],
    activeTab: tab,
    scheduledTasks: [] as ScheduledTask[],
    personas: [] as Persona[],
    modules: [],
    overviewOpen: false,
    whenCtx,
    onClose: noop,
    launch: noop,
    launchPersona: noop,
    addProject: asyncNoop,
    setNav: noop,
    selectProject: noop,
    selectTab: noop,
    setProjectView: noop,
    setSettingsTab: noop,
    setExtensionsTab: noop,
    setOverviewOpen: noop,
    setPinned: noop,
    restartTerminal: asyncNoop,
    closeTerminal: asyncNoop,
    reopenLastClosed: asyncNoop,
    restoreLastDetached: asyncNoop,
    pushToast: noop,
    ...over
  };
}

describe('buildPaletteItems', () => {
  it('offers model recovery without a selected project and runs the shared refresh', () => {
    const onClose = vi.fn();
    const pushToast = vi.fn();
    const action = buildPaletteItems(baseCtx({ selectedProject: null, onClose, pushToast }))
      .find((item) => item.key === 'action:refresh-models')!;
    expect(action.label).toBe('Refresh models');
    expect(action.keywords).toEqual(expect.arrayContaining(['reload', 'restore', 'models']));
    action.run();
    expect(onClose).toHaveBeenCalledOnce();
    expect(refreshModelsWithToast).toHaveBeenCalledWith(pushToast);
  });

  it('golden snapshot: full set of built-in keys with a project + tab', () => {
    const keys = buildPaletteItems(baseCtx()).map((i) => i.key);
    expect(keys).toEqual([
      'project:p1',
      'tab:t1',
      'action:new-chat',
      'action:add-project',
      'action:settings',
      'action:refresh-models',
      'action:shortcuts',
      'action:inbox',
      'action:scheduler',
      'action:skills',
       'action:plugin-hub',
      'action:mcp',
      'action:personas',
      'action:overview',
      'action:project-agents',
      'action:project-settings',
      'action:quick-open',
      'action:search-contents',
      'action:new-claude',
      'action:new-claude-yolo',
      'action:resume-claude',
      'action:new-shell',
      'action:open-cursor',
      'action:open-code',
      'action:open-finder',
      'action:open-terminal',
      'action:pin-active',
      'action:duplicate-active',
      'action:restart-active',
      'action:reopen-last-closed',
      'open-window:p1'
    ]);
  });

  it('names the platform file manager on the reveal action', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'platform');
    const labelOn = (platform: string) => {
      Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
      return buildPaletteItems(baseCtx()).find((item) => item.key === 'action:open-finder')!.label;
    };
    try {
      expect(labelOn('Win32')).toBe('Reveal proj-p1 in Explorer');
      expect(labelOn('MacIntel')).toBe('Reveal proj-p1 in Finder');
      expect(labelOn('Linux x86_64')).toBe('Reveal proj-p1 in file manager');
    } finally {
      if (original) Object.defineProperty(navigator, 'platform', original);
      else delete (navigator as { platform?: string }).platform;
    }
  });

  it('emits a launch row per persona, keyed + keyworded for fuzzy match', () => {
    const personas: Persona[] = [
      { id: 'reviewer', name: 'Code Reviewer', description: 'terse reviewer' },
      { id: 'architect', name: 'Architect' }
    ];
    const items = buildPaletteItems(baseCtx({ personas }));
    const reviewer = items.find((i) => i.key === 'action:new-persona:reviewer');
    expect(reviewer).toBeTruthy();
    expect(reviewer!.label).toBe('New Code Reviewer tab in proj-p1');
    expect(reviewer!.keywords).toContain('persona');
    expect(items.some((i) => i.key === 'action:new-persona:architect')).toBe(true);
  });

  it('omits persona launch rows when no project is selected', () => {
    const personas: Persona[] = [{ id: 'reviewer', name: 'Code Reviewer' }];
    const keys = buildPaletteItems(baseCtx({
      personas,
      selectedProject: null,
      selectedProjectTabs: [],
      activeTab: undefined
    })).map((i) => i.key);
    expect(keys.some((k) => k.startsWith('action:new-persona:'))).toBe(false);
  });

  it('omits project-scoped actions when no project is selected', () => {
    const keys = buildPaletteItems(baseCtx({
      selectedProject: null,
      selectedProjectTabs: [],
      activeTab: undefined
    })).map((i) => i.key);
    expect(keys).toEqual([
      'project:p1', // still listed as a switch target
      'tab:t1',     // cross-project tab
      'action:new-chat',
      'action:add-project',
      'action:settings',
      'action:refresh-models',
      'action:shortcuts',
      'action:inbox',
      'action:scheduler',
      'action:skills',
       'action:plugin-hub',
      'action:mcp',
      'action:personas',
      'action:overview',
      'open-window:p1'
    ]);
  });

  it('Show all agents opens the Agents dashboard, not Projects home', () => {
    const setNav = vi.fn();
    const item = buildPaletteItems(baseCtx({ setNav })).find((i) => i.key === 'action:overview');
    expect(item).toBeTruthy();
    item!.run();
    expect(setNav).toHaveBeenCalledWith('agents');
  });

  it('New Chat opens Home', () => {
    const setNav = vi.fn();
    const item = buildPaletteItems(baseCtx({ setNav })).find((i) => i.key === 'action:new-chat');
    expect(item?.label).toBe('New Chat');
    item!.run();
    expect(setNav).toHaveBeenCalledWith('home');
  });

  it('shows the ⌘, hint on Open Settings only when not drilled into a project', () => {
    const hint = (projectId: string | null) =>
      buildPaletteItems(baseCtx({ projectId })).find((i) => i.key === 'action:settings')?.hint;
    expect(hint(null)).toBe('⌘,');
    // Drilled in, ⌘, opens the project's Settings, so the global row drops it.
    expect(hint('p1')).toBeUndefined();
    // A focus left on a removed project: ⌘, opens global Settings, so keep the hint.
    expect(hint('gone')).toBe('⌘,');
  });

  it('opens global Settings with its own navigation after leaving project focus', () => {
    const exitProjectFocus = vi.fn();
    vi.mocked(useUi.getState).mockReturnValue({ exitProjectFocus, enterProjectFocus: () => {} } as never);
    const onClose = vi.fn();
    buildPaletteItems(baseCtx({ onClose })).find((item) => item.key === 'action:settings')!.run();
    expect(exitProjectFocus).toHaveBeenCalledWith('/settings');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens Skills, Plugins, and MCP on the Extensions workspace', () => {
    const setNav = vi.fn();
    const setExtensionsTab = vi.fn();
    const items = buildPaletteItems(baseCtx({ setNav, setExtensionsTab }));

    items.find((i) => i.key === 'action:skills')!.run();
    expect(setNav).toHaveBeenCalledWith('extensions');
    expect(setExtensionsTab).toHaveBeenCalledWith('skills');

    items.find((i) => i.key === 'action:plugin-hub')!.run();
    expect(setNav).toHaveBeenCalledWith('extensions');
    expect(setExtensionsTab).toHaveBeenCalledWith('installed');

    items.find((i) => i.key === 'action:mcp')!.run();
    expect(setNav).toHaveBeenCalledWith('extensions');
    expect(setExtensionsTab).toHaveBeenCalledWith('mcp');
  });

  it('opening a project from the palette focuses that workspace', () => {
    const enterProjectFocus = vi.fn();
    vi.mocked(useUi.getState).mockReturnValue({
      exitProjectFocus: () => {},
      enterProjectFocus
    } as never);
    const item = buildPaletteItems(baseCtx()).find((i) => i.key === 'project:p1');
    expect(item).toBeTruthy();
    item!.run();
    expect(enterProjectFocus).toHaveBeenCalledWith('p1');
  });

  it('tags every item with a category and source', () => {
    const items = buildPaletteItems(baseCtx());
    for (const it of items) {
      expect(it.category).toBeTruthy();
      expect(it.source).toBe('core');
    }
    expect(items.find((i) => i.key === 'project:p1')!.category).toBe('Projects');
    expect(items.find((i) => i.key === 'tab:t1')!.category).toBe('Tabs');
    expect(items.find((i) => i.key === 'action:settings')!.category).toBe('Actions');
  });

  it('adapts extension commands: namespaced key, category, icon fallback, when-gating', () => {
    const mod: AppModule = {
      id: 'demo',
      title: 'Demo',
      icon: 'Box',
      commands: () => [
        { id: 'always', label: 'Always', run: noop },
        { id: 'whenable', label: 'Only with project', run: noop, when: 'hasActiveProject', category: 'Demo Group' },
        { id: 'hidden', label: 'Hidden', run: noop, when: 'panelFocused' },
        { id: 'badwhen', label: 'Malformed when', run: noop, when: 'unknownKey ==' }
      ]
    };
    const items = buildPaletteItems(baseCtx({ modules: [mod] }));
    const extKeys = items.filter((i) => i.category === 'Extensions').map((i) => i.key);
    expect(extKeys).toContain('ext:demo:always');
    expect(extKeys).toContain('ext:demo:whenable');
    expect(extKeys).not.toContain('ext:demo:hidden');   // when=panelFocused → false
    expect(extKeys).not.toContain('ext:demo:badwhen');  // malformed → fail-closed
    const whenable = items.find((i) => i.key === 'ext:demo:whenable')!;
    expect(whenable.source).toBe('Demo Group'); // category override → sub-group label
    const always = items.find((i) => i.key === 'ext:demo:always')!;
    expect(always.source).toBe('Demo'); // defaults to module title
  });

  it('a throwing commands() factory is skipped, not fatal', () => {
    const good: AppModule = { id: 'good', title: 'Good', icon: 'Box', commands: () => [{ id: 'c', label: 'C', run: noop }] };
    const bad: AppModule = { id: 'bad', title: 'Bad', icon: 'Box', commands: () => { throw new Error('boom'); } };
    const keys = buildPaletteItems(baseCtx({ modules: [bad, good] })).map((i) => i.key);
    expect(keys).toContain('ext:good:c');
    expect(keys.some((k) => k.startsWith('ext:bad:'))).toBe(false);
  });

  it('appends definePluginApp commandPaletteAction rows under Extensions', () => {
    const keys = buildPaletteItems(
      baseCtx({
        commandPaletteActions: [
          {
            id: 'open',
            pluginId: 'pr-monitor',
            generation: 1,
            title: 'Open PR Monitor',
            run: () => undefined
          }
        ]
      })
    ).map((i) => i.key);
    expect(keys).toContain('plugin:pr-monitor/open');
  });
});

vi.mock('../../../lib/split-layout/paneCommands.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/split-layout/paneCommands.js')>();
  return { ...actual, runPaneCommand: vi.fn(() => true) };
});
import { runPaneCommand } from '../../../lib/split-layout/paneCommands.js';

describe('buildPaletteItems — split pane commands', () => {
  it('omits pane actions unless a split workspace accepts them', () => {
    const keys = buildPaletteItems(baseCtx()).map((i) => i.key);
    expect(keys.some((k) => k.startsWith('action:pane.'))).toBe(false);
  });

  it('falls back to the help text for an unbound pane action', () => {
    localStorage.setItem('zcc.keyboard-overrides', JSON.stringify([{ command: 'pane.close', shortcut: null }]));
    try {
      const item = buildPaletteItems(baseCtx({ splitPaneCommands: true })).find((i) => i.key === 'action:pane.close');
      expect(item?.hint).toBe('Close the focused split pane when more than one is open.');
    } finally {
      localStorage.removeItem('zcc.keyboard-overrides');
    }
  });

  it('lists named pane actions, closing the palette before running', () => {
    const onClose = vi.fn();
    const items = buildPaletteItems(baseCtx({ splitPaneCommands: true, onClose }));
    const pane = items.filter((i) => i.key.startsWith('action:pane.'));
    expect(pane.map((i) => i.key)).toEqual([
      'action:pane.focus.left',
      'action:pane.focus.right',
      'action:pane.focus.up',
      'action:pane.focus.down',
      'action:pane.focus.previous',
      'action:pane.focus.next',
      'action:pane.maximize.toggle',
      'action:pane.close'
    ]);
    expect(pane.every((i) => i.category === 'Actions' && i.hint)).toBe(true);
    vi.useFakeTimers();
    try {
      pane.find((i) => i.key === 'action:pane.close')!.run();
      expect(onClose).toHaveBeenCalledOnce();
      // Deferred past the palette's unmount and focus restore.
      expect(runPaneCommand).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(runPaneCommand).toHaveBeenCalledWith('pane.close');
    } finally {
      vi.useRealTimers();
    }
  });
});
