import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';
import type { Project, Team, TeamSlot } from '@zana-ai/zcc-domain/product';
import type { PersonaTeamRegistry } from '../../../../desktop/src/extensions/persona-team-registry.js';
import { uniqueCopyName } from '../projects/unique-copy-name.js';

import { electronZccDataDir } from '../../electron-data-dir.js';

const userTeamsDir = () => join(electronZccDataDir(), 'teams');
const projectTeamsDir = (project: Project) => join(project.path, '.zcc', 'teams');

function canonicalDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/** Rule 5: per-slot tab clamp. Mirrors `TEAM_SLOT_MAX` in the registry; kept
 *  here too so the disk loader / UI save path clamp without importing the
 *  registry (which imports this file). */
const TEAM_SLOT_MAX = 16;
/** Defensive ceiling on slot rows per team (disk file / UI), independent of the registry cap. */
const TEAM_SLOTS_PER_TEAM_MAX = 64;

/** Filesystem-safe filename for a team id (mirrors persona-store). */
function fileNameForId(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`;
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

/**
 * Validate + normalize a raw object into a {@link Team}, or null if it's missing
 * required fields. Shared by the disk loader ({@link readTeamFile}), the UI write
 * path ({@link TeamStore.saveUser}) and the extension registry, so a hand-edited
 * file, a form-authored team, and an extension-contributed one pass the SAME
 * gate. Never returns `source` (the loader/host stamps that).
 *
 * Requires `id`, `name`, and a `slots` array; coerces each slot's `quantity`
 * into `1..TEAM_SLOT_MAX`; drops slots whose `personaId` isn't a non-empty
 * string. Persona EXISTENCE is checked at LAUNCH, not here (a team may reference
 * a persona that isn't registered yet, e.g. the extension's own).
 */
export function sanitizeTeam(raw: unknown): Team | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Team>;
  if (typeof r.id !== 'string' || !r.id.trim()) return null;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  if (!Array.isArray(r.slots)) return null;

  const slots: TeamSlot[] = [];
  for (const s of r.slots.slice(0, TEAM_SLOTS_PER_TEAM_MAX)) {
    if (!s || typeof s !== 'object') continue;
    const slot = s as Partial<TeamSlot>;
    if (typeof slot.personaId !== 'string' || !slot.personaId.trim()) continue;
    const q = typeof slot.quantity === 'number' && Number.isFinite(slot.quantity)
      ? Math.max(1, Math.min(TEAM_SLOT_MAX, Math.floor(slot.quantity)))
      : 1;
    slots.push({
      personaId: slot.personaId.trim(),
      quantity: q,
      ...(typeof slot.label === 'string' && slot.label.trim()
        ? { label: slot.label.trim() }
        : {})
    });
  }

  return {
    id: r.id.trim(),
    name: r.name.trim(),
    icon: typeof r.icon === 'string' ? r.icon : undefined,
    description: typeof r.description === 'string' ? r.description : undefined,
    orchestratorPersonaId:
      typeof r.orchestratorPersonaId === 'string' && r.orchestratorPersonaId.trim()
        ? r.orchestratorPersonaId.trim()
        : undefined,
    slots,
    defaultProjectId:
      typeof r.defaultProjectId === 'string' && r.defaultProjectId.trim()
        ? r.defaultProjectId.trim()
        : undefined,
    initialPrompt: typeof r.initialPrompt === 'string' ? r.initialPrompt : undefined
  };
}

/**
 * Built-in team catalogue. Stable IDs are prefixed with `builtin:` so a user can
 * shadow them by dropping a file with the same id stem in their own teams dir.
 * Ships one starter team composed of the built-in personas.
 */
const BUILTIN: Team[] = [
  {
    id: 'builtin:review-squad',
    name: 'Review Squad',
    icon: 'Users',
    description:
      'An orchestrator plus a code reviewer and an architect — opens three tabs to plan, build, and review a change in parallel.',
    orchestratorPersonaId: 'builtin:orchestrator',
    slots: [
      { personaId: 'builtin:orchestrator', quantity: 1 },
      { personaId: 'builtin:software-engineer', quantity: 1 },
      { personaId: 'builtin:reviewer', quantity: 1 }
    ],
    initialPrompt:
      'You are the orchestrator for this team. Break the goal into tasks, delegate to the engineer and reviewer tabs, and integrate their work.'
  }
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** README dropped into the user dir on first run so people know what goes there. */
function ensureReadme(dir: string) {
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) return;
  try {
    writeFileSync(
      readme,
      [
        '# Teams',
        '',
        'Drop one JSON file per team in this directory. A team is a named bundle of',
        'personas; launching it opens one terminal tab per slot (times its',
        '`quantity`), with the orchestrator opened first and given the team prompt.',
        '',
        'You can also create and edit teams from the app\'s **Teams** panel — both',
        'write to this directory.',
        '',
        '## Schema',
        '',
        '```json',
        '{',
        '  "id": "my-team",',
        '  "name": "My Team",',
        '  "icon": "Users",',
        '  "description": "What it does (optional)",',
        '  "orchestratorPersonaId": "builtin:orchestrator",',
        '  "initialPrompt": "Opening instruction for the orchestrator tab.",',
        '  "slots": [',
        '    { "personaId": "builtin:orchestrator", "quantity": 1 },',
        '    { "personaId": "builtin:software-engineer", "quantity": 2, "label": "Engineer" }',
        '  ]',
        '}',
        '```',
        '',
        'Each slot references a persona `id` (builtin, user, or project). `quantity`',
        'is clamped to 1–16. A slot whose persona id no longer resolves is skipped',
        'at launch. Files with invalid JSON or missing required fields are silently',
        'skipped. A built-in team is shadowed when you drop a file with the same `id`.',
        ''
      ].join('\n')
    );
  } catch {
    // Best-effort scaffolding — never fail boot if the home dir is RO.
  }
}

