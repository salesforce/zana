/**
 * zana-hub — main-process side.
 *
 * Reads the GLOBAL Zana workspace (`~/.zana`) and shapes it into one
 * cross-project {@link ZanaHubOverview} for the dashboard panel. This is the
 * app-level companion to the per-project "Zana" tab (core's ProjectTickets
 * view, which reads each project's `.zana`): where that tab is one project's
 * tickets/sprints, THIS surface is the framework as a whole — the reusable
 * catalog (teams / profiles / skills) plus recent activity (sprints, agent
 * runs, workers, autopilot).
 *
 * Sandbox reality (honest scope):
 *   - A disk extension is OUT-OF-PROCESS and capability-gated. It reads files
 *     ONLY through `ctx.fs` (brokered, gated by `fs:read` + `fsRoots: ["~/.zana"]`).
 *     Raw `node:fs` is denylisted in the child — so every read here goes through
 *     `ctx.fs.readFile` / `ctx.fs.readdir`.
 *   - `node:os` / `node:path` are NOT denylisted and `$HOME` is forwarded to the
 *     child, so we can compute the absolute `~/.zana` root the broker expects.
 *   - JSON-on-disk only. Zana's tickets live in a SQLite DB (`tickets.db`) the
 *     sandbox can't open, and in-flight deliberations live behind the Zana MCP
 *     server (also unreachable from here). Those are intentionally out of scope;
 *     `automation-state.json` gives an autopilot count, `runs/*.json` give live
 *     agent activity, and the catalog dirs give teams/profiles/skills.
 *
 * Reads are BOUNDED (Rule 5): each directory listing is capped before any file
 * is opened, and a missing dir / corrupt file is skipped + recorded as a
 * warning, never failing the whole call.
 */
import { defineMainModule } from '@zana-ai/zcc-extension-sdk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ZanaDetail,
  ZanaDetailField,
  ZanaDetailKind,
  ZanaHubOverview,
  ZanaProfileSummary,
  ZanaRunSummary,
  ZanaSkillSummary,
  ZanaSprintSummary,
  ZanaTeamSummary,
  GetTeamResult,
  SaveTeamResult,
  GetProfileResult,
  SaveProfileResult,
  ZanaProfileOption,
  ZanaProfileTemplate,
  ZanaTeamTemplate
} from '../shared/types.js';
import { normalizeTeam, uniqueSlug, validateTeam } from './normalize-team.js';
import { normalizeProfile, validateProfile } from './normalize-profile.js';

/** Per-directory read cap — keeps a huge workspace from stalling the child. */
const MAX_PER_DIR = 200;
/** How many recent runs the panel shows (newest first). */
const MAX_RUNS_RETURNED = 40;
/** Cap on any single long text value (prompt/content/result) sent to the panel. */
const MAX_DETAIL_BLOCK = 8000;

const ZANA_ROOT = join(homedir(), '.zana');

