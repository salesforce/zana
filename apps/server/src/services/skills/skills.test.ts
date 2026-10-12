import { beforeEach, expect, it, vi } from 'vitest';
import { listSkills } from './skills.js';

const state = vi.hoisted(() => ({ discover: vi.fn(), disabled: vi.fn() }));
vi.mock('electron', () => ({ shell: { openPath: vi.fn() } }));
vi.mock('./skill-settings.js', () => ({ disabledSkillNames: state.disabled }));
vi.mock('../skill-providers/registry.js', () => ({
  entryId: (tool: string, source: string, qualified: string) => `${tool}:${source}:${qualified}`,
  SKILL_PROVIDERS: [{ id: 'fixture', label: 'Fixture', discover: state.discover,
    toggleState: (unit: {shortName: string}, disabled: Set<string>) => ({ supported: true, enabled: !disabled.has(unit.shortName) }) }]
}));
beforeEach(() => { vi.clearAllMocks(); state.disabled.mockResolvedValue(new Set(['review'])); });

it('projects invocation metadata and distinguishes command IDs while retaining rule and project entries', async () => {
  state.discover.mockImplementation(async (source: string) => [{
    kind: source === 'plugin' ? 'command' : source === 'project' ? 'rule' : 'skill',
    path: `/fixture/${source}/review`, shortName: 'review', qualifiedName: 'group/review', source,
    linked: true, parsed: { description: 'Review', userInvocable: false, disableModelInvocation: true, allowedTools: ['Read'] }
  }]);
  const entries = await listSkills({ projectPath: '/project', projectId: 'p1' });
  expect(entries).toEqual([
    expect.objectContaining({ id: 'fixture:user:group/review', kind: 'skill', linked: true,
      userInvocable: false, disableModelInvocation: true, enabled: false, allowedTools: ['Read'], projectId: undefined }),
    expect.objectContaining({ id: 'command:fixture:plugin:group/review', kind: 'command', projectId: undefined }),
    expect.objectContaining({ id: 'fixture:project:group/review', kind: 'rule', projectId: 'p1' })
  ]);
  expect(state.discover).toHaveBeenCalledWith('project', { projectPath: '/project' });
});

it('does not scan project roots without both the authorized project path and identity', async () => {
  state.discover.mockResolvedValue([]);
  await listSkills({ projectPath: '/project' });
  expect(state.discover.mock.calls.map(([source]) => source)).toEqual(['user', 'plugin']);
});
