import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Bot, ChevronRight, Copy, FolderOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Persona } from '@shared/types';
import { usePersonas, useUi } from '../store';
import { personaIcon } from '../util/profileIcon';
import { getScopedProjectId } from '../util/windowScope';
import { personaRoutingSummary } from '../util/personaRouting';
import { PersonaEditor, RevealPersonasButton } from './PersonaEditor';

/**
 * Personas management panel — a catalogue of launchable personas
 * (builtin ⊕ ~/.zcc/personas ⊕ <project>/.zcc/personas), merged and pushed by
 * the main process. Clicking a row opens a detail/editor modal: built-ins and
 * project personas open read-only with a fork/duplicate path, user personas are
 * fully editable. "New persona" and the per-row editor write to
 * ~/.zcc/personas via cc.personas.save (Reveal still opens the dir for
 * hand-editing). Mirrors the layout of SkillsPanel.
 */

/** What the editor modal is doing: nothing, creating, or viewing/editing one. */
type EditorState = { kind: 'new' } | { kind: 'open'; persona: Persona } | null;

type SourceKind = 'all' | 'builtin' | 'user' | 'project' | 'extension';

const SOURCE_FILTERS: Array<{ id: SourceKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'builtin', label: 'Builtin' },
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' },
  { id: 'extension', label: 'Extension' }
];

/** Classify a persona's source into one of the filter buckets. */
function sourceKind(source: Persona['source']): Exclude<SourceKind, 'all'> {
  if (source === 'builtin') return 'builtin';
  if (source === 'user') return 'user';
  if (source && typeof source === 'object' && 'extensionId' in source) return 'extension';
  return 'project';
}

function sourceLabel(source: Persona['source']): string {
  if (source === 'builtin') return 'Builtin';
  if (source === 'user') return 'User';
  if (source && typeof source === 'object') {
    if ('extensionId' in source) {
      return source.extensionTitle ? `Extension · ${source.extensionTitle}` : 'Extension';
    }
    return source.projectName ? `Project · ${source.projectName}` : 'Project';
  }
  return 'User';
}

/** An extension-contributed persona is in-memory only — not file-backed, so not editable. */
function isExtensionSource(source: Persona['source']): boolean {
  return !!source && typeof source === 'object' && 'extensionId' in source;
}

