import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, Folder, Globe, Slash, CornerDownLeft } from 'lucide-react';
import { useData, useScheduler, usePersonas, useUi, visibleTerminals } from '../store';
import type { LaunchProfileId, WalkedFile, SlashCommand, SshHostEntry, Project, Persona } from '@shared/types';
import { fuzzyScore } from '../util/fuzzy';
import { projectDefaultProfile } from '../util/launchProfile';
import { isClaudeProfile } from '@shared/launch-provider';
import { useMergedModules } from '../modules';
import { buildPaletteItems, type PaletteItem, type PaletteCategory } from './palette/buildItems';
import { highlightMatches } from './palette/highlight';
import type { WhenContext } from './palette/whenContext';
import { isScopedWindow } from '../util/windowScope';
import { recordUse, recencyBoost, getRecents } from '../util/paletteRecents';

interface Props {
  onClose: () => void;
}

// Empty-query (landing) view caps for the UNBOUNDED categories, so a long
// project/tab list doesn't bury the fixed Actions. Categories absent here
// (Actions, Extensions) are shown in full. Typing lifts the cap entirely.
const EMPTY_CATEGORY_CAP: Partial<Record<PaletteCategory, number>> = {
  Projects: 5,
  Tabs: 5
};

/** A scored command row (typed-query mode). `labelMatchIdx` is set only when
 *  the *label itself* produced the winning score, so highlighting never paints
 *  positions from a hint/keyword-derived match. */
interface ScoredRow {
  item: PaletteItem;
  labelMatchIdx?: number[];
}

/** A file row in `@` mode. */
interface FileRow {
  file: WalkedFile;
  matchIdx: number[];
}

/** A destination the `#` launch mode can spawn a Claude session into: an
 *  existing project, or a bare SSH host (promoted to a remote project on
 *  launch). */
type LaunchTarget =
  | { kind: 'project'; project: Project }
  | { kind: 'host'; host: SshHostEntry };

/** A scored launch-target row in `#` mode. `matchIdx` indexes the displayed
 *  label (project name or host alias) for highlighting. */
interface LaunchRow {
  target: LaunchTarget;
  matchIdx: number[];
}

// Per-root file cache, lifetime = renderer process. Mirrors QuickOpen so the
// `@` mode reuses an already-warmed index when the user has opened QuickOpen.
const fileCache = new Map<string, WalkedFile[]>();
const FILE_MAX_RESULTS = 80;

// SSH host list, fetched once per renderer process the first time `#` launch
// mode is entered (mirrors the lazy file index). `null` = not yet loaded.
let hostCache: SshHostEntry[] | null = null;
const LAUNCH_MAX_RESULTS = 40;

const launchTargetLabel = (t: LaunchTarget): string =>
  t.kind === 'project' ? t.project.name : t.host.alias;

/** Derive a short, meaningful tab title from the opening instruction. Mirrors
 *  AgentLauncher's titleFromPrompt so `#`-launched tabs read the same. */
function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

// Per-project slash-command cache (keyed by project path; '' = no project),
// so reopening the palette paints commands instantly while a fresh list loads.
const commandCache = new Map<string, SlashCommand[]>();

