import { product } from '../../lib/product-client.js';
// Pure builder for the command palette's item list. Extracted from
// CommandPalette.tsx so the (large) item-construction logic is testable in
// isolation — a golden snapshot of the produced `key`s guards against
// accidentally dropping a built-in command. The component calls this from a
// `useMemo`; everything the items close over is passed in via `ctx` (no store
// reads happen here), keeping the function pure and side-effect-free.
import {
  Folder, TerminalSquare, Plus, Code2, FolderOpen, FileSearch, Sparkles, Play,
  Zap, Keyboard, History, Search, Inbox, RotateCcw, Trash2, Copy, Pin, PinOff,
  BookOpen, Clock, LayoutGrid, RotateCw, Undo2, Puzzle, Plug, Drama, Bot, AppWindow
} from 'lucide-react';
import { CursorIcon } from '../icons/CursorIcon.js';
import { visibleTerminals, useUi } from '../../store.js';
import { isScopedWindow } from '../../lib/windowScope.js';
import type {
  LaunchProfileId, OpenTarget, Persona, Project, TerminalSession, ScheduledTask
} from '@zana-ai/zcc-domain/product';
import { profileLabel } from '@zana-ai/zcc-domain/launch-provider';
import { scheduleSummary } from '@zana-ai/zcc-domain/schedule-spec';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import { getHost } from '../../modules/ModulePanelHost.js';
import { resolveIcon } from '../../lib/resolveIcon.js';
import { evaluateWhen, type WhenContext } from './whenContext.js';
import { buildPluginPaletteItems } from './plugin-palette-actions.js';
import type { PluginCommandPaletteActionRegistration } from '@zana-ai/zcc-plugin-sdk';

/** A category a palette item belongs to, used for empty-query grouping. */
export type PaletteCategory = 'Projects' | 'Tabs' | 'Actions' | 'Extensions';

export interface PaletteItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** Extra fuzzy-match terms beyond label/hint (extension command keywords). */
  keywords?: string[];
  /** Grouping bucket for empty-query section headers. */
  category: PaletteCategory;
  /**
   * Source of the item: 'core' for built-ins, or the extension's nav title for
   * extension commands (so they sub-group under the extension's name).
   */
  source: string;
  run: () => void;
}

/** Everything the items close over — passed in so the builder stays pure. */
export interface PaletteBuildContext {
  projects: Project[];
  terminals: Record<string, TerminalSession[]>;
  selectedProject: Project | null;
  selectedProjectTabs: TerminalSession[];
  activeTab: TerminalSession | undefined;
  scheduledTasks: ScheduledTask[];
  /** Personas surfaced for the selected project (builtin + global + own). */
  personas: Persona[];
  modules: AppModule[];
  overviewOpen: boolean;
  /** Coarse, non-sensitive context for evaluating extension command `when`. */
  whenCtx: WhenContext;
  onClose: () => void;
  launch: (profile: LaunchProfileId) => void;
  /** Launch a persona (its flags layer onto the persona's baseProfile). */
  launchPersona: (persona: Persona) => void;
  addProject: () => Promise<unknown> | unknown;
  setNav: (nav: string) => void;
  selectProject: (id: string) => void;
  selectTab: (projectId: string, tabId: string) => void;
  setWorkspaceMode: (projectId: string, mode: 'agents' | 'terminals' | 'explorer') => void;
  setSettingsTab: (tab: 'global' | 'project' | 'prompts' | 'personas' | 'squads' | 'usage') => void;
  setExtensionsTab: (tab: 'marketplace' | 'installed' | 'skills' | 'mcp') => void;
  setOverviewOpen: (open: boolean) => void;
  setPinned: (projectId: string, sessionId: string, pinned: boolean) => void;
  restartTerminal: (sessionId: string, projectId: string) => Promise<unknown> | unknown;
  closeTerminal: (sessionId: string, projectId: string) => Promise<unknown> | unknown;
  reopenLastClosed: (projectId: string) => Promise<{ id: string } | null>;
  restoreLastDetached: (projectId: string) => Promise<string | null>;
  pushToast: (message: string, kind?: 'info' | 'error') => void;
  commandPaletteActions?: readonly PluginCommandPaletteActionRegistration[];
  threadId?: string | null;
  projectId?: string | null;
}

