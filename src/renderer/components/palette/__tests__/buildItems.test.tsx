import { describe, it, expect, vi } from 'vitest';
import { buildPaletteItems, type PaletteBuildContext } from '../buildItems.js';
import type { WhenContext } from '../whenContext.js';
import type { AppModule } from '@shared/module-api';
import type { Project, TerminalSession, ScheduledTask, Persona } from '@shared/types';

// The builder calls getHost(moduleId) for any module that contributes commands;
// stub the module-host bridge so we don't pull in the live store/IPC wiring.
vi.mock('../../../modules/ModulePanelHost', () => ({
  getHost: (id: string) => ({ moduleId: id, toast: () => {} })
}));
// The builder imports `useUi` only for imperative `.getState()` calls inside
// run handlers — never at build time — but the module-load still resolves it.
vi.mock('../../../store', async () => {
  return {
    useUi: { getState: () => ({}) },
    visibleTerminals: (list: TerminalSession[] | undefined) => list ?? []
  };
});
const noop = () => {};
const asyncNoop = async () => null;

const whenCtx: WhenContext = {
  activeNav: 'projects',
  hasActiveProject: true,
  hasActiveTab: true,
  tabCount: 1,
  activeTabStatus: 'running',
  activeTabProfile: 'claude',
  workspaceMode: 'terminals',
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
    setWorkspaceMode: noop,
    setSettingsTab: noop,
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
  it('golden snapshot: full set of built-in keys with a project + tab', () => {
    const keys = buildPaletteItems(baseCtx()).map((i) => i.key);
    expect(keys).toEqual([
      'project:p1',
      'tab:t1',
      'action:add-project',
      'action:settings',
      'action:shortcuts',
      'action:inbox',
      'action:scheduler',
      'action:skills',
      'action:plugins',
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
      'action:add-project',
      'action:settings',
      'action:shortcuts',
      'action:inbox',
      'action:scheduler',
      'action:skills',
      'action:plugins',
      'action:mcp',
      'action:personas',
      'action:overview',
      'open-window:p1'
    ]);
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
});

