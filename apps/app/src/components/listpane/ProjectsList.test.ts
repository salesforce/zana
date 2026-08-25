import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reorderProjectIds } from './projectReordering.js';

describe('reorderProjectIds', () => {
  it('moves a project inside its visible group without disturbing other groups', () => {
    expect(reorderProjectIds(['favorite', 'local-a', 'remote', 'local-b'], ['local-a', 'local-b'], 'local-b', 'local-a')).toEqual([
      'favorite',
      'local-b',
      'remote',
      'local-a'
    ]);
  });

  it('does not change the order when either project is outside the group', () => {
    const ids = ['favorite', 'local-a', 'remote'];
    expect(reorderProjectIds(ids, ['local-a'], 'favorite', 'local-a')).toBe(ids);
  });
});

describe('project-row workspace actions', () => {
  it('uses the chat-plus affordance and opens the project workspace', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<MessageCirclePlus size={14} />');
    expect(source).toContain('enterProjectFocus(p.id);\n    setLauncherOpen(true);');
  });

  it('opens a workspace directly from its project row', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (consumeProjectClick()) return;');
    expect(source).toContain('enterProjectFocus(p.id);');
  });

  it('opens the shared agent lifecycle menu from a nested session row', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onContextMenu={(e) => openAgentCardMenu(e, t, p)}');
    expect(source).toContain('useAgentCardActions()');
    expect(source).toContain('<AgentCardMenu menu={agentMenu}');
    expect(source).toContain('setAgentMenu(null)');
  });

  it('lets nested agent rows fill the workspace panel on hover', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.project-terminal-row {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  width: 100%;');
  });

  it('keeps nested session rows on a short tree indent in the sidebar', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.sidebar-projects .project-terminals {\n  /* Sit just past the project color-dot, not under the name. The old 38px\n     inset plus the nested-panel padding ate a full icon column in the rail. */\n  margin: 1px 0 4px 8px;');
    expect(css).not.toContain('margin: 3px 3px 6px 38px');
    expect(css).not.toContain('margin: 3px 6px 8px 34px');
  });

  it('places the session disclosure chevron after the project name so row dots stay aligned', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(source).toContain(
      '{projectDot}\n                    {projectMeta}\n                  </button>\n                  {treeChevron}'
    );
    expect(source).toContain('className="project-rename"');
    const renameIdx = source.indexOf('className="project-rename"');
    const renameChevronIdx = source.indexOf('{treeChevron}', renameIdx);
    expect(renameChevronIdx).toBeGreaterThan(renameIdx);
    expect(css).toContain('.project-label {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  min-width: 0;\n  flex: 1 1 auto;\n}');
    expect(css).toContain('.project-label .project-select {\n  flex: 0 1 auto;\n}');
  });

  it('Overview opens the Agents dashboard instead of an unfocused Projects home', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain("setNav('agents')");
  });

  it('Project settings… opens the project settings route, not global Settings', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('openProjectSettings(p.id)');
    expect(source).not.toContain("setSettingsTab('project');\n                  setNav('settings')");
  });
});

describe('project-row compact chrome', () => {
  it('drags from the name/chevron label instead of a 6-dot grip', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('GripVertical');
    expect(source).not.toContain('project-reorder-handle');
    expect(source).toContain('<div className={labelClass} {...listeners}>');
    expect(source).toContain('{...attributes}');
    expect(source).toContain('project-label--sortable');
    expect(source).toContain('consumeProjectClick()');
    expect(source).toContain('POST_DRAG_CLICK_SUPPRESS_MS');
    expect(source).toContain('onDragStart={onProjectDragStart}');
  });

  it('renders project actions before the new-agent control', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    const actionsIdx = source.indexOf('className="project-actions"');
    const spawnIdx = source.indexOf('className="project-spawn"');
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(actionsIdx);
  });

  it('flushes row actions to the trailing edge and uses a grab cursor when sortable', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).not.toContain('.project-reorder-handle');
    expect(css).toContain('.project-item {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 5px 2px 5px 8px;');
    expect(css).toContain('.sidebar-projects .project-item {\n  min-width: 0;\n  padding: 5px 2px 5px 6px;');
    expect(css).toContain('.project-label--sortable {\n  cursor: grab;\n  touch-action: none;');
    expect(css).toContain('.project-group.is-dragging .project-label--sortable {\n  cursor: grabbing;');
  });
});