/**
 * Commands contributed by app modules (built-in plugins/* + runtime
 * extensions, uniformly). For each module that declares `commands`, call its
 * factory with the module's live host and adapt every ExtensionCommand into a
 * PaletteItem. Keys are namespaced `ext:<moduleId>:<cmd.id>` so they never
 * collide. An optional `icon` is resolved core-side via the lucide name
 * convention (fallback Puzzle); `category` defaults to the module title; a
 * declarative `when` is evaluated HOST-SIDE against the coarse context and,
 * when false, the command is omitted. Per-module try/catch: a throwing factory
 * is skipped and never breaks the palette.
 */
function buildExtensionItems(ctx: PaletteBuildContext): PaletteItem[] {
  const { modules, whenCtx, onClose } = ctx;
  const out: PaletteItem[] = [];
  for (const mod of modules) {
    if (!mod.commands) continue;
    let cmds;
    try {
      cmds = mod.commands(getHost(mod.id));
    } catch {
      continue; // a throwing commands() factory is skipped, not fatal
    }
    if (!Array.isArray(cmds)) continue;
    // `panelFocused` is scoped to THIS module so an extension can't probe
    // whether a different extension's panel is active.
    const modWhenCtx: WhenContext = { ...whenCtx, panelFocused: whenCtx.activeNav === mod.id };
    for (const cmd of cmds) {
      if (!evaluateWhen(cmd.when, modWhenCtx)) continue; // hidden (or fail-closed)
      out.push({
        key: `ext:${mod.id}:${cmd.id}`,
        icon: cmd.icon ? renderIcon(cmd.icon) : <Puzzle size={14} />,
        label: cmd.label,
        hint: mod.title,
        keywords: cmd.keywords,
        category: 'Extensions',
        source: cmd.category ?? mod.title,
        run: () => {
          onClose();
          try {
            cmd.run();
          } catch {
            /* command threw — swallow so a bad extension can't crash the shell */
          }
        }
      });
    }
  }
  return out;
}

function renderIcon(name: string): React.ReactNode {
  const Icon = resolveIcon(name);
  return <Icon size={14} />;
}

/**
 * Build the full, ordered palette item list (projects → tabs → actions →
 * extensions). Pure: no store reads, no side effects until an item's `run` is
 * invoked. The ordering is the sensible default the fuzzy filter falls back to
 * on ties and the empty-query view groups by `category`.
 */