type FsCap = {
  readFile(path: string, encoding?: 'utf-8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  writeFile(path: string, data: string): Promise<void>;
};

/** Parse JSON, returning undefined (not throwing) on any malformed content. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/** Coerce an unknown value to an array of non-empty strings (else []). */
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** True only for a bare, safe filename stem (no separators, no traversal). */
function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

/**
 * List `<ZANA_ROOT>/<sub>` and read every `*.json` (except `_index.json`),
 * capped at {@link MAX_PER_DIR}. Returns parsed-JSON values; unreadable or
 * malformed files are skipped. `onWarn` collects a single warning if the
 * directory itself can't be listed (typically: it doesn't exist).
 */
async function readJsonDir(
  fs: FsCap,
  sub: string,
  onWarn: (msg: string) => void
): Promise<unknown[]> {
  let names: string[];
  try {
    names = await fs.readdir(join(ZANA_ROOT, sub));
  } catch {
    return []; // absent dir is normal (e.g. no skills yet) — not a warning
  }
  const files = names
    .filter((n) => n.endsWith('.json') && n !== '_index.json')
    .slice(0, MAX_PER_DIR);
  const out: unknown[] = [];
  for (const name of files) {
    try {
      const raw = await fs.readFile(join(ZANA_ROOT, sub, name), 'utf-8');
      const val = safeParse(raw);
      if (val !== undefined) out.push(val);
    } catch (err) {
      onWarn(`skipped ${sub}/${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

function toTeam(v: unknown): ZanaTeamSummary | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = asString(o.id);
  const name = asString(o.name);
  if (!id || !name) return null;
  const rules = (o.rules && typeof o.rules === 'object' ? o.rules : {}) as Record<string, unknown>;
  const maxWorkers =
    typeof rules.maxConcurrentWorkers === 'number'
      ? rules.maxConcurrentWorkers
      : typeof o.maxTotalWorkers === 'number'
        ? o.maxTotalWorkers
        : undefined;

  // A slot is `{ profileId, quantity }`. Sum quantities for the real headcount
  // and build a compact roster preview ("architect · backend-dev×2").
  const slotArr = Array.isArray(o.slots) ? (o.slots as unknown[]) : [];
  let workerTotal = 0;
  const rosterParts: string[] = [];
  for (const s of slotArr) {
    if (!s || typeof s !== 'object') continue;
    const so = s as Record<string, unknown>;
    const pid = asString(so.profileId);
    const qty = typeof so.quantity === 'number' && so.quantity > 0 ? so.quantity : 1;
    workerTotal += qty;
    if (pid) rosterParts.push(qty > 1 ? `${pid}×${qty}` : pid);
  }
  const roster = rosterParts.slice(0, 6).join(' · ') || undefined;

  return {
    id,
    name,
    icon: asString(o.icon),
    description: asString(o.description),
    slots: slotArr.length,
    workerTotal,
    roster,
    maxWorkers,
    autoStart: o.autoStart === true,
    updatedAt: asString(o.updatedAt)
  };
}

function toProfile(v: unknown): ZanaProfileSummary | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = asString(o.id);
  if (!id) return null;
  // Zana profile files store the human label under `displayName`; some legacy
  // records use `name`. Fall back to the id only when neither is present.
  return {
    id,
    name: asString(o.displayName) ?? asString(o.name) ?? id,
    icon: asString(o.icon),
    model: asString(o.model),
    category: asString(o.category),
    description: asString(o.description)
  };
}

function toSkill(v: unknown): ZanaSkillSummary | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = asString(o.id);
  if (!id) return null;
  return {
    id,
    name: asString(o.name) ?? id,
    type: asString(o.type),
    enabled: o.enabled !== false,
    description: asString(o.description)
  };
}

function toRun(v: unknown): ZanaRunSummary | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = asString(o.id);
  if (!id) return null;
  return {
    id,
    profileName: asString(o.profileName),
    profileIcon: asString(o.profileIcon),
    state: asString(o.state) ?? 'unknown',
    model: asString(o.model),
    mode: asString(o.mode),
    lastAction: asString(o.lastAction),
    spawnedAt: typeof o.spawnedAt === 'number' ? o.spawnedAt : undefined,
    lastActivity: typeof o.lastActivity === 'number' ? o.lastActivity : undefined
  };
}

// ---- detail views -------------------------------------------------------

/** Truncate a long value and flag that it was clipped. */
function clip(s: string): string {
  return s.length > MAX_DETAIL_BLOCK ? `${s.slice(0, MAX_DETAIL_BLOCK)}\n\n… (truncated)` : s;
}

/** Push a labelled inline field only when the value is a non-empty string. */
function pushStr(out: ZanaDetailField[], label: string, v: unknown): void {
  const s = asString(v);
  if (s) out.push({ label, value: s });
}

/** Push a long, block-rendered field only when the value is a non-empty string. */
function pushBlock(out: ZanaDetailField[], label: string, v: unknown): void {
  const s = asString(v);
  if (s) out.push({ label, value: clip(s), block: true });
}

/** Compact epoch-millis / ISO string into a readable line. */
function fmtWhen(v: unknown): string | undefined {
  if (typeof v === 'number' && v > 0) return new Date(v).toLocaleString();
  return asString(v);
}

function teamDetail(o: Record<string, unknown>): ZanaDetailField[] {
  const fields: ZanaDetailField[] = [];
  const slotArr = Array.isArray(o.slots) ? (o.slots as unknown[]) : [];
  const roster = slotArr
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const so = s as Record<string, unknown>;
      const pid = asString(so.profileId);
      if (!pid) return null;
      const qty = typeof so.quantity === 'number' && so.quantity > 0 ? so.quantity : 1;
      return qty > 1 ? `${pid} ×${qty}` : pid;
    })
    .filter((x): x is string => x !== null);
  pushStr(fields, 'Description', o.description);
  pushStr(fields, 'Orchestrator', o.orchestratorProfileId);
  if (roster.length) fields.push({ label: 'Roster', value: roster.join(', ') });
  const rules = (o.rules && typeof o.rules === 'object' ? o.rules : {}) as Record<string, unknown>;
  const ruleParts: string[] = [];
  if (typeof rules.maxConcurrentWorkers === 'number') ruleParts.push(`max ${rules.maxConcurrentWorkers} concurrent`);
  if (rules.autoRestart === true) ruleParts.push('auto-restart');
  if (rules.requireApproval === true) ruleParts.push('requires approval');
  if (ruleParts.length) fields.push({ label: 'Rules', value: ruleParts.join(' · ') });
  fields.push({ label: 'Auto-start', value: o.autoStart === true ? 'yes' : 'no' });
  pushStr(fields, 'Updated', fmtWhen(o.updatedAt));
  pushBlock(fields, 'Initial prompt', o.initialPrompt);
  return fields;
}

function profileDetail(o: Record<string, unknown>): ZanaDetailField[] {
  const fields: ZanaDetailField[] = [];
  pushStr(fields, 'Description', o.description);
  pushStr(fields, 'Category', o.category);
  pushStr(fields, 'Model', o.model);
  pushStr(fields, 'Effort', o.effortLevel);
  pushStr(fields, 'Permission mode', o.permissionMode);
  if (Array.isArray(o.allowedTools) && o.allowedTools.length) {
    fields.push({ label: 'Allowed tools', value: (o.allowedTools as unknown[]).map(String).join(', ') });
  }
  pushStr(fields, 'Updated', fmtWhen(o.updatedAt));
  pushBlock(fields, 'System prompt', o.systemPrompt);
  return fields;
}

function skillDetail(o: Record<string, unknown>): ZanaDetailField[] {
  const fields: ZanaDetailField[] = [];
  pushStr(fields, 'Type', o.type);
  fields.push({ label: 'Enabled', value: o.enabled !== false ? 'yes' : 'no' });
  if (o.global === true) fields.push({ label: 'Scope', value: 'global' });
  pushStr(fields, 'Description', o.description);
  pushStr(fields, 'Updated', fmtWhen(o.updatedAt));
  pushBlock(fields, 'Content', o.content);
  return fields;
}

function runDetail(o: Record<string, unknown>): ZanaDetailField[] {
  const fields: ZanaDetailField[] = [];
  pushStr(fields, 'State', o.state);
  pushStr(fields, 'Profile', o.profileName ?? o.profileId);
  pushStr(fields, 'Model', o.model);
  pushStr(fields, 'Mode', o.mode);
  pushStr(fields, 'Working dir', o.cwd);
  if (typeof o.exitCode === 'number') fields.push({ label: 'Exit code', value: String(o.exitCode) });
  if (typeof o.tokenCount === 'number') fields.push({ label: 'Tokens', value: String(o.tokenCount) });
  pushStr(fields, 'Spawned', fmtWhen(o.spawnedAt));
  pushStr(fields, 'Last activity', fmtWhen(o.lastActivity));
  pushStr(fields, 'Last action', o.lastAction);
  pushBlock(fields, 'Prompt', o.prompt);
  pushBlock(fields, 'Result', o.result);
  return fields;
}

const DETAIL_DIRS: Record<ZanaDetailKind, string> = {
  team: 'teams',
  profile: 'profiles',
  skill: 'skills',
  run: 'runs'
};

/** Read `sprints/_index.json` (an array of `{id,status,updatedAt}`). */
async function readSprints(fs: FsCap, onWarn: (m: string) => void): Promise<ZanaSprintSummary[]> {
  try {
    const raw = await fs.readFile(join(ZANA_ROOT, 'sprints', '_index.json'), 'utf-8');
    const val = safeParse(raw);
    if (!Array.isArray(val)) return [];
    return val
      .slice(0, MAX_PER_DIR)
      .map((s): ZanaSprintSummary | null => {
        const o = (s ?? {}) as Record<string, unknown>;
        const id = asString(o.id);
        return id ? { id, status: asString(o.status) ?? 'unknown', updatedAt: asString(o.updatedAt) } : null;
      })
      .filter((s): s is ZanaSprintSummary => s !== null);
  } catch {
    return [];
  }
}

/** Count registered persistent workers (`workers.json` is an array). */
async function readWorkerCount(fs: FsCap): Promise<number> {
  try {
    const raw = await fs.readFile(join(ZANA_ROOT, 'workers.json'), 'utf-8');
    const val = safeParse(raw);
    return Array.isArray(val) ? val.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Count in-flight autopilot goals (`automation-state.json`). The file's shape
 * has shifted across Zana versions (sometimes `{ goals: {...} }`, sometimes a
 * bare id→goal map), so we count defensively: a `goals` object if present, else
 * the top-level object's own keys, else 0.
 */
async function readAutopilotGoalCount(fs: FsCap): Promise<number> {
  try {
    const raw = await fs.readFile(join(ZANA_ROOT, 'automation-state.json'), 'utf-8');
    const val = safeParse(raw);
    if (!val || typeof val !== 'object') return 0;
    const o = val as Record<string, unknown>;
    if (o.goals && typeof o.goals === 'object') return Object.keys(o.goals as object).length;
    return Object.keys(o).length;
  } catch {
    return 0;
  }
}

export default defineMainModule({
  id: 'zana-hub',
  setup(ctx) {
    /** Brokered fs — present at runtime (manifest declares `fs:read`). */
    const fs = ctx.fs as FsCap | undefined;

    /**
     * Read one team template into the full editable projection PLUS the raw
     * parsed object (so saveTeam can merge onto it and preserve unknown keys).
     * Returns null for an unsafe id, a missing file, or malformed JSON.
     */
    const getTeamImpl = async (id: string): Promise<GetTeamResult | null> => {
      if (!fs || typeof id !== 'string' || !isSafeId(id)) return null;
      let raw: string;
      try {
        raw = await fs.readFile(join(ZANA_ROOT, 'teams', `${id}.json`), 'utf-8');
      } catch {
        return null;
      }
      const val = safeParse(raw);
      if (!val || typeof val !== 'object') return null;
      const o = val as Record<string, unknown>;
      const slots = Array.isArray(o.slots)
        ? o.slots
            .map((s) => {
              const so = (s ?? {}) as Record<string, unknown>;
              const profileId = asString(so.profileId);
              const quantity = typeof so.quantity === 'number' ? so.quantity : 1;
              return profileId ? { profileId, quantity } : null;
            })
            .filter((s): s is { profileId: string; quantity: number } => s !== null)
        : [];
      const rules = (o.rules && typeof o.rules === 'object' ? o.rules : {}) as Record<string, unknown>;
      const template: ZanaTeamTemplate = {
        id: asString(o.id) ?? id,
        name: asString(o.name) ?? id,
        icon: asString(o.icon),
        description: asString(o.description),
        orchestratorProfileId: asString(o.orchestratorProfileId),
        slots,
        initialPrompt: asString(o.initialPrompt),
        maxConcurrentWorkers:
          typeof rules.maxConcurrentWorkers === 'number' ? rules.maxConcurrentWorkers : undefined,
        autoStart: o.autoStart === true
      };
      return { template, raw: o };
    };

    /**
     * Read one profile into the full editable projection PLUS the raw parsed
     * object (so saveProfile can merge onto it and preserve unknown keys).
     * Returns null for an unsafe id, a missing file, or malformed JSON.
     */
    const getProfileImpl = async (id: string): Promise<GetProfileResult | null> => {
      if (!fs || typeof id !== 'string' || !isSafeId(id)) return null;
      let raw: string;
      try {
        raw = await fs.readFile(join(ZANA_ROOT, 'profiles', `${id}.json`), 'utf-8');
      } catch {
        return null;
      }
      const val = safeParse(raw);
      if (!val || typeof val !== 'object') return null;
      const o = val as Record<string, unknown>;
      const template: ZanaProfileTemplate = {
        id: asString(o.id) ?? id,
        displayName: asString(o.displayName) ?? asString(o.name) ?? id,
        icon: asString(o.icon),
        description: asString(o.description),
        category: asString(o.category),
        model: asString(o.model),
        effortLevel: asString(o.effortLevel),
        permissionMode: asString(o.permissionMode),
        systemPrompt: asString(o.systemPrompt),
        allowedTools: asStringArray(o.allowedTools),
        disallowedTools: asStringArray(o.disallowedTools)
      };
      return { template, raw: o };
    };

    return {
      /**
       * Read the whole global Zana workspace into one overview. No args. Always
       * resolves (never throws): a missing `~/.zana` or any partial-read problem
       * is reported via `present` / `warnings`, so the panel can render an
       * honest empty/partial state instead of an error wall.
       */
      async overview(): Promise<ZanaHubOverview> {
        const warnings: string[] = [];
        const warn = (m: string) => {
          if (warnings.length < 20) warnings.push(m);
        };

        if (!fs) {
          return {
            present: false,
            teams: [],
            profiles: [],
            skills: [],
            sprints: [],
            runs: [],
            runStateCounts: {},
            workerCount: 0,
            autopilotGoalCount: 0,
            warnings: ['filesystem capability unavailable — grant fs:read for ~/.zana']
          };
        }

        // Probe presence cheaply by listing the root; absent → empty overview.
        let present = true;
        try {
          await fs.readdir(ZANA_ROOT);
        } catch {
          present = false;
        }
        if (!present) {
          return {
            present: false,
            teams: [],
            profiles: [],
            skills: [],
            sprints: [],
            runs: [],
            runStateCounts: {},
            workerCount: 0,
            autopilotGoalCount: 0,
            warnings: []
          };
        }

        const [teamsRaw, profilesRaw, skillsRaw, runsRaw, sprints, workerCount, autopilotGoalCount] =
          await Promise.all([
            readJsonDir(fs, 'teams', warn),
            readJsonDir(fs, 'profiles', warn),
            readJsonDir(fs, 'skills', warn),
            readJsonDir(fs, 'runs', warn),
            readSprints(fs, warn),
            readWorkerCount(fs),
            readAutopilotGoalCount(fs)
          ]);

        const teams = teamsRaw.map(toTeam).filter((t): t is ZanaTeamSummary => t !== null);
        const profiles = profilesRaw.map(toProfile).filter((p): p is ZanaProfileSummary => p !== null);
        const skills = skillsRaw.map(toSkill).filter((s): s is ZanaSkillSummary => s !== null);
        const allRuns = runsRaw.map(toRun).filter((r): r is ZanaRunSummary => r !== null);

        // Tally states across ALL runs, THEN slice the newest for display.
        const runStateCounts: Record<string, number> = {};
        for (const r of allRuns) runStateCounts[r.state] = (runStateCounts[r.state] ?? 0) + 1;
        const runs = allRuns
          .slice()
          .sort((a, b) => (b.lastActivity ?? b.spawnedAt ?? 0) - (a.lastActivity ?? a.spawnedAt ?? 0))
          .slice(0, MAX_RUNS_RETURNED);

        teams.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
        profiles.sort((a, b) => a.name.localeCompare(b.name));
        skills.sort((a, b) => a.name.localeCompare(b.name));

        ctx.log(
          `overview: ${teams.length} teams, ${profiles.length} profiles, ${skills.length} skills, ` +
            `${allRuns.length} runs, ${sprints.length} sprints`
        );

        return {
          present: true,
          teams,
          profiles,
          skills,
          sprints,
          runs,
          runStateCounts,
          workerCount,
          autopilotGoalCount,
          warnings
        };
      },

      getTeam: getTeamImpl,

      /** List `~/.zana/profiles` as dropdown options. Never throws. */
      async listProfiles(): Promise<ZanaProfileOption[]> {
        if (!fs) return [];
        const raws = await readJsonDir(fs, 'profiles', () => {});
        const out: ZanaProfileOption[] = [];
        for (const v of raws) {
          if (!v || typeof v !== 'object') continue;
          const o = v as Record<string, unknown>;
          const id = asString(o.id);
          if (!id) continue;
          out.push({
            id,
            displayName: asString(o.displayName) ?? asString(o.name) ?? id,
            icon: asString(o.icon)
          });
        }
        out.sort((a, b) => a.displayName.localeCompare(b.displayName));
        return out;
      },

      /**
       * The SINGLE write seam. Validates, resolves the id/filename (slug for a
       * new team, preserved for an edit), merges onto the existing raw object,
       * normalizes derived fields, and writes. Never throws — failure is data.
       */
      async saveTeam(input: ZanaTeamTemplate): Promise<SaveTeamResult> {
        if (!fs) return { ok: false, error: 'Filesystem write capability unavailable — grant fs:write for ~/.zana.' };
        const invalid = validateTeam(input);
        if (invalid) return { ok: false, error: invalid };

        // List existing stems for collision-suffixing / id resolution.
        let stems: string[] = [];
        try {
          stems = (await fs.readdir(join(ZANA_ROOT, 'teams')))
            .filter((n) => n.endsWith('.json') && n !== '_index.json')
            .map((n) => n.slice(0, -'.json'.length));
        } catch {
          stems = [];
        }

        let id: string;
        let base: Record<string, unknown> = {};
        if (input.id && isSafeId(input.id)) {
          // Edit: preserve id, merge onto the existing raw object if readable.
          id = input.id;
          const existing = await getTeamImpl(id);
          if (existing) base = existing.raw;
        } else {
          // Create: mint a unique slug from the name.
          id = uniqueSlug(input.name, stems);
        }

        const merged = normalizeTeam(input, base, id, new Date().toISOString());
        try {
          await fs.writeFile(join(ZANA_ROOT, 'teams', `${id}.json`), JSON.stringify(merged, null, 2));
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        ctx.log(`saveTeam: wrote teams/${id}.json`);
        return { ok: true, id };
      },

      getProfile: getProfileImpl,

      /**
       * The SINGLE profile write seam. Validates, resolves the id/filename
       * (a minted UUID for a new profile, preserved for an edit), merges onto
       * the existing raw object, and writes. Never throws — failure is data.
       */
      async saveProfile(input: ZanaProfileTemplate): Promise<SaveProfileResult> {
        if (!fs) return { ok: false, error: 'Filesystem write capability unavailable — grant fs:write for ~/.zana.' };
        const invalid = validateProfile(input);
        if (invalid) return { ok: false, error: invalid };

        let id: string;
        let base: Record<string, unknown> = {};
        if (input.id && isSafeId(input.id)) {
          // Edit: preserve id, merge onto the existing raw object if readable.
          id = input.id;
          const existing = await getProfileImpl(id);
          if (existing) base = existing.raw;
        } else {
          // Create: mint a UUID (Zana's own filename convention).
          id = randomUUID();
        }

        const merged = normalizeProfile(input, base, id, new Date().toISOString());
        try {
          await fs.writeFile(join(ZANA_ROOT, 'profiles', `${id}.json`), JSON.stringify(merged, null, 2));
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        ctx.log(`saveProfile: wrote profiles/${id}.json`);
        return { ok: true, id };
      },

      /**
       * Read the FULL record behind one row (a team/profile/skill/run) on
       * demand and curate it into an ordered, bounded {@link ZanaDetail} for the
       * panel's detail view. Reading only when the user clicks keeps the
       * overview payload small while still surfacing the rich fields (system
       * prompts, skill content, initial prompts, run results) the summary omits.
       *
       * `id` is treated as an opaque file stem: records are stored as
       * `<dir>/<id>.json`. It is sanitised (no separators / `..`) so a crafted
       * id can't escape the fs-gated `~/.zana` root. Resolves `null` when the
       * kind is unknown or the file is missing/unreadable/malformed.
       */
      async detail(kind: ZanaDetailKind, id: string): Promise<ZanaDetail | null> {
        if (!fs) return null;
        const dir = DETAIL_DIRS[kind];
        // Reject anything that isn't a plain file stem — defence in depth on top
        // of the broker's own root gating.
        if (!dir || typeof id !== 'string' || !/^[\w.-]+$/.test(id) || id.includes('..')) return null;

        let raw: string;
        try {
          raw = await fs.readFile(join(ZANA_ROOT, dir, `${id}.json`), 'utf-8');
        } catch {
          return null;
        }
        const val = safeParse(raw);
        if (!val || typeof val !== 'object') return null;
        const o = val as Record<string, unknown>;

        let fields: ZanaDetailField[];
        let title: string;
        if (kind === 'team') {
          fields = teamDetail(o);
          title = asString(o.name) ?? id;
        } else if (kind === 'profile') {
          fields = profileDetail(o);
          title = asString(o.displayName) ?? asString(o.name) ?? id;
        } else if (kind === 'skill') {
          fields = skillDetail(o);
          title = asString(o.name) ?? id;
        } else {
          fields = runDetail(o);
          title = asString(o.profileName) ?? id;
        }

        return { kind, id, title, icon: asString(o.icon) ?? asString(o.profileIcon), fields };
      }
    };
  }
});