function readTeamFile(path: string): Team | null {
  try {
    return sanitizeTeam(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

function listInDir(dir: string, source: Team['source']): Team[] {
  if (!existsSync(dir)) return [];
  const out: Team[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const t = readTeamFile(join(dir, name));
    if (t) {
      t.source = source;
      out.push(t);
    }
  }
  return out;
}

/**
 * Holds the union of built-ins + user dir + per-project dirs + extension
 * registrations, with fs.watch-based invalidation. A structural clone of
 * {@link PersonaStore}: same resolution order (project > user > builtin),
 * atomic writes (Rule 4), debounced watch, project rebind, and a registry
 * subscription so (de)registration re-emits `changed`.
 *
 * Extension teams carry `ext:*` ids, so they can never collide with
 * `builtin:`/user/project ids — they're inserted FIRST (defensively) so a
 * later same-id file would win anyway.
 */
export class TeamStore extends EventEmitter {
  private cache: Team[] = [];
  private projectsRef: () => Project[];
  private registry?: PersonaTeamRegistry;
  private registryUnsub: (() => void) | null = null;
  private userWatcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounce: NodeJS.Timeout | null = null;

  constructor(projectsRef: () => Project[], registry?: PersonaTeamRegistry) {
    super();
    this.projectsRef = projectsRef;
    this.registry = registry;
  }

  start() {
    const dir = userTeamsDir();
    ensureDir(dir);
    ensureReadme(dir);
    this.refresh();
    this.attachUserWatcher();
    this.attachProjectWatchers();
    // Re-merge whenever an extension (de)registers teams (Rule 3: subscribe in start).
    if (this.registry && !this.registryUnsub) {
      this.registryUnsub = this.registry.onChanged(() => this.refresh());
    }
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    // Rule 3: release the registry subscription on stop.
    if (this.registryUnsub) {
      this.registryUnsub();
      this.registryUnsub = null;
    }
  }

  list(): Team[] {
    return this.cache;
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  onChanged(cb: () => void): () => void {
    this.on('changed', cb);
    return () => this.off('changed', cb);
  }

  /** Re-discover all sources. Cheap; called on watch events, registry emits, and project changes. */
  refresh() {
    const merged = new Map<string, Team>();
    // Extension teams first (ext:* ids can't collide with the rest); a same-id
    // file later would still win, matching PersonaStore's defensive ordering.
    if (this.registry) {
      for (const t of this.registry.allTeams()) merged.set(t.id, t);
    }
    for (const t of BUILTIN) merged.set(t.id, { ...t, source: 'builtin' });
    const userDir = userTeamsDir();
    for (const t of listInDir(userDir, 'user')) merged.set(t.id, t);
    const canonicalUserDir = canonicalDir(userDir);
    for (const project of this.projectsRef()) {
      const projectDir = projectTeamsDir(project);
      if (canonicalDir(projectDir) === canonicalUserDir) continue;
      const projectSource: Team['source'] = {
        projectId: project.id,
        projectName: project.name
      };
      for (const t of listInDir(projectDir, projectSource)) {
        merged.set(t.id, t);
      }
    }
    this.cache = [...merged.values()];
    this.emit('changed');
  }

  /** Hook for `store.addProject` / `store.removeProject`. */
  rebindProjects() {
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    this.attachProjectWatchers();
    this.refresh();
  }

  /** Path of the user teams dir (for "Open in Finder"). */
  userDir(): string {
    return userTeamsDir();
  }

  /** The ids of the shipped built-in teams (so the UI can mark "reset"). */
  builtinIds(): string[] {
    return BUILTIN.map((t) => t.id);
  }

  /**
   * Persist a team to the user dir (`~/.zcc/teams/<id>.json`). Runs the SAME
   * {@link sanitizeTeam} gate as the disk loader, then writes atomically (Rule
   * 4). A user file whose id matches a built-in shadows it. For a brand-new team
   * pass no id (or a blank one) and a unique slug is derived from the name.
   */
  saveUser(input: Partial<Team> & { name: string }): Team {
    const dir = userTeamsDir();
    ensureDir(dir);

    const hasId = typeof input.id === 'string' && input.id.trim().length > 0;
    const id = hasId ? input.id!.trim() : this.deriveId(input.name);

    const team = sanitizeTeam({ slots: [], ...input, id });
    if (!team) throw new Error('invalid team: missing name/slots or invalid field');

    writeJsonAtomic(join(dir, fileNameForId(team.id)), team);
    this.refresh();
    return { ...team, source: 'user' };
  }

  /** Copy a currently resolved team into the user-owned store. */
  duplicateUser(id: string): Team {
    const source = this.cache.find((team) => team.id === id);
    if (!source) throw new Error(`team not found: ${id}`);
    const { id: _id, source: _source, name, ...configuration } = structuredClone(source);
    return this.saveUser({
      ...configuration,
      name: uniqueCopyName(name, this.cache.map((team) => team.name))
    });
  }

  /**
   * Delete the user file for an id. For a shadowed built-in this resets it to the
   * shipped default; for a purely-user team it removes it. Returns false if there
   * was no user file to remove.
   */
  deleteUser(id: string): boolean {
    const file = join(userTeamsDir(), fileNameForId(id));
    let removed = false;
    try {
      if (existsSync(file)) {
        rmSync(file);
        removed = true;
      }
    } catch {
      /* best-effort */
    }
    this.refresh();
    return removed;
  }

  /** Derive a filesystem/url-safe id that doesn't collide with an existing one. */
  private deriveId(name: string): string {
    const base =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'team';
    const taken = new Set(this.cache.map((t) => t.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  async revealDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    const path = userTeamsDir();
    try {
      ensureDir(path);
      ensureReadme(path);
      await shell.openPath(path);
      return { ok: true, path };
    } catch (err) {
      return {
        ok: false,
        path,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // ----- internals -----------------------------------------------------------

  private attachUserWatcher() {
    const dir = userTeamsDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[team-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(userTeamsDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // watcher unsupported on this fs — fall back to refresh-on-demand.
    }
  }

  private attachProjectWatchers() {
    for (const project of this.projectsRef()) {
      const dir = projectTeamsDir(project);
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
        const projectId = project.id;
        w.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[team-store] project ${projectId} watcher error:`, err);
          try {
            w.close();
          } catch {
            /* already closed */
          }
          if (this.projectWatchers.get(projectId) === w) {
            this.projectWatchers.delete(projectId);
          }
          this.scheduleRefresh();
        });
        this.projectWatchers.set(projectId, w);
      } catch {
        // ignore — same fallback as user dir.
      }
    }
  }

  /** Coalesce burst events (editor save = create+rename+modify on most fs). */
  private scheduleRefresh() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.refresh();
    }, 150);
  }
}