export function CommandPalette({ onClose }: Props) {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const addProject = useData((s) => s.addProject);
  const addRemoteProject = useData((s) => s.addRemoteProject);
  const createTerminal = useData((s) => s.createTerminal);
  const restartTerminal = useData((s) => s.restartTerminal);
  const closeTerminal = useData((s) => s.closeTerminal);
  const reopenLastClosed = useData((s) => s.reopenLastClosed);
  const restoreLastDetached = useData((s) => s.restoreLastDetached);
  const setPinned = useData((s) => s.setPinned);
  const scheduledTasks = useScheduler((s) => s.tasks);
  const modules = useMergedModules();
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const setNav = useUi((s) => s.setNav);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const setOverviewOpen = useUi((s) => s.setOverviewOpen);
  const overviewOpen = useUi((s) => s.overviewOpen);
  const setExplorerFile = useUi((s) => s.setExplorerFile);
  const nav = useUi((s) => s.nav);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const workspaceModeMap = useUi((s) => s.workspaceMode);
  const recentFilesMap = useUi((s) => s.recentFiles);
  const pushToast = useUi((s) => s.pushToast);
  const allPersonas = usePersonas((s) => s.personas);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedProjectTabs = selectedProject ? visibleTerminals(terminals[selectedProject.id]) : [];
  // Personas offered for the selected project: builtin + global + its own.
  const personas = selectedProject
    ? allPersonas.filter(
        (p) =>
          typeof p.source !== 'object' ||
          p.source === null ||
          !('projectId' in p.source) ||
          p.source.projectId === selectedProject.id
      )
    : [];
  const activeTabId = selectedProject ? selectedTabId[selectedProject.id] : undefined;
  const activeTab = selectedProjectTabs.find((t) => t.id === activeTabId);

  const launch = async (profile: LaunchProfileId) => {
    if (!selectedProject) return;
    const session = await createTerminal(selectedProject.id, profile, 80, 24);
    if (session) {
      selectTab(selectedProject.id, session.id);
      setWorkspaceMode(selectedProject.id, 'terminals');
    }
  };

  // Launch a persona: spawn on its baseProfile (default claude) with its
  // personaId, so main applies the persona's flag layer (same as the "+").
  const launchPersona = async (persona: Persona) => {
    if (!selectedProject) return;
    const session = await createTerminal(
      selectedProject.id,
      persona.baseProfile ?? 'claude',
      80,
      24,
      { personaId: persona.id }
    );
    if (session) {
      selectTab(selectedProject.id, session.id);
      setWorkspaceMode(selectedProject.id, 'terminals');
    }
  };

  // Open a fresh Claude tab running a slash command (the command rides in as
  // the opening prompt → positional argv, handled in main).
  const launchCommand = async (invocation: string, yolo: boolean) => {
    if (!selectedProject) return;
    const profile: LaunchProfileId = yolo ? 'claude-yolo' : 'claude';
    const session = await createTerminal(selectedProject.id, profile, 80, 24, {
      prompt: invocation,
      title: invocation
    });
    if (session) {
      selectTab(selectedProject.id, session.id);
      setWorkspaceMode(selectedProject.id, 'terminals');
      setNav('projects');
    }
  };

  // Send a slash command into the focused live Claude session, as if typed.
  const sendCommandToActiveTab = (invocation: string) => {
    if (!activeTab) return;
    void window.cc.terminals.reply(activeTab.id, invocation);
    if (selectedProject) {
      setWorkspaceMode(selectedProject.id, 'terminals');
      setNav('projects');
    }
  };

  // `#` launch mode: spawn a fresh session in the resolved destination (an
  // existing project, or a bare SSH host promoted to a remote project) with
  // `body` as raw opening-prompt intent. Main resolves the effective provider
  // before turning it into argv.
  const launchInTarget = async (target: LaunchTarget, body: string) => {
    let project: Project | null;
    let profile: LaunchProfileId;
    if (target.kind === 'project') {
      project = target.project;
      profile = projectDefaultProfile(project);
    } else {
      // Reuse an existing remote project for this host if one exists, else
      // promote the bare host into one (createTerminal requires a projectId,
      // and main reads project.remote to build the ssh argv).
      const existing = projects.find((p) => p.remote?.host === target.host.alias);
      project = existing ?? await addRemoteProject({ host: target.host.alias, user: target.host.user });
      profile = project ? projectDefaultProfile(project) : 'claude';
    }
    if (!project) { pushToast('Could not open that destination', 'error'); return; }

    const trimmed = body.trim();
    const session = await createTerminal(project.id, profile, 80, 24, {
      prompt: trimmed || undefined,
      title: trimmed ? titleFromPrompt(trimmed) : undefined
    });
    if (session) {
      selectProject(project.id);
      selectTab(project.id, session.id);
      setWorkspaceMode(project.id, 'terminals');
      setNav('projects');
      onClose();
    }
  };

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sigil-prefixed modes:
  //   `@…` → file search within the selected project (needs a project)
  //   `#…` → launch a Claude session in a project / SSH host destination
  //   `/…` → Claude Code slash commands (needs a project)
  // `#` grammar: everything up to the first space is the destination token; the
  // remainder (if a space was typed) is the opening prompt. A space *commits*
  // the token, so `#parrot ` switches from picking a target to typing a task.
  const fileMode = query.startsWith('@') && selectedProject !== null;
  const fileQuery = fileMode ? query.slice(1).trim() : '';
  const launchMode = query.startsWith('#');
  const slashMode = query.startsWith('/') && selectedProject !== null;
  const launchSpaceIdx = launchMode ? query.indexOf(' ') : -1;
  const launchToken = launchMode
    ? (launchSpaceIdx >= 0 ? query.slice(1, launchSpaceIdx) : query.slice(1))
    : '';
  // A space commits the token ONLY if there's an actual token before it — a
  // stray leading space (`# foo`) must not commit to an empty token (which
  // would otherwise resolve to an arbitrary first project on Enter).
  const launchCommitted = launchSpaceIdx >= 0 && launchToken.length > 0;
  const launchBody = launchCommitted ? query.slice(launchSpaceIdx + 1) : '';
  const slashQuery = slashMode ? query.slice(1).trim() : '';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row in view when arrow-keying past the visible
  // window. `block: 'nearest'` avoids jumpy centering when the row is
  // already on-screen.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // --- file index (lazy, only once `@` mode is entered) --------------------
  const [files, setFiles] = useState<WalkedFile[] | null>(null);
  useEffect(() => {
    if (!fileMode || !selectedProject) return;
    const cached = fileCache.get(selectedProject.path);
    if (cached) {
      setFiles(cached);
      return;
    }
    let cancelled = false;
    setFiles(null);
    window.cc.fs.walkFiles(selectedProject.path)
      .then((list) => {
        if (cancelled) return;
        fileCache.set(selectedProject.path, list);
        setFiles(list);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => { cancelled = true; };
  }, [fileMode, selectedProject?.path]);

  // --- ssh hosts (lazy, only once `#` launch mode is entered) ---------------
  const [hosts, setHosts] = useState<SshHostEntry[] | null>(hostCache);
  useEffect(() => {
    if (!launchMode || hostCache) return;
    let cancelled = false;
    window.cc.ssh.listHosts()
      .then((list) => {
        if (cancelled) return;
        hostCache = list;
        setHosts(list);
      })
      .catch(() => { if (!cancelled) { hostCache = []; setHosts([]); } });
    return () => { cancelled = true; };
  }, [launchMode]);

  // --- slash commands (loaded once per palette open, scoped to the project) -
  // Seed synchronously from the per-project cache so reopening the palette
  // paints commands immediately, then refresh in the background.
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(
    () => commandCache.get(selectedProject?.path ?? '') ?? []
  );
  useEffect(() => {
    let cancelled = false;
    window.cc.commands.list(selectedProject?.path)
      .then((cmds) => {
        if (cancelled) return;
        commandCache.set(selectedProject?.path ?? '', cmds);
        setSlashCommands(cmds);
      })
      .catch(() => { if (!cancelled) setSlashCommands([]); });
    return () => { cancelled = true; };
  }, [selectedProject?.path]);

  // --- coarse, non-sensitive context for extension `when` evaluation -------
  const whenCtx = useMemo<WhenContext>(() => {
    const platform = navigator.platform.toUpperCase().includes('MAC')
      ? 'darwin'
      : navigator.platform.toUpperCase().includes('WIN') ? 'win32' : 'linux';
    return {
      activeNav: String(nav),
      hasActiveProject: selectedProject !== null,
      hasActiveTab: activeTab !== undefined,
      tabCount: selectedProjectTabs.length,
      activeTabStatus: activeTab?.status ?? '',
      activeTabProfile: activeTab?.profile ?? '',
      workspaceMode: selectedProject ? (workspaceModeMap[selectedProject.id] ?? 'terminals') : '',
      platform,
      // Per-command override happens in the adapter; default false here.
      panelFocused: false,
      scopedWindow: isScopedWindow()
    };
  }, [nav, selectedProject, activeTab, selectedProjectTabs.length, workspaceModeMap]);

  const items = useMemo<PaletteItem[]>(() => buildPaletteItems({
    projects, terminals, selectedProject, selectedProjectTabs, activeTab,
    scheduledTasks, personas, modules, overviewOpen, whenCtx, onClose, launch,
    launchPersona, addProject, setNav, selectProject, selectTab, setWorkspaceMode,
    setSettingsTab, setOverviewOpen, setPinned, restartTerminal, closeTerminal,
    reopenLastClosed, restoreLastDetached, pushToast
  }), [projects, terminals, selectedProject, selectedProjectTabs, activeTab,
    scheduledTasks, personas, modules, overviewOpen, whenCtx, onClose, addProject, setNav,
    selectProject, selectTab, setWorkspaceMode, setSettingsTab, setOverviewOpen,
    setPinned, restartTerminal, closeTerminal, reopenLastClosed, restoreLastDetached, pushToast]);

  // --- command filtering / ranking -----------------------------------------
  const rows = useMemo<ScoredRow[]>(() => {
    if (fileMode || launchMode || slashMode) return [];
    const q = query.trim();
    if (!q) {
      // Empty query: a CURATED landing view, not the full list. Keep the
      // natural projects→tabs→actions→extensions grouping and float
      // recently/frequently used items up *within* each category, but CAP the
      // unbounded categories (Projects, Tabs) to their few most-recent so the
      // fixed Actions don't get pushed off-screen by a long project list.
      // Typing reveals everything (the typed path below scans all items).
      //
      // We group first (preserving each category's first-appearance order) then
      // stable-sort each group by boost — NOT a single global comparator, which
      // would interleave categories (fragmenting the section headers) and be
      // non-transitive against the cross-category idx comparison.
      const recents = getRecents();
      const now = Date.now();
      const groups: PaletteItem[][] = [];
      const groupByCategory = new Map<string, PaletteItem[]>();
      for (const item of items) {
        let g = groupByCategory.get(item.category);
        if (!g) { g = []; groupByCategory.set(item.category, g); groups.push(g); }
        g.push(item);
      }
      const out: ScoredRow[] = [];
      for (const g of groups) {
        const sorted = g
          .map((item, idx) => ({ item, idx, boost: recencyBoost(item.key, recents, now) }))
          .sort((a, b) => (b.boost - a.boost) || (a.idx - b.idx));
        const cap = EMPTY_CATEGORY_CAP[g[0].category];
        (cap ? sorted.slice(0, cap) : sorted).forEach(({ item }) => out.push({ item }));
      }
      return out;
    }
    const recents = getRecents();
    const now = Date.now();
    const scored: Array<{ item: PaletteItem; score: number; idx: number; boost: number; labelMatchIdx?: number[] }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lm = fuzzyScore(it.label, q);
      let score = lm?.score ?? -Infinity;
      // Highlight only when the label is the source of the chosen score.
      let labelMatchIdx: number[] | undefined = lm ? lm.matchIdx : undefined;
      if (it.hint) {
        const hm = fuzzyScore(it.hint, q);
        if (hm) {
          const hintScore = hm.score * 0.5;
          if (hintScore > score) { score = hintScore; labelMatchIdx = undefined; }
        }
      }
      if (it.keywords) {
        for (const kw of it.keywords) {
          const km = fuzzyScore(kw, q);
          if (km) {
            const kwScore = km.score * 0.5;
            if (kwScore > score) { score = kwScore; labelMatchIdx = undefined; }
          }
        }
      }
      if (score > -Infinity) {
        scored.push({ item: it, score, idx: i, boost: recencyBoost(it.key, recents, now), labelMatchIdx });
      }
    }
    // Fuzzy score dominates; recency is only a final, bounded tiebreaker.
    scored.sort((a, b) => (b.score - a.score) || (b.boost - a.boost) || (a.idx - b.idx));
    return scored.map((s) => ({ item: s.item, labelMatchIdx: s.labelMatchIdx }));
  }, [items, query, fileMode, launchMode, slashMode]);

  // How many items each capped category hides in the empty-query landing view,
  // so the section header can show a "+N more — type to search" affordance.
  // Empty only — typing lifts the caps, so there's nothing hidden to announce.
  const overflow = useMemo<Partial<Record<PaletteCategory, number>>>(() => {
    if (fileMode || launchMode || slashMode || query.trim() !== '') return {};
    const counts: Partial<Record<PaletteCategory, number>> = {};
    for (const it of items) counts[it.category] = (counts[it.category] ?? 0) + 1;
    const out: Partial<Record<PaletteCategory, number>> = {};
    for (const [cat, total] of Object.entries(counts) as [PaletteCategory, number][]) {
      const cap = EMPTY_CATEGORY_CAP[cat];
      if (cap && total > cap) out[cat] = total - cap;
    }
    return out;
  }, [items, query, fileMode, launchMode, slashMode]);

  // --- file rows (@ mode) ----------------------------------------------------
  const fileRows = useMemo<FileRow[]>(() => {
    if (!fileMode || !files) return [];
    if (!fileQuery) {
      // Empty `@`: lead with the project's MRU, then walk order.
      const recents = selectedProject ? (recentFilesMap[selectedProject.id] ?? []) : [];
      const byPath = new Map(files.map((f) => [f.path, f] as const));
      const seen = new Set<string>();
      const out: FileRow[] = [];
      for (const path of recents) {
        const f = byPath.get(path);
        if (!f) continue;
        seen.add(path);
        out.push({ file: f, matchIdx: [] });
        if (out.length >= FILE_MAX_RESULTS) return out;
      }
      for (const f of files) {
        if (seen.has(f.path)) continue;
        out.push({ file: f, matchIdx: [] });
        if (out.length >= FILE_MAX_RESULTS) break;
      }
      return out;
    }
    const out: Array<FileRow & { score: number }> = [];
    for (const file of files) {
      const r = fuzzyScore(file.rel, fileQuery);
      if (r) out.push({ file, matchIdx: r.matchIdx, score: r.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, FILE_MAX_RESULTS).map(({ file, matchIdx }) => ({ file, matchIdx }));
  }, [fileMode, files, fileQuery, selectedProject, recentFilesMap]);

  // --- launch targets (# mode) ----------------------------------------------
  // Projects (matched on name + tag) and SSH hosts (matched on alias), fuzzy-
  // ranked by the destination token. A host already backed by a project is
  // hidden so a destination shows once. In committed mode the token is fixed,
  // so the list narrows to the targets that still match it (lets the user
  // disambiguate / correct a typo without deleting the prompt).
  const launchRows = useMemo<LaunchRow[]>(() => {
    if (!launchMode) return [];
    const tok = launchToken.trim();
    const hostBacked = new Set(projects.map((p) => p.remote?.host).filter(Boolean) as string[]);
    type Scored = { row: LaunchRow; score: number; kindRank: number; idx: number };
    const scored: Scored[] = [];
    projects.forEach((project, idx) => {
      const name = fuzzyScore(project.name, tok);
      const tag = project.tag ? fuzzyScore(project.tag, tok) : null;
      // Highlight the name only when it's the field that matched; a tag-only
      // match leaves the name unhighlighted (positions wouldn't line up).
      const best = !tok ? { score: 0, matchIdx: [] as number[] }
        : (name && (!tag || name.score >= tag.score)) ? name
        : tag ? { score: tag.score, matchIdx: [] as number[] }
        : null;
      if (!best) return;
      scored.push({ row: { target: { kind: 'project', project }, matchIdx: best.matchIdx }, score: best.score, kindRank: 0, idx });
    });
    (hosts ?? []).forEach((host, idx) => {
      if (hostBacked.has(host.alias)) return; // shown as its project instead
      const m = tok ? fuzzyScore(host.alias, tok) : { score: 0, matchIdx: [] as number[] };
      if (!m) return;
      scored.push({ row: { target: { kind: 'host', host }, matchIdx: m.matchIdx }, score: m.score, kindRank: 1, idx });
    });
    // Score desc; projects before hosts on a tie; stable by original order.
    scored.sort((a, b) => (b.score - a.score) || (a.kindRank - b.kindRank) || (a.idx - b.idx));
    return scored.slice(0, LAUNCH_MAX_RESULTS).map((s) => s.row);
  }, [launchMode, launchToken, projects, hosts]);

  // The resolved target when the token is committed — what Enter launches into.
  // Resolve only when it's UNAMBIGUOUS: a single match, or an exact (case-
  // insensitive) hit on a project name/tag or host alias. When several targets
  // still fuzzy-match (e.g. `#api`), stay in the picker so the user disambiguates
  // rather than silently launching whichever sorted first.
  const committedTarget = useMemo<LaunchTarget | null>(() => {
    if (!launchCommitted || launchRows.length === 0) return null;
    if (launchRows.length === 1) return launchRows[0].target;
    const tok = launchToken.trim().toLowerCase();
    const exact = launchRows.find((r) =>
      r.target.kind === 'project'
        ? r.target.project.name.toLowerCase() === tok || r.target.project.tag?.toLowerCase() === tok
        : r.target.host.alias.toLowerCase() === tok
    );
    return exact?.target ?? null;
  }, [launchCommitted, launchRows, launchToken]);

  // Show the launch banner only when committed AND resolved to one target.
  // Committed-but-ambiguous (`#api …` matching several) falls back to the
  // picker so the user can disambiguate without deleting their prompt.
  const launchShowBanner = launchCommitted && committedTarget !== null;

  // --- slash command rows (/ mode) ------------------------------------------
  // Clean, deduped view: one row per command (no verbose " — new Claude tab"
  // suffix, no parallel ":active" row). Enter = new tab; Shift+Enter runs it in
  // the focused live Claude session when there is one.
  const slashRows = useMemo<Array<{ cmd: SlashCommand; matchIdx: number[] }>>(() => {
    if (!slashMode) return [];
    if (!slashQuery) return slashCommands.map((cmd) => ({ cmd, matchIdx: [] }));
    const out: Array<{ cmd: SlashCommand; matchIdx: number[]; score: number }> = [];
    for (const cmd of slashCommands) {
      // Score the invocation once; fall back to the description only when the
      // invocation doesn't match. Highlight indexes the invocation (the shown
      // label), so a description-only match correctly carries no highlight.
      const inv = fuzzyScore(cmd.invocation, slashQuery);
      const r = inv ?? (cmd.description ? fuzzyScore(cmd.description, slashQuery) : null);
      if (r) out.push({ cmd, matchIdx: inv?.matchIdx ?? [], score: r.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map(({ cmd, matchIdx }) => ({ cmd, matchIdx }));
  }, [slashMode, slashQuery, slashCommands]);

  const activeIsClaude =
    !!activeTab && activeTab.status !== 'exited' && isClaudeProfile(activeTab.profile);

  const chooseFile = (file: WalkedFile) => {
    if (!selectedProject) return;
    setWorkspaceMode(selectedProject.id, 'explorer');
    setExplorerFile(selectedProject.id, file.path);
    onClose();
  };

  // Complete a `#` target token into the input (Tab / Enter in picker mode):
  // fill the token and add the committing space so the user types the prompt
  // next. Tag is preferred for projects (shorter, stable); alias for hosts.
  const completeTarget = (target: LaunchTarget) => {
    const token = target.kind === 'project'
      ? (target.project.tag || target.project.name)
      : target.host.alias;
    setQuery(`#${token} `);
    inputRef.current?.focus();
  };

  const runSlash = (cmd: SlashCommand, inActiveTab: boolean) => {
    onClose();
    if (inActiveTab && activeIsClaude) sendCommandToActiveTab(cmd.invocation);
    else launchCommand(cmd.invocation, false);
  };

  const runItem = (item: PaletteItem) => {
    recordUse(item.key);
    item.run();
  };

  // Active-row count for keyboard bounds (depends on mode). Committed `#` mode
  // shows a single preview banner (1 row); picker `#` mode lists targets.
  const rowCount = fileMode
    ? fileRows.length
    : launchMode
      ? (launchShowBanner ? 1 : launchRows.length)
      : slashMode
        ? slashRows.length
        : rows.length;

  useEffect(() => {
    if (activeIdx >= rowCount) setActiveIdx(0);
  }, [rowCount, activeIdx]);

  // Reset selection to the top whenever the query changes (incl. entering /
  // leaving `@` mode) so the highlight never points at a stale row.
  useEffect(() => { setActiveIdx(0); }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    // Arrow nav wraps around top↔bottom so the highlight reads as discrete
    // row-to-row movement, not a viewport scroll that dead-ends at the edges.
    if (e.key === 'ArrowDown') { e.preventDefault(); if (rowCount) setActiveIdx((i) => (i + 1) % rowCount); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (rowCount) setActiveIdx((i) => (i - 1 + rowCount) % rowCount); return; }
    if (e.key === 'Home') { e.preventDefault(); setActiveIdx(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActiveIdx(Math.max(0, rowCount - 1)); return; }
    if (e.key === 'PageDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 8, rowCount - 1)); return; }
    if (e.key === 'PageUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 8, 0)); return; }
    // Tab completes the highlighted `#` target (token + committing space).
    // Available in the picker — including the committed-but-ambiguous case,
    // which renders as a picker so the user can still disambiguate.
    if (e.key === 'Tab' && launchMode && !launchShowBanner) {
      e.preventDefault();
      const r = launchRows[activeIdx];
      if (r) completeTarget(r.target);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (fileMode) { const r = fileRows[activeIdx]; if (r) chooseFile(r.file); return; }
      if (launchMode) {
        if (launchShowBanner && committedTarget) void launchInTarget(committedTarget, launchBody);
        else { const r = launchRows[activeIdx]; if (r) completeTarget(r.target); }
        return;
      }
      if (slashMode) {
        const r = slashRows[activeIdx];
        if (r) runSlash(r.cmd, e.shiftKey);
        return;
      }
      rows[activeIdx]?.item && runItem(rows[activeIdx].item);
    }
  };

  // Empty-query (command mode) shows section headers; typing collapses them.
  const showHeaders = !fileMode && !launchMode && !slashMode && query.trim() === '';

  const placeholder = fileMode
    ? (selectedProject
        ? (files === null ? `Indexing ${selectedProject.name}…` : `Find file in ${selectedProject.name}…`)
        : 'Find file…')
    : launchMode
      ? 'Launch a task in a project or host…'
      : slashMode
        ? (selectedProject ? `Slash commands in ${selectedProject.name}…` : 'Slash commands…')
        : 'Type to search · @ files · # launch · / commands…';

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" ref={listRef}>
          {fileMode
            ? renderFileRows(files, fileRows, activeIdx, setActiveIdx, chooseFile)
            : launchMode
              ? renderLaunchRows(launchRows, hosts, activeIdx, setActiveIdx, completeTarget,
                  launchShowBanner, committedTarget, launchBody,
                  (t, b) => void launchInTarget(t, b))
              : slashMode
                ? renderSlashRows(slashRows, slashCommands, selectedProject !== null, activeIsClaude, activeIdx, setActiveIdx, runSlash)
                : renderCommandRows(rows, showHeaders, activeIdx, setActiveIdx, runItem, overflow)}
        </div>
      </div>
    </div>
  );
}

function renderFileRows(
  files: WalkedFile[] | null,
  fileRows: FileRow[],
  activeIdx: number,
  setActiveIdx: (i: number) => void,
  chooseFile: (f: WalkedFile) => void
) {
  if (files === null) return <div className="palette-empty">Indexing project files…</div>;
  if (fileRows.length === 0) return <div className="palette-empty">No matching files</div>;
  return fileRows.map((r, i) => (
    <button
      key={r.file.path}
      data-idx={i}
      className={`palette-item ${i === activeIdx ? 'active' : ''}`}
      onMouseEnter={() => setActiveIdx(i)}
      onClick={() => chooseFile(r.file)}
    >
      <span className="palette-icon"><FileText size={14} /></span>
      <span className="palette-label">{highlightMatches(r.file.rel, r.matchIdx)}</span>
    </button>
  ));
}

function renderLaunchRows(
  launchRows: LaunchRow[],
  hosts: SshHostEntry[] | null,
  activeIdx: number,
  setActiveIdx: (i: number) => void,
  completeTarget: (t: LaunchTarget) => void,
  showBanner: boolean,
  committedTarget: LaunchTarget | null,
  body: string,
  launch: (t: LaunchTarget, body: string) => void
) {
  // Resolved (`#parrot …` → exactly one target): a single launch banner.
  if (showBanner && committedTarget) {
    const name = launchTargetLabel(committedTarget);
    const trimmed = body.trim();
    return (
      <button
        data-idx={0}
        className={`palette-item palette-launch-banner ${activeIdx === 0 ? 'active' : ''}`}
        onMouseEnter={() => setActiveIdx(0)}
        onClick={() => launch(committedTarget, body)}
      >
        <span className="palette-icon">
          {committedTarget.kind === 'project' ? <Folder size={14} /> : <Globe size={14} />}
        </span>
        <span className="palette-label">
          Launch in <strong>{name}</strong>
          {trimmed ? <> ▸ “{trimmed}”</> : <> ▸ <span className="palette-hint-inline">interactive session</span></>}
        </span>
        <span className="palette-kbd"><CornerDownLeft size={12} /> launch</span>
      </button>
    );
  }
  // Picker (`#par`): fuzzy list of destinations.
  if (hosts === null && launchRows.length === 0) {
    return <div className="palette-empty">Loading hosts…</div>;
  }
  if (launchRows.length === 0) return <div className="palette-empty">No matching project or host</div>;
  return launchRows.map((r, i) => {
    const t = r.target;
    const label = launchTargetLabel(t);
    const key = t.kind === 'project' ? `p:${t.project.id}` : `h:${t.host.alias}`;
    const hint = t.kind === 'project'
      ? t.project.path
      : `host · ${t.host.user ? `${t.host.user}@${t.host.alias}` : `ssh ${t.host.alias}`}`;
    return (
      <button
        key={key}
        data-idx={i}
        className={`palette-item ${i === activeIdx ? 'active' : ''}`}
        onMouseEnter={() => setActiveIdx(i)}
        onClick={() => completeTarget(t)}
      >
        <span className="palette-icon">{t.kind === 'project' ? <Folder size={14} /> : <Globe size={14} />}</span>
        <span className="palette-label">{highlightMatches(label, r.matchIdx)}</span>
        <span className="palette-hint">{hint}</span>
        <span className="palette-kbd">⇥</span>
      </button>
    );
  });
}

function renderSlashRows(
  slashRows: Array<{ cmd: SlashCommand; matchIdx: number[] }>,
  slashCommands: SlashCommand[],
  hasProject: boolean,
  activeIsClaude: boolean,
  activeIdx: number,
  setActiveIdx: (i: number) => void,
  runSlash: (cmd: SlashCommand, inActiveTab: boolean) => void
) {
  if (!hasProject) return <div className="palette-empty">Select a project to run slash commands</div>;
  if (slashCommands.length === 0) return <div className="palette-empty">No slash commands found</div>;
  if (slashRows.length === 0) return <div className="palette-empty">No matching commands</div>;
  return slashRows.map((r, i) => (
    <button
      key={r.cmd.id}
      data-idx={i}
      className={`palette-item ${i === activeIdx ? 'active' : ''}`}
      onMouseEnter={() => setActiveIdx(i)}
      onClick={(e) => runSlash(r.cmd, e.shiftKey && activeIsClaude)}
    >
      <span className="palette-icon"><Slash size={14} /></span>
      <span className="palette-label">{highlightMatches(r.cmd.invocation, r.matchIdx)}</span>
      {r.cmd.description && <span className="palette-hint">{r.cmd.description}</span>}
      <span className="palette-kbd">{activeIsClaude ? '↵ new · ⇧↵ active tab' : '↵ new tab'}</span>
    </button>
  ));
}

function renderCommandRows(
  rows: ScoredRow[],
  showHeaders: boolean,
  activeIdx: number,
  setActiveIdx: (i: number) => void,
  runItem: (item: PaletteItem) => void,
  overflow: Partial<Record<PaletteCategory, number>>
) {
  if (rows.length === 0) return <div className="palette-empty">No matches</div>;

  const renderRow = (row: ScoredRow, i: number) => (
    <button
      key={row.item.key}
      data-idx={i}
      className={`palette-item ${i === activeIdx ? 'active' : ''}`}
      onMouseEnter={() => setActiveIdx(i)}
      onClick={() => runItem(row.item)}
    >
      <span className="palette-icon">{row.item.icon}</span>
      <span className="palette-label">
        {row.labelMatchIdx ? highlightMatches(row.item.label, row.labelMatchIdx) : row.item.label}
      </span>
      {row.item.hint && <span className="palette-hint">{row.item.hint}</span>}
      <ChevronRight size={12} className="palette-chev" />
    </button>
  );

  if (!showHeaders) return rows.map(renderRow);

  // Empty-query: insert non-interactive section headers between category
  // groups. Headers live OUTSIDE the row index space — `data-idx` stays aligned
  // with the flat `rows` array so arrow-key navigation skips headers cleanly.
  const out: React.ReactNode[] = [];
  let lastCategory: string | null = null;
  let lastSource: string | null = null;
  rows.forEach((row, i) => {
    if (row.item.category !== lastCategory) {
      lastCategory = row.item.category;
      lastSource = null;
      const more = overflow[row.item.category];
      out.push(
        <div key={`hdr:${row.item.category}`} className="palette-section">
          <span>{row.item.category}</span>
          {more ? <span className="palette-section-more">+{more} more · type to search</span> : null}
        </div>
      );
    }
    // Within Extensions, sub-group by the extension's source title.
    if (row.item.category === 'Extensions' && row.item.source !== lastSource) {
      lastSource = row.item.source;
      out.push(<div key={`sub:${row.item.source}`} className="palette-subsection">{row.item.source}</div>);
    }
    out.push(renderRow(row, i));
  });
  return out;
}