describe('sidebar workspace scrolling', () => {
  it('keeps the workspace tree as the sidebar scroll owner', () => {
    const source = readFileSync(
      new URL('../../styles/global.css', import.meta.url),
      'utf8'
    );
    expect(source).toContain('.sidebar-sections {\n  display: flex;');
    expect(source).toContain('.sidebar-sections {\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  min-height: 0;\n  overflow: hidden;');
    expect(source).toContain('.sidebar-projects-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;');
    expect(source).toContain('.sidebar-projects {\n  position: relative;\n  display: flex;\n  /* This section moves with the rest of the sidebar. Its cap must use a concrete');
    expect(source).toContain('flex: 0 1 min(320px, 42vh);');
    expect(source).toContain('max-height: min(320px, 42vh);');
    expect(source).toContain('margin: 12px 0 0;');
    expect(source).toContain('.sidebar-section-sortable {\n  display: flex;\n  flex: 0 0 auto;\n  flex-direction: column;');
    expect(source).toContain('.sidebar-projects--collapsed {\n  flex: 0 0 auto;\n  min-height: 0;\n  /* An open workspace tree belongs at the rail bottom; a collapsed heading is');
    expect(source).toContain('margin-top: 12px;');
    expect(source).toContain('.sidebar-agents--collapsed {\n  /* Hug the heading. A fixed 36px basis (header min-height + padding) plus\n   * Workspaces\' collection margin left a dead band between two collapsed rows. */\n  flex: 0 0 auto;\n  height: auto;');
    expect(source).toContain('.sidebar-agents--collapsed .sidebar-agents-header,\n.sidebar-projects--collapsed .sidebar-projects-header {\n  padding-bottom: 0;\n}');
    expect(source).toContain('.sidebar-section-sortable:has(.sidebar-agents--collapsed) + .sidebar-section-sortable .sidebar-projects,\n.sidebar-section-sortable:has(.sidebar-projects--collapsed) + .sidebar-section-sortable .sidebar-agents {\n  margin-top: 0;\n}');
    expect(source).toContain('.sidebar-nav--sortable {\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  gap: 2px;\n  min-width: 0;\n  min-height: 0;\n  overflow: hidden;');
    expect(source).toContain('.sidebar-section-sortable:last-child:has(.sidebar-projects:not(.sidebar-projects--collapsed)),\n.sidebar-section-sortable:last-child:has(.sidebar-agents:not(.sidebar-agents--collapsed)) {\n  flex: 1 1 auto;\n}');
    expect(source).toContain('.sidebar-section-sortable:last-child:has(.sidebar-projects:not(.sidebar-projects--collapsed)) .sidebar-projects,\n.sidebar-section-sortable:last-child:has(.sidebar-agents:not(.sidebar-agents--collapsed)) .sidebar-agents {\n  flex: 1 1 auto;\n  max-height: none;\n  height: auto;\n}');
    expect(source).toContain('.sidebar-section-sortable:last-child:has(.sidebar-agents) .sidebar-agents-resizer {\n  display: none;\n}');
  });

  it('keeps collection header actions at heading density', () => {
    const css = readFileSync(
      new URL('../../styles/global.css', import.meta.url),
      'utf8'
    );
    const tsx = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(css).toContain('.sidebar-agents-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  min-height: 30px;\n  padding: 0 0 6px 8px;\n}');
    expect(css).toContain('.sidebar-projects-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  min-height: 30px;\n  padding: 0 0 6px 8px;\n}');
    expect(css).toContain('.sidebar-projects .icon-btn {\n  width: 22px;\n  height: 22px;\n  padding: 0;\n  border: 0;');
    expect(css).toContain('.sidebar-agents-actions .icon-btn {\n  width: 22px;\n  height: 22px;\n  padding: 0;\n  border: 0;');
    expect(css).toContain('.icon-btn {\n  display: grid;\n  place-items: center;');
    expect(css).toContain('.icon-btn svg {\n  display: block;\n}');
    expect(tsx).toContain('<ListFilter size={14} />');
    expect(tsx).toContain('<MoreHorizontal size={14} />');
    expect(tsx).toContain('<Plus size={14} />');
  });
});

