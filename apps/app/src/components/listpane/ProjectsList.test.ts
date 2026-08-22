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
    expect(source).toContain('onClick={() => enterProjectFocus(p.id)}');
  });

  it('Overview opens the Agents dashboard instead of an unfocused Projects home', () => {
    const source = readFileSync(new URL('./ProjectsList.tsx', import.meta.url), 'utf8');
    expect(source).toContain("setNav('agents')");
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
    expect(source).toContain('preferAbove: sidebarProjectsCollapsed');
    expect(source).toContain('y: sidebarProjectsCollapsed ? rect.top : rect.bottom');
  });

  it('opens collapsed Workspaces header menus above the heading', () => {
    const css = readFileSync(
      new URL('../../styles/global.css', import.meta.url),
      'utf8'
    );
    expect(css).toContain('.sidebar-projects--collapsed {\n  flex: 0 0 auto;\n  min-height: 0;');
    expect(css).toContain('overflow: visible;');
    expect(css).toContain('.sidebar-projects--collapsed .sidebar-projects-add-menu,\n.sidebar-projects--collapsed .sidebar-projects-organize-menu {\n  top: auto;\n  bottom: calc(100% + 4px);\n  z-index: 20;\n}');
  });
});