export function buildPaletteItems(ctx: PaletteBuildContext): PaletteItem[] {
  const {
    projects, terminals, selectedProject, selectedProjectTabs, activeTab,
    scheduledTasks, personas, overviewOpen, onClose, launch, launchPersona,
    addProject, setNav, selectProject, selectTab, setWorkspaceMode,
    setSettingsTab, setExtensionsTab, setOverviewOpen, setPinned, restartTerminal, closeTerminal,
    reopenLastClosed, restoreLastDetached, pushToast
  } = ctx;

  const projectItems: PaletteItem[] = projects.map((p) => ({
    key: `project:${p.id}`,
    icon: <Folder size={14} />,
    label: p.name,
    hint: p.path,
    category: 'Projects',
    source: 'core',
    run: () => {
      useUi.getState().enterProjectFocus(p.id);
      onClose();
    }
  }));

  // "Open <project> in new window" — one per project, but only from the main
  // (unscoped) window; a per-project window can't reach the palette's other
  // projects, so the action would be meaningless there.
  const openWindowItems: PaletteItem[] = isScopedWindow()
    ? []
    : projects.map((p) => ({
        key: `open-window:${p.id}`,
        icon: <AppWindow size={14} />,
        label: `Open ${p.name} in new window`,
        hint: 'Separate window scoped to this project',
        category: 'Actions',
        source: 'core',
        run: () => {
          void product.windows.openProject(p.id);
          onClose();
        }
      }));

  const actions: PaletteItem[] = [
    {
      key: 'action:add-project',
      icon: <Plus size={14} />,
      label: 'Add project…',
      hint: 'Pick a folder',
      category: 'Actions',
      source: 'core',
      run: async () => {
        onClose();
        await addProject();
      }
    },
    {
      key: 'action:settings',
      icon: <TerminalSquare size={14} />,
      label: 'Open Settings',
      hint: '⌘,',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('settings');
        onClose();
      }
    },
    {
      key: 'action:shortcuts',
      icon: <Keyboard size={14} />,
      label: 'Keyboard shortcuts',
      hint: '⌘?',
      category: 'Actions',
      source: 'core',
      run: () => {
        onClose();
        useUi.getState().setShortcutsOpen(true);
      }
    },
    {
      key: 'action:inbox',
      icon: <Inbox size={14} />,
      label: 'Open Inbox',
      hint: '⌘I',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('inbox');
        onClose();
      }
    },
    {
      key: 'action:scheduler',
      icon: <Clock size={14} />,
      label: 'Open Scheduler',
      hint: '⌘J',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('scheduler');
        onClose();
      }
    },
    {
      key: 'action:skills',
      icon: <BookOpen size={14} />,
      label: 'Open Skills',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('extensions');
        setExtensionsTab('skills');
        onClose();
      }
    },
    {
      key: 'action:plugin-hub',
      icon: <Puzzle size={14} />,
      label: 'Open Plugins',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('extensions');
        setExtensionsTab('installed');
        onClose();
      }
    },
    {
      key: 'action:mcp',
      icon: <Plug size={14} />,
      label: 'Open MCP servers',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('extensions');
        setExtensionsTab('mcp');
        onClose();
      }
    },
    {
      key: 'action:personas',
      icon: <Drama size={14} />,
      label: 'Open Personas',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('settings');
        setSettingsTab('personas');
        onClose();
      }
    },
    {
      key: 'action:overview',
      icon: <LayoutGrid size={14} />,
      label: 'Show all agents',
      hint: '⌘O',
      category: 'Actions',
      source: 'core',
      run: () => {
        setNav('agents');
        useUi.getState().exitProjectFocus();
        onClose();
      }
    }
  ];

  // Tabs from every project. The selected project's tabs come first so
  // arrow-key muscle memory still lands on local tabs without typing,
  // followed by tabs from other projects (cross-project jump-to-tab).
  const tabItems: PaletteItem[] = [];
  const seenTab = new Set<string>();
  const pushTab = (proj: Project, t: TerminalSession) => {
    if (seenTab.has(t.id)) return;
    seenTab.add(t.id);
    tabItems.push({
      key: `tab:${t.id}`,
      icon: <TerminalSquare size={14} />,
      label: `${t.title}${t.status === 'exited' ? ' · exited' : ''}`,
      hint: `${proj.name} · ${t.profile}`,
      category: 'Tabs',
      source: 'core',
      run: () => {
        useUi.getState().enterProjectFocus(proj.id);
        selectTab(proj.id, t.id);
        setWorkspaceMode(proj.id, 'terminals');
        onClose();
      }
    });
  };
  if (selectedProject) {
    for (const t of selectedProjectTabs) pushTab(selectedProject, t);
  }
  for (const p of projects) {
    if (selectedProject && p.id === selectedProject.id) continue;
    const list = visibleTerminals(terminals[p.id]);
    for (const t of list) pushTab(p, t);
  }

  if (selectedProject) {
    const path = selectedProject.path;
    const open = async (target: OpenTarget) => {
      const r = await product.openers.openIn(target, path);
      if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
    };
    actions.push(
      {
        key: 'action:project-agents',
        icon: <Bot size={14} />,
        label: `Show agents in ${selectedProject.name}`,
        hint: 'This project’s agents',
        category: 'Actions',
        source: 'core',
        run: () => {
          useUi.getState().enterProjectFocus(selectedProject.id);
          setWorkspaceMode(selectedProject.id, 'agents');
          onClose();
        }
      },
      {
        key: 'action:project-settings',
        icon: <TerminalSquare size={14} />,
        label: `Open ${selectedProject.name} settings…`,
        hint: 'CLI flags, MCP, allowed tools',
        category: 'Actions',
        source: 'core',
        run: () => {
          useUi.getState().openProjectSettings(selectedProject.id);
          onClose();
        }
      },
      {
        key: 'action:quick-open',
        icon: <FileSearch size={14} />,
        label: `Find file in ${selectedProject.name}…`,
        hint: '⌘E',
        category: 'Actions',
        source: 'core',
        run: () => {
          onClose();
          useUi.getState().setQuickOpenOpen(true);
        }
      },
      {
        key: 'action:search-contents',
        icon: <Search size={14} />,
        label: `Search in ${selectedProject.name}…`,
        hint: '⌘⇧F',
        category: 'Actions',
        source: 'core',
        run: () => {
          onClose();
          useUi.getState().setSearchOpen(true);
        }
      },
      {
        key: 'action:new-claude',
        icon: <Sparkles size={14} />,
        label: `New ${profileLabel('claude')} tab in ${selectedProject.name}`,
        hint: '⌘T',
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); launch('claude'); }
      },
      {
        key: 'action:new-claude-yolo',
        icon: <Zap size={14} />,
        label: `New ${profileLabel('claude-yolo')} tab in ${selectedProject.name}`,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); launch('claude-yolo'); }
      },
      {
        key: 'action:resume-claude',
        icon: <History size={14} />,
        label: `Resume Claude session in ${selectedProject.name}…`,
        hint: '⌘R',
        category: 'Actions',
        source: 'core',
        run: () => {
          onClose();
          useUi.getState().setResumeOpen(true);
        }
      },
      {
        key: 'action:new-shell',
        icon: <Play size={14} />,
        label: `New ${profileLabel('shell')} tab in ${selectedProject.name}`,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); launch('shell'); }
      },
      {
        key: 'action:open-cursor',
        icon: <CursorIcon size={14} />,
        label: `Open ${selectedProject.name} in Cursor`,
        hint: path,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); open('cursor'); }
      },
      {
        key: 'action:open-code',
        icon: <Code2 size={14} />,
        label: `Open ${selectedProject.name} in VS Code`,
        hint: path,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); open('code'); }
      },
      {
        key: 'action:open-finder',
        icon: <FolderOpen size={14} />,
        label: `Reveal ${selectedProject.name} in Finder`,
        hint: path,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); open('finder'); }
      },
      {
        key: 'action:open-terminal',
        icon: <TerminalSquare size={14} />,
        label: `Open ${selectedProject.name} in external Terminal`,
        hint: path,
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); open('terminal'); }
      }
    );
    // One launch row per persona surfaced for this project. Spawns the persona
    // on its baseProfile with its flag layer applied (same path as the "+").
    for (const persona of personas) {
      actions.push({
        key: `action:new-persona:${persona.id}`,
        icon: <Drama size={14} />,
        label: `New ${persona.name} tab in ${selectedProject.name}`,
        hint: persona.description ?? 'persona',
        keywords: ['persona', persona.id],
        category: 'Actions',
        source: 'core',
        run: () => { onClose(); launchPersona(persona); }
      });
    }
    if (activeTab) {
      actions.push({
        key: 'action:pin-active',
        icon: activeTab.pinned ? <PinOff size={14} /> : <Pin size={14} />,
        label: activeTab.pinned
          ? `Unpin "${activeTab.title}"`
          : `Pin "${activeTab.title}"`,
        hint: activeTab.pinned ? 'remove from pinned zone' : 'keep at top',
        category: 'Actions',
        source: 'core',
        run: () => {
          const sid = activeTab.id;
          const pid = selectedProject.id;
          const next = !activeTab.pinned;
          onClose();
          setPinned(pid, sid, next);
        }
      });
      actions.push({
        key: 'action:duplicate-active',
        icon: <Copy size={14} />,
        label: `Duplicate "${activeTab.title}"`,
        hint: `new ${activeTab.profile} tab`,
        category: 'Actions',
        source: 'core',
        run: () => {
          const profile = activeTab.profile;
          onClose();
          launch(profile);
        }
      });
      actions.push({
        key: 'action:restart-active',
        icon: <RotateCcw size={14} />,
        label: `Restart "${activeTab.title}"`,
        hint: activeTab.status === 'exited' ? 'exited' : 'kill and restart',
        category: 'Actions',
        source: 'core',
        run: () => {
          const sid = activeTab.id;
          const pid = selectedProject.id;
          const live = activeTab.status !== 'exited';
          onClose();
          if (live && !window.confirm(`Kill and restart "${activeTab.title}"?`)) return;
          void restartTerminal(sid, pid);
        }
      });
    }
    actions.push({
      key: 'action:reopen-last-closed',
      icon: <Undo2 size={14} />,
      label: `Reopen / resume last removed tab in ${selectedProject.name}`,
      hint: '⌘⇧T',
      category: 'Actions',
      source: 'core',
      run: () => {
        const pid = selectedProject.id;
        onClose();
        // Mirror ⌘⇧T: resume newest background session first, else reopen
        // the last closed tab.
        restoreLastDetached(pid).then((restored) => {
          if (restored) return;
          reopenLastClosed(pid).then((s) => {
            if (s) selectTab(pid, s.id);
          }).catch(() => {});
        }).catch(() => {});
      }
    });
    const projectSchedules = scheduledTasks.filter(
      (t) => t.projectId === selectedProject.id && t.enabled
    );
    for (const task of projectSchedules) {
      actions.push({
        key: `action:run-schedule:${task.id}`,
        icon: <RotateCw size={14} />,
        label: `Run schedule now: ${task.name}`,
        hint: `${scheduleSummary(task.schedule)} · ${task.profile}`,
        category: 'Actions',
        source: 'core',
        run: () => {
          const id = task.id;
          const name = task.name;
          onClose();
          product.scheduler.runNow(id).then((r) => {
            if (!r.ok) pushToast(r.message ?? `Failed to run ${name}`, 'error');
          }).catch(() => {});
        }
      });
    }
    const exitedNonPinned = selectedProjectTabs.filter(
      (t) => t.status === 'exited' && !t.pinned
    );
    if (exitedNonPinned.length > 0) {
      actions.push({
        key: 'action:close-exited',
        icon: <Trash2 size={14} />,
        label: `Close ${exitedNonPinned.length} exited tab${
          exitedNonPinned.length === 1 ? '' : 's'
        } in ${selectedProject.name}`,
        hint: 'cleanup',
        category: 'Actions',
        source: 'core',
        run: () => {
          const pid = selectedProject.id;
          const ids = exitedNonPinned.map((t) => t.id);
          onClose();
          for (const id of ids) void closeTerminal(id, pid);
        }
      });
    }
  }

  // Slash commands are NOT folded into the general list — they have a dedicated
  // `/` mode in the palette (one clean row each, ↵ new tab / ⇧↵ active tab) so
  // they don't double up here with verbose " — new Claude tab" labels.
  return [
    ...projectItems,
    ...tabItems,
    ...actions,
    ...openWindowItems,
    ...buildExtensionItems(ctx),
    ...buildPluginPaletteItems(
      ctx.commandPaletteActions ?? [],
      { threadId: ctx.threadId ?? null, projectId: ctx.projectId ?? null },
      ctx.onClose
    )
  ];
}