export function PersonasPanel() {
  const allPersonas = usePersonas((s) => s.personas);
  const loading = usePersonas((s) => s.loading);
  const [filter, setFilter] = useState<SourceKind>('all');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  // Right-click lifecycle menu — mirrors the row's click (Open) plus the
  // editor's Reveal / Delete actions, at the cursor, matching the Agents,
  // Inbox & Scheduler lists.
  const [rowMenu, setRowMenu] = useState<{ persona: Persona; x: number; y: number; trigger: HTMLElement } | null>(null);
  const pushToast = useUi((s) => s.pushToast);

  const openRowMenu = (e: ReactMouseEvent, persona: Persona) => {
    e.preventDefault();
    setRowMenu({ persona, x: e.clientX, y: e.clientY, trigger: e.target as HTMLElement });
  };
  const openRowMenuFromKeyboard = (element: HTMLElement, persona: Persona) => {
    const rect = element.getBoundingClientRect();
    setRowMenu({ persona, x: rect.left, y: rect.bottom, trigger: element });
  };

  const deletePersona = async (persona: Persona) => {
    const result = await window.cc.personas.delete(persona.id);
    if (!result.ok) {
      pushToast(`Delete failed: ${result.message}`, 'error');
      return;
    }
    pushToast(
      persona.id.startsWith('builtin:')
        ? `Reset “${persona.name}” to the built-in default`
        : `Deleted persona “${persona.name}”`,
      'info'
    );
  };

  // In a per-project window, show builtin + user personas plus only THIS
  // project's project-personas — other projects' personas don't apply here.
  // Mirrors the launcher's persona-picker filter. Main window: all personas.
  const scopedProjectId = getScopedProjectId();
  const personas = useMemo(() => {
    if (!scopedProjectId) return allPersonas;
    return allPersonas.filter(
      (p) =>
        typeof p.source !== 'object' ||
        p.source === null ||
        !('projectId' in p.source) ||
        p.source.projectId === scopedProjectId
    );
  }, [allPersonas, scopedProjectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return personas.filter((p) => {
      if (filter !== 'all' && sourceKind(p.source) !== filter) return false;
      if (!q) return true;
      const haystack = `${p.name} ${p.id} ${p.description ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [personas, filter, query]);

  const counts = useMemo(() => {
    const c = { all: personas.length, builtin: 0, user: 0, project: 0, extension: 0 };
    for (const p of personas) c[sourceKind(p.source)] += 1;
    return c;
  }, [personas]);

  return (
    <main className="settings-panel skills-panel personas-panel">
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Personas</h2>
            <p className="settings-help scheduler-subtitle">
              Named, reusable launch profiles — a bundle of <code>claude</code> flags
              (system prompt, model, permission mode, allowed tools). Discovered from{' '}
              <code>~/.zcc/personas</code> and each project's{' '}
              <code>.zcc/personas</code>. Pick one in the “+” launcher to start a
              session as that persona. Click a persona to view or edit it.
            </p>
          </div>
          <div className="personas-header-actions">
            <button
              type="button"
              className="settings-btn primary"
              onClick={() => setEditor({ kind: 'new' })}
            >
              <Plus size={12} /> New persona
            </button>
            <RevealPersonasButton />
          </div>
        </div>

        <div className="skills-layout">
          <section className="skills-left">
            <div className="skills-toolbar">
              <div className="skills-search">
                <Search size={14} aria-hidden />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search personas…"
                  aria-label="Search personas"
                />
              </div>
              <div className="skills-filter" role="tablist" aria-label="Source filter">
                {SOURCE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className={`skills-filter-btn ${filter === f.id ? 'is-active' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="skills-filter-count">{counts[f.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="scheduler-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="scheduler-empty">
                <Bot size={28} className="scheduler-empty-icon" />
                <div className="scheduler-empty-title">
                  {personas.length === 0 ? 'No personas found' : 'No matches'}
                </div>
                <div className="scheduler-empty-hint">
                  {personas.length === 0
                    ? 'Drop a persona JSON in ~/.zcc/personas, or use a builtin.'
                    : 'Try a different search or filter.'}
                </div>
              </div>
            ) : (
              <ul className="skills-list">
                {filtered.map((p) => (
                  <PersonaRow
                    key={p.id}
                    persona={p}
                    onOpen={() => setEditor({ kind: 'open', persona: p })}
                    onContextMenu={(e) => openRowMenu(e, p)}
                    onContextMenuKey={(event) => {
                      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                      event.preventDefault();
                      openRowMenuFromKeyboard(event.currentTarget, p);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {editor && (
        <PersonaEditor
          key={editor.kind === 'new' ? 'new' : `${editor.persona.id}:${editor.persona.source === 'user' ? 'edit' : 'view'}`}
          persona={editor.kind === 'open' ? editor.persona : null}
          mode={
            editor.kind === 'new'
              ? 'edit'
              : editor.persona.source === 'user'
                ? 'edit'
                : 'view'
          }
          onClose={() => setEditor(null)}
        />
      )}

      {rowMenu && (
        <PersonaRowMenu
          persona={rowMenu.persona}
          anchor={{ x: rowMenu.x, y: rowMenu.y }}
          onClose={() => {
            setRowMenu(null);
            rowMenu.trigger.focus();
          }}
          onOpen={() => setEditor({ kind: 'open', persona: rowMenu.persona })}
          onReveal={() => void window.cc.personas.revealDir().catch(() => {})}
          onDuplicate={() => void duplicatePersona(rowMenu.persona)}
          onDelete={() => void deletePersona(rowMenu.persona)}
        />
      )}
    </main>
  );

  async function duplicatePersona(persona: Persona) {
    const result = await window.cc.personas.duplicate(persona.id);
    if (!result.ok) {
      pushToast(`Duplicate failed: ${result.message}`, 'error');
      return;
    }
    pushToast(`Created persona “${result.value.name}”`, 'info');
  }
}

/**
 * Right-click menu for a persona row — Open (view/edit), Reveal the personas
 * folder, and Delete (only for a file-backed user persona; a builtin "Delete"
 * resets it to default — deferred to the editor, and extension personas are
 * in-memory only so they can't be removed here). Shares the app-wide
 * `.tab-context-menu` styling + self-contained positioning used by the Agents,
 * Inbox & Scheduler row menus.
 */
function PersonaRowMenu({
  persona,
  anchor,
  onClose,
  onOpen,
  onReveal,
  onDuplicate,
  onDelete
}: {
  persona: Persona;
  anchor: { x: number; y: number };
  onClose: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Only a file-backed user persona can be deleted from here; builtins reset via
  // the editor and extension personas aren't file-backed.
  const canDelete = persona.source === 'user';

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const PAD = 8;
    const rect = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > window.innerWidth - PAD) {
      left = Math.max(PAD, window.innerWidth - rect.width - PAD);
    }
    if (top + rect.height > window.innerHeight - PAD) {
      top = Math.max(PAD, window.innerHeight - rect.height - PAD);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      role="menu"
      aria-label={`Actions for ${persona.name}`}
      style={{ top: anchor.y, left: anchor.x }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(event) => {
        const items = itemRefs.current.filter((item): item is HTMLButtonElement => !!item);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown'
          ? (current + 1) % items.length
          : event.key === 'ArrowUp'
            ? (current - 1 + items.length) % items.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : undefined;
        if (next === undefined) return;
        event.preventDefault();
        items[next]?.focus();
      }}
    >
      <button ref={(item) => { itemRefs.current[0] = item; }} role="menuitem" onClick={() => { onClose(); onOpen(); }}>
        <Pencil size={13} /> {persona.source === 'user' ? 'Edit' : 'View'}
      </button>
      <button ref={(item) => { itemRefs.current[1] = item; }} role="menuitem" onClick={() => { onClose(); onReveal(); }}>
        <FolderOpen size={13} /> Reveal folder
      </button>
      <button ref={(item) => { itemRefs.current[2] = item; }} role="menuitem" onClick={() => { onClose(); onDuplicate(); }}>
        <Copy size={13} /> Duplicate
      </button>
      {canDelete && (
        <>
          <div className="tab-context-sep" />
          <button ref={(item) => { itemRefs.current[3] = item; }} role="menuitem" className="tab-context-danger" onClick={() => { onClose(); onDelete(); }}>
            <Trash2 size={13} /> Delete
          </button>
        </>
      )}
    </div>
  );
}

function PersonaRow({
  persona,
  onOpen,
  onContextMenu,
  onContextMenuKey
}: {
  persona: Persona;
  onOpen: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  onContextMenuKey: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const meta = personaRoutingSummary(persona);

  return (
    <li className="skills-row skills-row--clickable" onContextMenu={onContextMenu}>
      <button
        type="button"
        className="skills-row-open"
        onClick={onOpen}
        onKeyDown={onContextMenuKey}
        aria-label={`Open ${persona.name}`}
      >
        <span className="tab-profile-icon" aria-hidden="true">
          {personaIcon(persona)}
        </span>
        <div className="skills-row-body">
          <div className="skills-row-head">
            <span className="skills-row-name">{persona.name}</span>
            <span className="scheduler-pill scheduler-pill--source">
              {sourceLabel(persona.source)}
            </span>
            {meta.map((m) => (
              <span key={m} className="scheduler-pill">
                {m}
              </span>
            ))}
          </div>
          {persona.description && <p className="skills-row-desc">{persona.description}</p>}
        </div>
        <ChevronRight size={16} className="skills-row-chevron" aria-hidden />
      </button>
    </li>
  );
}
