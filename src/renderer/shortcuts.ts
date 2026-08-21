import { useData, useUi, usePersonas, sortProjectsForDisplay } from './store';
import { getTerminal } from './util/findRegistry';
import { projectDefaultLaunch, type ProjectDefaultLaunch } from './util/launchProfile';

/** The project's one-click "+" default: a pinned persona (on its baseProfile)
 *  or the profile default. Shared with TabBar / the menu so ⌘T agrees. */
function defaultLaunchForProject(projectId: string): ProjectDefaultLaunch {
  const project = useData.getState().projects.find((p) => p.id === projectId);
  if (!project) return { profile: 'claude' };
  if (project.launchDefault?.kind === 'exact-profile') {
    return { profile: project.launchDefault.profileId };
  }
  return projectDefaultLaunch(project, usePersonas.getState().personas);
}

function isMac() {
  return navigator.platform.toUpperCase().includes('MAC');
}

function mod(e: KeyboardEvent) {
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function installShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!mod(e)) return;

    const ui = useUi.getState();
    const data = useData.getState();
    const projectId = ui.selectedProjectId;
    const tabs = projectId ? data.terminals[projectId] || [] : [];
    const activeTabId = projectId ? ui.selectedTabId[projectId] : undefined;
    const activeIdx = activeTabId ? tabs.findIndex((t) => t.id === activeTabId) : -1;

    // cmd+b — toggle terminals/explorer mode (flips between the two
    // text-editing modes).
    if (e.key === 'b' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      const cur = ui.workspaceMode[projectId] ?? 'terminals';
      ui.setWorkspaceMode(projectId, cur === 'explorer' ? 'terminals' : 'explorer');
      return;
    }
    // cmd+p — project switcher / command palette
    if (e.key === 'p' && !e.shiftKey) {
      e.preventDefault();
      ui.setPaletteOpen(true);
      return;
    }
    // cmd+e — quick open file in selected project
    if (e.key === 'e' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      ui.setQuickOpenOpen(true);
      return;
    }
    // cmd+r — resume Claude session picker
    if (e.key === 'r' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      ui.setResumeOpen(true);
      return;
    }
    // cmd+shift+r — restart active terminal (kill+respawn for live, or
    // resurrect for exited). Pairs with cmd+w (close) so revival is one
    // chord; especially useful after a dev server crashes mid-session.
    if ((e.key === 'R' || (e.key === 'r' && e.shiftKey)) && e.shiftKey) {
      if (!projectId || !activeTabId) return;
      const active = tabs.find((t) => t.id === activeTabId);
      if (!active) return;
      e.preventDefault();
      const live = active.status !== 'exited';
      if (live && !window.confirm(`Kill and restart "${active.title}"?`)) return;
      data.restartTerminal(activeTabId, projectId).catch(() => {});
      return;
    }
    // cmd+, — toggle Settings
    if (e.key === ',') {
      e.preventDefault();
      ui.setNav(ui.nav === 'settings' ? 'home' : 'settings');
      return;
    }
    // cmd+. — close the agent detail modal. Escape is reserved for the embedded
    // terminal's interrupt (the only way to cancel Claude mid-task), so the
    // inspector gets its own dismiss chord. No-op when no modal is open.
    if (e.key === '.') {
      if (!ui.agentModal) return;
      e.preventDefault();
      ui.closeAgentModal();
      return;
    }
    // cmd+i — toggle Inbox. Returns to Home when already on inbox so it
    // works as a single round-trip key from anywhere in the app.
    if (e.key === 'i' && !e.shiftKey) {
      e.preventDefault();
      ui.setNav(ui.nav === 'inbox' ? 'home' : 'inbox');
      return;
    }
    // cmd+o — jump to the Agents dashboard (kanban). Exits any opened
    // project; from anywhere it lands you on the board.
    if (e.key === 'o' && !e.shiftKey) {
      e.preventDefault();
      if (ui.nav !== 'agents') ui.setNav('agents');
      ui.exitProjectFocus();
      return;
    }
    // cmd+j — toggle Scheduler. Round-trip back to Home when already on
    // scheduler so it works as a single key from anywhere.
    if (e.key === 'j' && !e.shiftKey) {
      e.preventDefault();
      ui.setNav(ui.nav === 'scheduler' ? 'home' : 'scheduler');
      return;
    }
    // cmd+/ or cmd+? — keyboard shortcuts help
    if (e.key === '/' || e.key === '?') {
      e.preventDefault();
      ui.setShortcutsOpen(!ui.shortcutsOpen);
      return;
    }
    // cmd+shift+f — search file contents in selected project
    if ((e.key === 'F' || e.key === 'f') && e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      ui.setSearchOpen(true);
      return;
    }
    // cmd+shift+g — toggle explorer Changes view (only meaningful in
    // explorer mode; no-op in terminal mode so we don't clobber chrome).
    if ((e.key === 'G' || e.key === 'g') && e.shiftKey) {
      if (!projectId) return;
      const mode = ui.workspaceMode[projectId] ?? 'terminals';
      if (mode !== 'explorer') return;
      e.preventDefault();
      ui.toggleExplorerTreeMode(projectId);
      return;
    }
    // cmd+d — toggle diff-vs-HEAD on the open file. Same gating: only fires
    // when the explorer is the active surface.
    if (e.key === 'd' && !e.shiftKey) {
      if (!projectId) return;
      const mode = ui.workspaceMode[projectId] ?? 'terminals';
      if (mode !== 'explorer') return;
      if (!ui.explorerFile[projectId]) return;
      e.preventDefault();
      ui.toggleExplorerDiff(projectId);
      return;
    }
    // cmd+f — find in terminal
    if (e.key === 'f' && !e.shiftKey) {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      ui.setFindOpen(true);
      return;
    }
    // cmd+k — clear active terminal scrollback
    if (e.key === 'k' && !e.shiftKey) {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      getTerminal(activeTabId)?.clear();
      return;
    }
    // cmd+t — new tab using the project's one-click default: a pinned default
    // persona (on its baseProfile) or the default profile (falls back to
    // 'claude' when neither is set).
    if (e.key === 't' && !e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      const launch = defaultLaunchForProject(projectId);
      data.createTerminal(projectId, launch.profile, 80, 24, {
        personaId: launch.personaId,
        profileSource: 'seeded-default'
      }).then((s) => {
        if (s) ui.selectTab(projectId, s.id);
      }).catch(() => {});
      return;
    }
    // cmd+shift+d — duplicate active tab (same launch profile)
    if ((e.key === 'D' || (e.key === 'd' && e.shiftKey)) && e.shiftKey) {
      if (!projectId || !activeTabId) return;
      const active = tabs.find((t) => t.id === activeTabId);
      if (!active) return;
      e.preventDefault();
      data.createTerminal(projectId, active.profile, 80, 24).then((s) => {
        if (s) ui.selectTab(projectId, s.id);
      }).catch(() => {});
      return;
    }
    // cmd+shift+t — bring back the last removed tab. Prefer resuming the most
    // recently detached (background) session — that restores the live pty with
    // its scrollback — and fall back to reopening the last closed tab (a fresh
    // pty) when nothing is detached. This matches the browser/editor muscle
    // memory that ⌘⇧T undoes your last tab removal.
    if ((e.key === 'T' || (e.key === 't' && e.shiftKey)) && e.shiftKey) {
      if (!projectId) return;
      e.preventDefault();
      data.restoreLastDetached(projectId).then((restored) => {
        if (restored) return; // a background session was resumed
        data.reopenLastClosed(projectId).then((s) => {
          if (s) ui.selectTab(projectId, s.id);
        }).catch(() => {});
      }).catch(() => {});
      return;
    }
    // cmd+shift+w — DELETE the current tab: terminate the process and remove
    // it. The keyboard counterpart to right-click → Delete (⌘W only hides, so
    // without this there'd be no keyboard path to actually end a process).
    // Confirm for a live session so a stray chord can't kill a running agent;
    // an exited tombstone is dismissed without a prompt. ⌘⇧T reopens.
    if ((e.key === 'W' || (e.key === 'w' && e.shiftKey)) && e.shiftKey) {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      const active = tabs.find((t) => t.id === activeTabId);
      if (active?.pinned) return;
      if (
        active &&
        active.status !== 'exited' &&
        !window.confirm(`Delete “${active.title}”? The process will be terminated.`)
      ) {
        return;
      }
      data.closeTerminal(activeTabId, projectId).catch(() => {});
      return;
    }
    // cmd+w — hide the current tab (does NOT kill the process). A live session
    // detaches to the background, resumable from the + menu or ⌘⇧T; an exited
    // tombstone is just dismissed. Terminating a process is only ever via the
    // tab's right-click → Delete. Non-destructive, so no confirm.
    if (e.key === 'w' && !e.shiftKey) {
      if (!projectId || !activeTabId) return;
      e.preventDefault();
      const active = tabs.find((t) => t.id === activeTabId);
      if (active?.pinned) return;
      if (active && active.status !== 'exited') {
        data.hideTerminal(activeTabId, projectId).catch(() => {});
      } else {
        data.closeTerminal(activeTabId, projectId).catch(() => {});
      }
      return;
    }
    // cmd+1..9 (or cmd+shift+1..9) — switch tab / project.
    // Use e.code so shift+digit (which yields !@#…) still matches.
    const digitMatch = /^Digit([1-9])$/.exec(e.code);
    if (digitMatch) {
      const idx = parseInt(digitMatch[1], 10) - 1;
      if (e.shiftKey) {
        const ordered = sortProjectsForDisplay(data.projects);
        const target = ordered[idx];
        if (!target) return;
        e.preventDefault();
        ui.selectProject(target.id);
        return;
      }
      if (!projectId || !tabs[idx]) return;
      e.preventDefault();
      ui.selectTab(projectId, tabs[idx].id);
      return;
    }
    // cmd+] / cmd+[ — next/prev tab; with shift, next/prev project.
    if (e.key === ']' || e.key === '[') {
      const dir = e.key === ']' ? 1 : -1;
      if (e.shiftKey) {
        const ordered = sortProjectsForDisplay(data.projects);
        if (ordered.length === 0) return;
        e.preventDefault();
        const curIdx = projectId ? ordered.findIndex((p) => p.id === projectId) : -1;
        const next = ((curIdx < 0 ? 0 : curIdx + dir) + ordered.length) % ordered.length;
        ui.selectProject(ordered[next].id);
        return;
      }
      if (!projectId || tabs.length === 0) return;
      e.preventDefault();
      const next = (activeIdx + dir + tabs.length) % tabs.length;
      ui.selectTab(projectId, tabs[next].id);
      return;
    }
  };

  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