describe('sidebar workspace header menus', () => {
  it('dismisses the add and organize popovers on outside mousedown and Escape', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (!sidebarAddOpen && !sidebarOrganizeOpen) return;');
    expect(source).toContain('sidebarAddRef.current?.contains(t) || sidebarOrganizeRef.current?.contains(t)');
    expect(source).toContain("if (e.key === 'Escape')");
    expect(source).toContain('setSidebarAddOpen(false);\n        setSidebarOrganizeOpen(false);');
    expect(source).toContain('anchorTop: rect.top');
    expect(source).toContain('const openAbove = spaceBelow < menu.height + MENU_GAP && spaceAbove > spaceBelow');
    expect(source).toContain('placeFixedMenu(menuEl, button.getBoundingClientRect())');
  });

  it('keeps header menus in a fixed layer so a collapsed heading cannot clip them', () => {
    const css = readFileSync(
      new URL('../../styles/global.css', import.meta.url),
      'utf8'
    );
    expect(css).toContain('.sidebar-projects-add-menu {\n  position: fixed;\n  z-index: 20;');
    expect(css).toContain('.sidebar-projects-organize-menu {\n  position: fixed;\n  z-index: 20;');
  });
});

describe('workspace move up/down', () => {
  it('opts into manual order instead of disabling Move up/down on Recents', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain("if (inSidebar && sidebarProjectSort !== 'manual') setSidebarSort('manual')");
    expect(source).toContain('const canReorder = !scopedProjectId && !filter.trim() && !hideIdleProjects;');
    expect(source).not.toContain("hideIdleProjects && (!inSidebar || sidebarProjectSort === 'manual')");
  });

  it('does not dismiss the project menu on mousedown inside it', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (menuRef.current?.contains(t)) return;');
    expect(source).toContain("if (e.key === 'Escape') setMenu(null);");
    expect(source).not.toContain('const close = () => setMenu(null);');
  });
});

describe('nested live threads', () => {
  it('nests live agents and recent threads under the owning project', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain('railThreadsForProject');
    expect(source).toContain('threadIsLiveForRail');
    expect(source).toContain('data-testid="project-thread-row"');
    expect(source).toContain('navigate(getThreadRoutePath(thread.id))');
    expect(source).toContain('railThreadsByProject.get(p.id)');
    expect(source).toContain('liveList.length === 0 && railThreads.length === 0');
    expect(source).toContain('p.id === selectedId && projectHasNestableSessions(p)');
    expect(source).toContain('<ProviderIcon providerId={thread.providerId}');
    expect(source).not.toContain('MessageSquare');
  });
});

describe('workspace row badge', () => {
  it('omits git branch and shows the nested agent count instead', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('project-git-branch');
    expect(source).not.toContain('project-git-ahead');
    expect(source).not.toContain('gitStatus[p.id]');
    expect(source).toContain('liveList.length + railThreads.length');
    expect(source).toContain('className="project-badge"');
    expect(source).toContain('{nestedCount}');
  });

  it('does not mark a workspace row as selected — hover is the only highlight', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(source).toContain('className="project-item"');
    expect(source).not.toContain("selectedId === p.id ? 'active'");
    expect(css).toContain('.project-item:hover {\n  background: var(--bg-hover);\n}');
    expect(css).not.toContain('.project-item.active {\n  background: var(--bg-elevated);\n}');
    expect(css).not.toContain('.project-item.active .project-spawn');
    expect(css).not.toContain('.project-item.active .project-actions');
  });
});
