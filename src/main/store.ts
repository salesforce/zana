import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync, rmSync } from 'node:fs';
import { join, basename, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Project, ProjectRemote, AppConfig, ProjectSettings, OpenTarget, ProjectLaunchDefault, HarnessFamily } from '../shared/types.js';
import { SESSION_MEMORY_DEFAULTS, AUTO_CLOSE_IDLE_DEFAULTS } from '../shared/types.js';
import { isTerminalThemeId, DEFAULT_TERMINAL_THEME } from '../shared/terminalThemes.js';
import { PROJECT_COLORS, pickProjectColor } from '../shared/project-colors.js';
import { registeredAdapters } from './harness/registry.js';
import { atomicDurableWrite } from './harness-routing-migration/storage.js';
import { normalizeRepoUrl } from './git-clone.js';

const HARNESS_FAMILIES = ['claude', 'cursor', 'codex', 'pi', 'opencode'] as const;

function isSelectableHarness(value: unknown): value is AppConfig['defaultHarness'] {
  return typeof value === 'string' && registeredAdapters().some((provider) =>
    provider.adapter.descriptor.id === value && provider.adapter.descriptor.agentDefaultEligible
  );
}

function harnessEnabled(config: AppConfig, id: NonNullable<AppConfig['defaultHarness']>): boolean {
  if (id === 'claude') return true;
  if (id === 'cursor') return config.harnessCursorEnabled === true;
  if (id === 'codex') return config.harnessCodexEnabled === true;
  if (id === 'pi') return config.harnessPiEnabled === true;
  return config.harnessOpenCodeEnabled === true;
}

function normalizeProjectLaunchDefault(value: unknown): ProjectLaunchDefault | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const source = typeof input.source === 'string' && input.source.length <= 128 ? input.source : undefined;
  const personaId = typeof input.personaId === 'string' && input.personaId.length <= 256
    ? input.personaId
    : undefined;
  if (!source) return undefined;
  if (input.kind === 'use-global') return { schemaVersion: 1, kind: 'use-global', personaId, source };
  if ((input.kind !== 'exact-profile' && input.kind !== 'persona-pin') ||
      !isSelectableHarness(input.adapterId) ||
      typeof input.profileId !== 'string') return undefined;
  const adapter = registeredAdapters().find((provider) => provider.adapter.descriptor.id === input.adapterId);
  if (!adapter?.adapter.descriptor.profiles.some((profile) => profile.id === input.profileId)) return undefined;
  if (input.kind === 'persona-pin' && !personaId) return undefined;
  return {
    schemaVersion: 1,
    kind: input.kind,
    ...(personaId ? { personaId } : {}),
    adapterId: input.adapterId,
    profileId: input.profileId as ProjectLaunchDefault extends { profileId: infer P } ? P : never,
    source
  } as ProjectLaunchDefault;
}

function normalizeHarnessConfig(input: unknown): AppConfig['harnesses'] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const byId = (input as { byId?: unknown }).byId;
  if (!byId || typeof byId !== 'object' || Array.isArray(byId)) return undefined;
  const normalized: NonNullable<AppConfig['harnesses']>['byId'] = {};
  for (const id of HARNESS_FAMILIES) {
    const value = (byId as Record<string, unknown>)[id];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry: NonNullable<NonNullable<AppConfig['harnesses']>['byId']>[HarnessFamily] = {};
    if (typeof (value as { enabled?: unknown }).enabled === 'boolean') entry.enabled = (value as { enabled: boolean }).enabled;
    if (typeof (value as { binary?: unknown }).binary === 'string') {
      const binary = (value as { binary: string }).binary.trim();
      if (binary && binary.length <= 4096) entry.binary = binary;
    }
    const compatibility = (value as { compatibility?: unknown }).compatibility;
    if (compatibility && typeof compatibility === 'object' && !Array.isArray(compatibility)) {
      entry.compatibility = JSON.parse(JSON.stringify(compatibility));
    }
    if (Object.keys(entry).length) normalized[id] = entry;
  }
  return Object.keys(normalized).length ? { byId: normalized } : undefined;
}

export function normalizeProjectSettings(input: Partial<ProjectSettings>): ProjectSettings {
  // Preserve every legacy field byte-for-byte until Phase 0's migration journal
  // exists. This seam validates only newly introduced canonical containers.
  const { harnesses, harnessRouting, ...legacy } = input;
  const normalized: ProjectSettings = { ...legacy };
  if (harnesses && typeof harnesses === 'object' && harnesses.byId && typeof harnesses.byId === 'object') {
    const byId = Object.fromEntries(Object.entries(harnesses.byId).flatMap(([id, entry]) => {
      const compatibility = entry?.compatibility;
      return compatibility && typeof compatibility === 'object' && Object.keys(compatibility).length
        ? [[id, { compatibility: JSON.parse(JSON.stringify(compatibility)) }]]
        : [];
    }));
    normalized.harnesses = { byId };
  }
  if (harnessRouting && typeof harnessRouting === 'object' && harnessRouting.schemaVersion === 1 && harnessRouting.byAdapter && typeof harnessRouting.byAdapter === 'object') {
    normalized.harnessRouting = harnessRouting;
  }
  return normalized;
}

function projectConfigCompatibility(config: AppConfig): AppConfig {
  const next = { ...config };
  const byId = config.harnesses?.byId;
  const binaries = { claude: 'claudeBinary', cursor: 'cursorBinary', codex: 'codexBinary', pi: 'piBinary', opencode: 'opencodeBinary' } as const;
  const enabled = { cursor: 'harnessCursorEnabled', codex: 'harnessCodexEnabled', pi: 'harnessPiEnabled', opencode: 'harnessOpenCodeEnabled' } as const;
  for (const id of HARNESS_FAMILIES) {
    const entry = byId?.[id];
    if (entry?.binary !== undefined) (next as Record<string, unknown>)[binaries[id]] = entry.binary;
    if (id !== 'claude' && entry?.enabled !== undefined) (next as Record<string, unknown>)[enabled[id]] = entry.enabled;
  }
  const claude = byId?.claude?.compatibility;
  const codex = byId?.codex?.compatibility;
  const pi = byId?.pi?.compatibility;
  if (claude?.model !== undefined) next.defaultModel = claude.model as AppConfig['defaultModel'];
  if (claude?.executionPolicy?.target === 'native-default-with-auto') next.defaultPermissionMode = 'default';
  else if (claude?.permissionMode !== undefined) next.defaultPermissionMode = claude.permissionMode as AppConfig['defaultPermissionMode'];
  for (const [destination, source] of [['claudeAppendSystemPrompt', 'appendSystemPrompt'], ['claudeExtraArgs', 'extraArgs'], ['claudeAddDirs', 'addDirs'], ['claudeAllowedTools', 'allowedTools'], ['claudeDeniedTools', 'deniedTools']] as const) if (claude?.[source] !== undefined) (next as Record<string, unknown>)[destination] = claude[source];
  if (codex?.codexSandbox !== undefined) next.defaultCodexSandbox = codex.codexSandbox as AppConfig['defaultCodexSandbox'];
  if (codex?.codexApproval !== undefined) next.defaultCodexApproval = codex.codexApproval as AppConfig['defaultCodexApproval'];
  if (pi?.provider !== undefined) next.piProvider = pi.provider;
  if (pi?.model !== undefined) next.piModel = pi.model;
  if (pi?.thinking !== undefined) next.piThinking = pi.thinking as AppConfig['piThinking'];
  const auto = claude?.executionPolicy?.target === 'native-default-with-auto'
    ? claude.executionPolicy.autoMode
    : claude?.autoMode;
  if (auto?.enabled !== undefined) next.autoModeEnabled = auto.enabled;
  if (auto?.environment !== undefined) next.autoModeEnvironment = auto.environment;
  if (auto?.allow !== undefined) next.autoModeAllow = auto.allow;
  if (auto?.softDeny !== undefined) next.autoModeSoftDeny = auto.softDeny;
  if (auto?.hardDeny !== undefined) next.autoModeHardDeny = auto.hardDeny;
  if (auto?.classifyAllShell !== undefined) next.autoModeClassifyAllShell = auto.classifyAllShell;
  return next;
}

function projectSettingsCompatibility(settings: ProjectSettings): ProjectSettings {
  const next = { ...settings };
  const claude = settings.harnesses?.byId?.claude?.compatibility;
  const codex = settings.harnesses?.byId?.codex?.compatibility;
  const pi = settings.harnesses?.byId?.pi?.compatibility;
  if (claude?.model !== undefined) next.model = claude.model;
  if (claude?.permissionMode !== undefined) next.permissionMode = claude.permissionMode as ProjectSettings['permissionMode'];
  for (const key of ['appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools', 'deniedTools'] as const) if (claude?.[key] !== undefined) (next as Record<string, unknown>)[key] = claude[key];
  if (codex?.codexSandbox !== undefined) next.codexSandbox = codex.codexSandbox as ProjectSettings['codexSandbox'];
  if (codex?.codexApproval !== undefined) next.codexApproval = codex.codexApproval as ProjectSettings['codexApproval'];
  if (pi?.provider !== undefined) next.piProvider = pi.provider;
  if (pi?.model !== undefined) next.piModel = pi.model;
  if (pi?.thinking !== undefined) next.piThinking = pi.thinking as ProjectSettings['piThinking'];
  return next;
}

const RETIRED_CONFIG_KEYS = [
  'claudeBinary', 'cursorBinary', 'codexBinary', 'piBinary', 'opencodeBinary',
  'harnessCursorEnabled', 'harnessCodexEnabled', 'harnessPiEnabled', 'harnessOpenCodeEnabled',
  'defaultModel', 'defaultPermissionMode', 'claudeAppendSystemPrompt', 'claudeExtraArgs',
  'claudeAddDirs', 'claudeAllowedTools', 'claudeDeniedTools', 'defaultCodexSandbox',
  'defaultCodexApproval', 'autoModeEnabled', 'autoModeEnvironment', 'autoModeAllow',
  'autoModeSoftDeny', 'autoModeHardDeny', 'autoModeClassifyAllShell', 'piProvider', 'piModel', 'piThinking'
] as const;

const RETIRED_PROJECT_SETTINGS_KEYS = [
  'model', 'permissionMode', 'appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools',
  'deniedTools', 'codexSandbox', 'codexApproval', 'piProvider', 'piModel', 'piThinking'
] as const;

function setOrDelete(target: Record<string, any>, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function pruneEmptyHarnesses(value: { byId?: Partial<Record<HarnessFamily, Record<string, any>>> }): void {
  for (const id of HARNESS_FAMILIES) {
    const entry = value.byId?.[id];
    if (!entry) continue;
    const compatibility = entry.compatibility as Record<string, any> | undefined;
    if (compatibility?.autoMode && Object.keys(compatibility.autoMode).length === 0) delete compatibility.autoMode;
    if (compatibility?.executionPolicy?.autoMode && Object.keys(compatibility.executionPolicy.autoMode).length === 0) {
      delete compatibility.executionPolicy.autoMode;
    }
    if (compatibility && Object.keys(compatibility).length === 0) delete entry.compatibility;
    if (Object.keys(entry).length === 0) delete value.byId![id];
  }
  if (value.byId && Object.keys(value.byId).length === 0) delete value.byId;
}

function canonicalConfigForWrite(config: AppConfig): AppConfig {
  const next = JSON.parse(JSON.stringify(config)) as AppConfig;
  const source = config as Record<string, any>;
  const byId = next.harnesses ??= { byId: {} };
  byId.byId ??= {};
  const entry = (id: HarnessFamily): Record<string, any> => byId.byId![id] ??= {};
  const compat = (id: HarnessFamily): Record<string, any> => entry(id).compatibility ??= {};

  const binaries = { claude: 'claudeBinary', cursor: 'cursorBinary', codex: 'codexBinary', pi: 'piBinary', opencode: 'opencodeBinary' } as const;
  for (const id of HARNESS_FAMILIES) setOrDelete(entry(id), 'binary', source[binaries[id]]);
  const enabled = { cursor: 'harnessCursorEnabled', codex: 'harnessCodexEnabled', pi: 'harnessPiEnabled', opencode: 'harnessOpenCodeEnabled' } as const;
  for (const id of ['cursor', 'codex', 'pi', 'opencode'] as const) setOrDelete(entry(id), 'enabled', source[enabled[id]]);

  const claude = compat('claude');
  setOrDelete(claude, 'model', source.defaultModel);
  for (const [destination, sourceKey] of [['appendSystemPrompt', 'claudeAppendSystemPrompt'], ['extraArgs', 'claudeExtraArgs'], ['addDirs', 'claudeAddDirs'], ['allowedTools', 'claudeAllowedTools'], ['deniedTools', 'claudeDeniedTools']] as const) {
    setOrDelete(claude, destination, source[sourceKey]);
  }
  const nativeDefault = source.defaultPermissionMode === undefined || source.defaultPermissionMode === 'default';
  const auto = nativeDefault
    ? (claude.executionPolicy = { target: 'native-default-with-auto', autoMode: {} }).autoMode
    : (claude.autoMode ??= {});
  if (nativeDefault) {
    delete claude.permissionMode;
    delete claude.autoMode;
  } else {
    setOrDelete(claude, 'permissionMode', source.defaultPermissionMode);
    delete claude.executionPolicy;
  }
  for (const [destination, sourceKey] of [['enabled', 'autoModeEnabled'], ['environment', 'autoModeEnvironment'], ['allow', 'autoModeAllow'], ['softDeny', 'autoModeSoftDeny'], ['hardDeny', 'autoModeHardDeny'], ['classifyAllShell', 'autoModeClassifyAllShell']] as const) {
    setOrDelete(auto, destination, source[sourceKey]);
  }
  const codex = compat('codex');
  setOrDelete(codex, 'codexSandbox', source.defaultCodexSandbox);
  setOrDelete(codex, 'codexApproval', source.defaultCodexApproval);
  const pi = compat('pi');
  setOrDelete(pi, 'provider', source.piProvider);
  setOrDelete(pi, 'model', source.piModel);
  setOrDelete(pi, 'thinking', source.piThinking);

  for (const key of RETIRED_CONFIG_KEYS) delete (next as unknown as Record<string, unknown>)[key];
  pruneEmptyHarnesses(byId);
  if (!byId.byId) delete next.harnesses;
  return next;
}

function canonicalProjectSettingsForWrite(settings: ProjectSettings): ProjectSettings {
  const next = JSON.parse(JSON.stringify(settings)) as ProjectSettings;
  const source = settings as Record<string, any>;
  next.harnesses ??= { byId: {} };
  next.harnesses.byId ??= {};
  const compat = (id: HarnessFamily): Record<string, any> => {
    const entry = next.harnesses!.byId![id] ??= {};
    return entry.compatibility ??= {};
  };
  const claude = compat('claude');
  const codex = compat('codex');
  const pi = compat('pi');
  setOrDelete(claude, 'model', source.model);
  setOrDelete(codex, 'model', source.model);
  setOrDelete(claude, 'permissionMode', source.permissionMode);
  for (const key of ['appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools', 'deniedTools']) setOrDelete(claude, key, source[key]);
  setOrDelete(codex, 'codexSandbox', source.codexSandbox);
  setOrDelete(codex, 'codexApproval', source.codexApproval);
  setOrDelete(pi, 'provider', source.piProvider);
  setOrDelete(pi, 'model', source.piModel);
  setOrDelete(pi, 'thinking', source.piThinking);
  for (const key of RETIRED_PROJECT_SETTINGS_KEYS) delete (next as Record<string, unknown>)[key];
  pruneEmptyHarnesses(next.harnesses);
  if (!next.harnesses.byId) delete next.harnesses;
  return next;
}

const dataDir = join(app.getPath('home'), '.zcc');
const projectsFile = join(dataDir, 'projects.json');
const configFile = join(dataDir, 'config.json');
const projectSettingsFile = join(dataDir, 'project-settings.json');

/** Current `projects.json` schema version. v0 = bare `Project[]`. */
export const PROJECTS_SCHEMA_VERSION = 1 as const;

/** Folder name (under HOME) for the built-in scratch workspace that backs the
 *  Quick Agent and the default git clone root. Renamed from `cc-workspace` in
 *  the Zana rebrand; pre-rebrand installs are migrated on first launch (see
 *  {@link ZccStore.ensureQuickAgentProject}). */
export const SCRATCH_DIR_NAME = 'zcc-workspace';
/** Pre-rebrand scratch folder name, kept only so we can migrate it. */
const LEGACY_SCRATCH_DIR_NAME = 'cc-workspace';
/** App-managed parent for isolated git worktrees. */
export const WORKTREE_DIR_NAME = 'zcc-worktrees';

/** Absolute path to the built-in scratch workspace (`~/zcc-workspace`). Shared
 *  by the Quick Agent anchor and the clone-root fallback so both agree. */
export function scratchWorkspaceRoot(): string {
  return join(app.getPath('home'), SCRATCH_DIR_NAME);
}

/** Absolute path to the app-managed isolated worktree root (`~/zcc-worktrees`). */
export function worktreeRoot(): string {
  return join(app.getPath('home'), WORKTREE_DIR_NAME);
}

/**
 * Canonical on-disk target for a session-isolated worktree.
 * Layout: `~/zcc-worktrees/<project-tag>/<slug>`.
 */
export function worktreeTargetDir(project: Project, slug: string): string {
  const safeProject = project.tag?.trim() || slugifyTag(project.name || 'project');
  const safeSlug = /^[a-z0-9](?:[a-z0-9_]{0,39})$/.test(slug) ? slug : 'agent';
  return join(worktreeRoot(), safeProject, safeSlug);
}

/** Category label for the per-extension projects the "create your own
 *  extension" flow spawns. The Projects rail groups these into their own
 *  section. Shared so the store and the rail agree on the exact string. */
export const EXTENSION_PROJECT_CATEGORY = 'Extensions';

/**
 * Best-effort check: does `dir` hold a local extension's SOURCE — an
 * `extension.json` whose `id` matches the folder name (the SDK contract that
 * `manifest.id` IS the install-dir name)? Used so `addProject` can classify a
 * directly-created extension source (one that never went through the Creator's
 * `ensureExtensionProject` seam) as an Extension instead of a plain "Local"
 * project. Returns the manifest `title` when it qualifies, else null.
 *
 * Deliberately shallow and throw-free: any read/parse/shape failure just means
 * "not an extension source" — this only refines a project's display grouping,
 * so a false negative degrades gracefully to the plain-project path.
 */
function detectExtensionSource(dir: string): { title: string } | null {
  try {
    const manifestPath = join(dir, 'extension.json');
    if (!existsSync(manifestPath)) return null;
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;
    // manifest.id is the module namespace and MUST equal the dir name (same
    // rule discovery enforces); a mismatch is not an installable extension.
    if (typeof raw.id !== 'string' || raw.id !== basename(dir)) return null;
    if (typeof raw.title !== 'string' || !raw.title) return null;
    const entry = raw.entry as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== 'object') return null;
    if (typeof entry.renderer !== 'string' && typeof entry.main !== 'string') return null;
    return { title: raw.title };
  } catch {
    return null;
  }
}

/**
 * Detect an auto-generated Quick Agent scratch-subfolder name (see
 * {@link ZccStore.createScratchSubfolder}: `<slug>-<14-digit-timestamp>` or
 * `session-<timestamp>`, optionally suffixed `-<n>` on a same-second collision).
 * Lets `addProject` prefer a repo's real name over this synthetic one once real
 * content (a git clone) has landed inside it.
 */
const SCRATCH_FOLDER_NAME_RE = /-\d{14}(-\d+)?$/;

function isGeneratedScratchFolder(path: string): boolean {
  return dirname(path) === scratchWorkspaceRoot() && SCRATCH_FOLDER_NAME_RE.test(basename(path));
}

/**
 * Best-effort: read `dir`'s git origin remote and derive a repo-style name from
 * it (e.g. `owner/repo.git` → `repo`), reusing the same URL parsing the
 * import-from-git flow uses. Returns null if `dir` isn't a git repo, has no
 * origin, or the origin URL isn't in a recognized form — callers treat that as
 * "keep the synthetic name," never as an error.
 */
function deriveNameFromGitOrigin(dir: string): string | null {
  try {
    const origin = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString('utf8')
      .trim();
    if (!origin) return null;
    return normalizeRepoUrl(origin).repoName || null;
  } catch {
    return null;
  }
}

/** On-disk shape since v1. v0 is the bare-array legacy form (auto-migrated on read). */
export interface ProjectsFile {
  version: typeof PROJECTS_SCHEMA_VERSION;
  projects: Project[];
}

const TAG_REGEX = /^[a-z0-9][a-z0-9_-]{0,32}$/;
const TAG_MAX_LEN = 33; // 1 + 32

function ensureDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function readJsonRaw<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir();
  atomicDurableWrite(file, Buffer.from(JSON.stringify(value, null, 2)));
}

/**
 * Pre-record an app-managed directory as trusted in the Claude CLI config
 * (`~/.claude.json`, honoring `ZCC_CLAUDE_HOME` for tests) so a freshly-minted
 * scratch workspace doesn't trip Claude Code's "Do you trust this folder?"
 * safety prompt on every single launch. We only ever do this for directories
 * WE create under the scratch root — never a user-supplied path — so marking
 * them trusted is safe (the folder is empty and app-owned at mint time). The
 * write is a merge (preserving every other project entry) and best-effort:
 * if the config is missing/locked/corrupt we simply skip, and the user just
 * sees the normal one-time prompt rather than an error.
 */
function trustDirInClaudeConfig(dir: string): void {
  try {
    const claudeHome = process.env.ZCC_CLAUDE_HOME || app.getPath('home');
    const configPath = join(claudeHome, '.claude.json');
    const config = readJsonRaw<{ projects?: Record<string, Record<string, unknown>> }>(
      configPath,
      {}
    );
    config.projects = config.projects ?? {};
    const existing = config.projects[dir] ?? {};
    if (existing.hasTrustDialogAccepted === true) return; // already trusted
    config.projects[dir] = { ...existing, hasTrustDialogAccepted: true };
    const tmp = `${configPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(config, null, 2));
    renameSync(tmp, configPath);
  } catch {
    /* best-effort: on any failure the user just gets the normal trust prompt */
  }
}

/**
 * Slugify a project name into a tag candidate. Lowercases, normalizes
 * accented characters, replaces runs of unsupported chars with `-`,
 * trims leading/trailing separators, and clamps to the 33-char regex
 * window. Returns a fallback if the input has no valid leading char.
 */
export function slugifyTag(name: string): string {
  const base = (name || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip combining marks (diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_MAX_LEN);
  if (base.length === 0 || !TAG_REGEX.test(base)) {
    // Fall back to a stable but non-empty seed; caller's dedupe loop
    // will append numeric suffixes if needed.
    return 'project';
  }
  return base;
}

/**
 * Append `-2`, `-3`, … until the tag is unique against `taken`. Honors
 * the regex max length (33) by trimming the base before appending the
 * numeric suffix. `taken` is a Set of already-claimed tags.
 */
export function dedupeTag(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`;
    const trimmedBase = base.length + suffix.length > TAG_MAX_LEN
      ? base.slice(0, TAG_MAX_LEN - suffix.length).replace(/-+$/, '') || 'project'
      : base;
    const candidate = `${trimmedBase}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Astronomical fallback — cryptographically unique suffix.
  return `${base.slice(0, 24)}-${randomUUID().slice(0, 8)}`;
}

/**
 * Pick a fresh tag for a project: slugify its name and dedupe against
 * the supplied set of already-taken tags. Exported for testability.
 */
export function pickTag(name: string, taken: Set<string>): string {
  return dedupeTag(slugifyTag(name), taken);
}

/**
 * Read & migrate `projects.json`. v0 (bare array) is treated as legacy
 * and rewritten to v1 on the next write. Unknown future versions are
 * defensively coerced to v1 with the provided projects list.
 */
function readProjectsFile(): ProjectsFile {
  const raw = readJsonRaw<unknown>(projectsFile, null);
  if (raw == null) return { version: PROJECTS_SCHEMA_VERSION, projects: [] };
  if (Array.isArray(raw)) {
    // Legacy v0 — bare array.
    return { version: PROJECTS_SCHEMA_VERSION, projects: raw as Project[] };
  }
  if (typeof raw === 'object' && raw !== null && 'projects' in raw && Array.isArray((raw as { projects: unknown }).projects)) {
    const projects = (raw as { projects: Project[] }).projects;
    return { version: PROJECTS_SCHEMA_VERSION, projects };
  }
  // Defensive: malformed shape — treat as empty rather than crash.
  return { version: PROJECTS_SCHEMA_VERSION, projects: [] };
}

function writeProjects(projects: Project[]) {
  const file: ProjectsFile = { version: PROJECTS_SCHEMA_VERSION, projects };
  writeJson(projectsFile, file);
}

/**
 * If `project.tag` is absent, slugify+dedupe its name against `taken`
 * and return a copy with the tag set. Otherwise returns the input
 * unchanged. The returned `taken` set is mutated to include the new
 * tag so callers can chain backfills in a single pass.
 */
export function backfillProjectTag(project: Project, taken: Set<string>): Project {
  if (project.tag && TAG_REGEX.test(project.tag)) return project;
  const tag = pickTag(project.name, taken);
  taken.add(tag);
  return { ...project, tag };
}

/**
 * If `project.color` is absent, assign the least-used palette color given the
 * colors already claimed (`inUse`) and return a copy with it set. A project
 * that already has any color — including a hand-edited hex outside the palette
 * — is returned unchanged. `inUse` is mutated to include the assigned color so
 * callers can chain backfills in one pass and keep colors spread out.
 */
export function backfillProjectColor(project: Project, inUse: string[]): Project {
  if (project.color) return project;
  const color = pickProjectColor(inUse);
  inUse.push(color);
  return { ...project, color };
}

/**
 * Validate a free-text remote-project field. Trims, length-caps at 256, and
 * rejects ASCII control chars so the value can't smuggle newlines/escapes
 * through the JSON round-trip or into shell argv.
 */
function sanitizeRemoteField(
  value: string | undefined,
  field: string,
  opts: { required?: boolean } = {}
): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    if (opts.required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (trimmed.length > 256) throw new Error(`${field} too long (max 256)`);
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`${field} contains control characters`);
    }
  }
  return trimmed;
}

function normalizeBounds(
  bounds: AppConfig['windowBounds'] | undefined
): AppConfig['windowBounds'] | undefined {
  if (!bounds) return undefined;
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return undefined;
  const width = Math.max(900, Math.round(bounds.width));
  const height = Math.max(600, Math.round(bounds.height));
  const next: AppConfig['windowBounds'] = { width, height };
  if (typeof bounds.x === 'number' && Number.isFinite(bounds.x)) next.x = Math.round(bounds.x);
  if (typeof bounds.y === 'number' && Number.isFinite(bounds.y)) next.y = Math.round(bounds.y);
  return next;
}

export function normalizeConfig(input: Partial<AppConfig>): Partial<AppConfig> {
  const normalized: Partial<AppConfig> = {};
  const harnesses = normalizeHarnessConfig(input.harnesses);
  if (harnesses) normalized.harnesses = harnesses;
  if (input.harnessRouting && typeof input.harnessRouting === 'object' && input.harnessRouting.schemaVersion === 1 && input.harnessRouting.byAdapter && typeof input.harnessRouting.byAdapter === 'object') {
    const byAdapter = Object.fromEntries(
      Object.entries(input.harnessRouting.byAdapter).flatMap(([adapterId, routing]) => {
        if (!HARNESS_FAMILIES.includes(adapterId as HarnessFamily) || !routing || typeof routing !== 'object') return [];
        const modelTargetId = (routing as { modelTargetId?: unknown }).modelTargetId;
        const providerTargetId = (routing as { providerTargetId?: unknown }).providerTargetId;
        const modelLevel = (routing as { modelLevel?: unknown }).modelLevel;
        const executionState = (routing as { executionState?: unknown }).executionState;
        const entry: { providerTargetId?: string; modelTargetId?: string; modelLevel?: 'low' | 'medium' | 'high' | 'extra-high'; executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous' } = {};
        if (typeof providerTargetId === 'string' && providerTargetId.trim() && providerTargetId.length <= 256) entry.providerTargetId = providerTargetId;
        if (typeof modelTargetId === 'string' && modelTargetId.trim() && modelTargetId.length <= 512) entry.modelTargetId = modelTargetId;
        if (modelLevel === 'low' || modelLevel === 'medium' || modelLevel === 'high' || modelLevel === 'extra-high') entry.modelLevel = modelLevel;
        if (executionState === 'plan' || executionState === 'interactive' || executionState === 'accept-edits' || executionState === 'autonomous') entry.executionState = executionState;
        return Object.keys(entry).length ? [[adapterId, entry]] : [];
      })
    );
    if (Object.keys(byAdapter).length) normalized.harnessRouting = { schemaVersion: 1, byAdapter };
  }
  if (isSelectableHarness(input.defaultHarness)) normalized.defaultHarness = input.defaultHarness;
  if (input.theme === 'dark' || input.theme === 'light' || input.theme === 'system') {
    normalized.theme = input.theme;
  }
  if (isTerminalThemeId(input.terminalTheme)) normalized.terminalTheme = input.terminalTheme;
  if (typeof input.shell === 'string' && input.shell.trim()) normalized.shell = input.shell.trim();
  if (typeof input.claudeBinary === 'string' && input.claudeBinary.trim()) {
    normalized.claudeBinary = input.claudeBinary.trim();
  }
  if (typeof input.claudeAppendSystemPrompt === 'string') {
    const prompt = input.claudeAppendSystemPrompt.trim();
    normalized.claudeAppendSystemPrompt = prompt || undefined;
  }
  const normalizeClaudeList = (value: unknown, maxItems = 100): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const entries = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return [...new Set(entries)].slice(0, maxItems);
  };
  if ('claudeExtraArgs' in input) normalized.claudeExtraArgs = normalizeClaudeList(input.claudeExtraArgs, 200);
  if ('claudeAddDirs' in input) normalized.claudeAddDirs = normalizeClaudeList(input.claudeAddDirs);
  if ('claudeAllowedTools' in input) normalized.claudeAllowedTools = normalizeClaudeList(input.claudeAllowedTools);
  if ('claudeDeniedTools' in input) normalized.claudeDeniedTools = normalizeClaudeList(input.claudeDeniedTools);
  if (
    input.defaultCodexSandbox === 'read-only' ||
    input.defaultCodexSandbox === 'workspace-write' ||
    input.defaultCodexSandbox === 'danger-full-access'
  ) {
    normalized.defaultCodexSandbox = input.defaultCodexSandbox;
  }
  if (
    input.defaultCodexApproval === 'untrusted' ||
    input.defaultCodexApproval === 'on-request' ||
    input.defaultCodexApproval === 'never'
  ) {
    normalized.defaultCodexApproval = input.defaultCodexApproval;
  }
  // Optional per-provider binaries: a blank/whitespace value clears the override
  // (the provider then falls back to the bare name on PATH), so — unlike the
  // required claudeBinary — an empty string is a meaningful "unset".
  if (typeof input.cursorBinary === 'string') {
    const t = input.cursorBinary.trim();
    normalized.cursorBinary = t || undefined;
  }
  if (typeof input.codexBinary === 'string') {
    const t = input.codexBinary.trim();
    normalized.codexBinary = t || undefined;
  }
  if (typeof input.piBinary === 'string') {
    const t = input.piBinary.trim();
    normalized.piBinary = t || undefined;
  }
  if (typeof input.opencodeBinary === 'string') {
    const t = input.opencodeBinary.trim();
    normalized.opencodeBinary = t || undefined;
  }
  if (typeof input.harnessCursorEnabled === 'boolean') {
    normalized.harnessCursorEnabled = input.harnessCursorEnabled;
  }
  if (typeof input.harnessCodexEnabled === 'boolean') {
    normalized.harnessCodexEnabled = input.harnessCodexEnabled;
  }
  if (typeof input.harnessPiEnabled === 'boolean') {
    normalized.harnessPiEnabled = input.harnessPiEnabled;
  }
  if (typeof input.harnessOpenCodeEnabled === 'boolean') {
    normalized.harnessOpenCodeEnabled = input.harnessOpenCodeEnabled;
  }
  if (typeof input.microVmEnabled === 'boolean') {
    normalized.microVmEnabled = input.microVmEnabled;
  }
  // PI launch defaults: blank/whitespace clears the override (PI then uses its
  // own configured default). Same "empty string = unset" shape as the binaries.
  if (typeof input.piProvider === 'string') {
    const t = input.piProvider.trim();
    normalized.piProvider = t || undefined;
  }
  if (typeof input.piModel === 'string') {
    const t = input.piModel.trim();
    normalized.piModel = t || undefined;
  }
  if (typeof input.piThinking === 'string') {
    const t = input.piThinking.trim();
    normalized.piThinking = t && t !== 'default' ? (t as NonNullable<AppConfig['piThinking']>) : undefined;
  }
  // External-editor / opener overrides (Settings → Editor). Blank/whitespace
  // clears the override (the opener then uses the built-in default), the same
  // "empty string = unset" shape as the harness binaries above.
  for (const key of [
    'editorCursorBinary',
    'editorCursorApp',
    'editorCodeBinary',
    'editorCodeApp',
    'editorIntellijBinary',
    'editorIntellijApp',
    'terminalApp'
  ] as const) {
    if (typeof input[key] === 'string') {
      const t = (input[key] as string).trim();
      normalized[key] = t || undefined;
    }
  }
  if (Array.isArray(input.openerHiddenTargets)) {
    const valid: OpenTarget[] = ['cursor', 'code', 'intellij', 'finder', 'terminal', 'browser'];
    const seen = new Set<OpenTarget>();
    for (const t of input.openerHiddenTargets) {
      if (typeof t === 'string' && (valid as string[]).includes(t)) seen.add(t as OpenTarget);
    }
    normalized.openerHiddenTargets = seen.size ? [...seen] : undefined;
  }
  if (typeof input.suggestionsEnabled === 'boolean') {
    normalized.suggestionsEnabled = input.suggestionsEnabled;
  }
  if (typeof input.trustZccToolsEnabled === 'boolean') {
    normalized.trustZccToolsEnabled = input.trustZccToolsEnabled;
  }
  if (typeof input.worktreeIsolationDefault === 'boolean') {
    normalized.worktreeIsolationDefault = input.worktreeIsolationDefault;
  }
  if (
    input.reviewerApprovalMode === 'ask' ||
    input.reviewerApprovalMode === 'approveForMe' ||
    input.reviewerApprovalMode === 'fullAccess'
  ) {
    // Enum (mirrors overseerMode): only whitelisted values kept; anything else
    // leaves it unset so the 'ask' default applies. Renderer untrusted (rule 1).
    normalized.reviewerApprovalMode = input.reviewerApprovalMode;
  }
  if (typeof input.askUserQuestionUiEnabled === 'boolean') {
    normalized.askUserQuestionUiEnabled = input.askUserQuestionUiEnabled;
  }
  if (typeof input.extensionLlmEnabled === 'boolean') {
    normalized.extensionLlmEnabled = input.extensionLlmEnabled;
  }
  if (typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)) {
    normalized.fontSize = Math.max(10, Math.min(20, Math.round(input.fontSize)));
  }
  if (typeof input.lastProjectId === 'string' || input.lastProjectId === null) {
    normalized.lastProjectId = input.lastProjectId;
  }
  if (input.workspaceModes && typeof input.workspaceModes === 'object') {
    // A project view is either a core WorkspaceMode literal OR an opaque
    // extension module id (an extension-contributed project tab, e.g. the
    // `zana-tickets` extension). Core never enumerates extension ids, so we
    // can't value-whitelist here — validate shape only (non-empty string),
    // mirroring the renderer's own persist filter (`if (v) …`). A stale id
    // whose extension is gone on next launch is tolerated at render time
    // (falls back to the default view). See ProjectView / AppConfig.workspaceModes.
    normalized.workspaceModes = Object.fromEntries(
      Object.entries(input.workspaceModes).filter(
        (_entry): _entry is [string, string] =>
          typeof _entry[1] === 'string' && _entry[1].length > 0
      )
    );
  }
  if (
    input.agentsBoardView === 'board' ||
    input.agentsBoardView === 'list' ||
    input.agentsBoardView === 'flow'
  ) {
    normalized.agentsBoardView = input.agentsBoardView;
  }
  if (input.inboxGrouping === 'project' || input.inboxGrouping === 'time') {
    normalized.inboxGrouping = input.inboxGrouping;
  }
  if (typeof input.listPaneWidth === 'number' && Number.isFinite(input.listPaneWidth)) {
    normalized.listPaneWidth = Math.max(200, Math.min(600, Math.round(input.listPaneWidth)));
  }
  if (
    input.defaultModel === 'opus' ||
    input.defaultModel === 'sonnet' ||
    input.defaultModel === 'haiku' ||
    input.defaultModel === 'default'
  ) {
    normalized.defaultModel = input.defaultModel;
  }
  if (
    input.defaultPermissionMode === 'default' ||
    input.defaultPermissionMode === 'acceptEdits' ||
    input.defaultPermissionMode === 'plan' ||
    input.defaultPermissionMode === 'bypassPermissions'
  ) {
    normalized.defaultPermissionMode = input.defaultPermissionMode;
  }
  if (['plan', 'interactive', 'accept-edits', 'autonomous'].includes(input.defaultExecutionState ?? '')) {
    normalized.defaultExecutionState = input.defaultExecutionState;
  }
  if (typeof input.inboxGuidanceEnabled === 'boolean') {
    normalized.inboxGuidanceEnabled = input.inboxGuidanceEnabled;
  }
  if (typeof input.terminalWheelArrowsEnabled === 'boolean') {
    normalized.terminalWheelArrowsEnabled = input.terminalWheelArrowsEnabled;
  }
  if (typeof input.skippedUpdateVersion === 'string' && input.skippedUpdateVersion.trim()) {
    normalized.skippedUpdateVersion = input.skippedUpdateVersion.trim();
  }
  if (
    typeof input.lastSeenVersion === 'string' &&
    input.lastSeenVersion.trim() &&
    input.lastSeenVersion.trim().length <= 64
  ) {
    normalized.lastSeenVersion = input.lastSeenVersion.trim();
  }
  if (typeof input.walkthroughCompleted === 'boolean') {
    normalized.walkthroughCompleted = input.walkthroughCompleted;
  }
  if (typeof input.setupDismissed === 'boolean') {
    normalized.setupDismissed = input.setupDismissed;
  }
  if (typeof input.sponsorPromptDismissed === 'boolean') {
    normalized.sponsorPromptDismissed = input.sponsorPromptDismissed;
  }
  if (typeof input.autoRenameTabs === 'boolean') {
    normalized.autoRenameTabs = input.autoRenameTabs;
  }
  if (
    input.overseerMode === 'off' ||
    input.overseerMode === 'dryRun' ||
    input.overseerMode === 'on'
  ) {
    // Enum: only whitelisted values are kept; anything missing/invalid leaves
    // it unset so the `off` default applies. The renderer is untrusted, so a
    // hand-edited / IPC-supplied value is validated here in main (rule 1).
    normalized.overseerMode = input.overseerMode;
  }
  if (typeof input.overseerLlmTierEnabled === 'boolean') {
    normalized.overseerLlmTierEnabled = input.overseerLlmTierEnabled;
  }
  if (typeof input.overseerDeepTierEnabled === 'boolean') {
    normalized.overseerDeepTierEnabled = input.overseerDeepTierEnabled;
  }
  if (Array.isArray(input.overseerDenyPatterns)) {
    // Keep only non-empty strings, trimmed, deduped, and capped — a runaway
    // list would bloat config and slow every decision. Bound at 100 patterns.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of input.overseerDenyPatterns) {
      if (typeof p !== 'string') continue;
      const t = p.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 100) break;
    }
    normalized.overseerDenyPatterns = out;
  }
  if (typeof input.autoModeEnabled === 'boolean') {
    normalized.autoModeEnabled = input.autoModeEnabled;
  }
  // Auto mode classifier rule lists. Each is prose read by the classifier, so we
  // only trim/dedupe/cap — the renderer is untrusted (rule 1) and these end up in
  // the launcher-emitted --settings JSON. Bounded at 100 entries apiece like
  // overseerDenyPatterns so a runaway list can't bloat every launch's settings.
  const normStrArray = (arr: unknown): string[] | undefined => {
    if (!Array.isArray(arr)) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of arr) {
      if (typeof p !== 'string') continue;
      const t = p.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 100) break;
    }
    return out;
  };
  const envList = normStrArray(input.autoModeEnvironment);
  if (envList) normalized.autoModeEnvironment = envList;
  const allowList = normStrArray(input.autoModeAllow);
  if (allowList) normalized.autoModeAllow = allowList;
  const softList = normStrArray(input.autoModeSoftDeny);
  if (softList) normalized.autoModeSoftDeny = softList;
  const hardList = normStrArray(input.autoModeHardDeny);
  if (hardList) normalized.autoModeHardDeny = hardList;
  if (typeof input.autoModeClassifyAllShell === 'boolean') {
    normalized.autoModeClassifyAllShell = input.autoModeClassifyAllShell;
  }
  if (
    input.contentScreenMode === 'off' ||
    input.contentScreenMode === 'dryRun' ||
    input.contentScreenMode === 'on'
  ) {
    // Enum (mirrors overseerMode): only whitelisted values are kept; anything
    // missing/invalid leaves it unset so the `off` default applies. The
    // renderer is untrusted, so a hand-edited / IPC-supplied value is
    // validated here in main (rule 1).
    normalized.contentScreenMode = input.contentScreenMode;
  }
  if (typeof input.idleTriageEnabled === 'boolean') {
    normalized.idleTriageEnabled = input.idleTriageEnabled;
  }
  if (typeof input.heldQuestionsEnabled === 'boolean') {
    normalized.heldQuestionsEnabled = input.heldQuestionsEnabled;
  }
  if (typeof input.agentListNeedsYouFromTriage === 'boolean') {
    normalized.agentListNeedsYouFromTriage = input.agentListNeedsYouFromTriage;
  }
  if (typeof input.followupsFromIdle === 'boolean') {
    normalized.followupsFromIdle = input.followupsFromIdle;
  }
  if (typeof input.idleTriageDelaySeconds === 'number' && Number.isFinite(input.idleTriageDelaySeconds)) {
    // Same clamp window as heartbeatDelaySeconds (10–600s): below 10s would
    // re-introduce the idle-flicker triaging the dwell exists to suppress;
    // above 600s the read is too stale to be useful. The renderer is untrusted,
    // so a hand-edited / IPC-supplied value is clamped here in main (rule 1).
    normalized.idleTriageDelaySeconds = Math.max(10, Math.min(600, Math.round(input.idleTriageDelaySeconds)));
  }
  if (typeof input.catchUpSummaryEnabled === 'boolean') {
    normalized.catchUpSummaryEnabled = input.catchUpSummaryEnabled;
  }
  if (typeof input.feedNoiseClassifierEnabled === 'boolean') {
    normalized.feedNoiseClassifierEnabled = input.feedNoiseClassifierEnabled;
  }
  if (typeof input.autoReportLinkEnabled === 'boolean') {
    normalized.autoReportLinkEnabled = input.autoReportLinkEnabled;
  }
  if (typeof input.structuredQuestionsEnabled === 'boolean') {
    normalized.structuredQuestionsEnabled = input.structuredQuestionsEnabled;
  }
  if (typeof input.catchUpSummaryDelaySeconds === 'number' && Number.isFinite(input.catchUpSummaryDelaySeconds)) {
    // Same clamp as idleTriageDelaySeconds (10–600s) — mirrors the same cost-
    // discipline + staleness reasoning. The renderer is untrusted (rule 1).
    normalized.catchUpSummaryDelaySeconds = Math.max(10, Math.min(600, Math.round(input.catchUpSummaryDelaySeconds)));
  }
  if (
    input.idleAttentionSensitivity === 'high' ||
    input.idleAttentionSensitivity === 'medium' ||
    input.idleAttentionSensitivity === 'low'
  ) {
    // Named-level enum: only the whitelisted values are kept; anything
    // missing/invalid falls back to the 'medium' default at read time (left
    // unset here so the default applies).
    normalized.idleAttentionSensitivity = input.idleAttentionSensitivity;
  }
  if (typeof input.agentSelfCloseEnabled === 'boolean') {
    normalized.agentSelfCloseEnabled = input.agentSelfCloseEnabled;
  }
  if (typeof input.closeIdlePeersEnabled === 'boolean') {
    normalized.closeIdlePeersEnabled = input.closeIdlePeersEnabled;
  }
  if (typeof input.autoCloseIdleEnabled === 'boolean') {
    normalized.autoCloseIdleEnabled = input.autoCloseIdleEnabled;
  }
  if (typeof input.confirmQuitOnLiveSessions === 'boolean') {
    normalized.confirmQuitOnLiveSessions = input.confirmQuitOnLiveSessions;
  }
  if (typeof input.autoCloseIdleMinutes === 'number' && Number.isFinite(input.autoCloseIdleMinutes)) {
    normalized.autoCloseIdleMinutes = Math.max(
      AUTO_CLOSE_IDLE_DEFAULTS.minMinutes,
      Math.min(AUTO_CLOSE_IDLE_DEFAULTS.maxMinutes, Math.round(input.autoCloseIdleMinutes))
    );
  }
  if (typeof input.autoCloseIdleNotifyInbox === 'boolean') {
    normalized.autoCloseIdleNotifyInbox = input.autoCloseIdleNotifyInbox;
  }
  if (typeof input.teamLaunchEnabled === 'boolean') {
    normalized.teamLaunchEnabled = input.teamLaunchEnabled;
  }
  if (typeof input.teamJobLaunchEnabled === 'boolean') {
    normalized.teamJobLaunchEnabled = input.teamJobLaunchEnabled;
  }
  if (typeof input.goalsEnabled === 'boolean') {
    normalized.goalsEnabled = input.goalsEnabled;
  }
  if (typeof input.followUpsEnabled === 'boolean') {
    normalized.followUpsEnabled = input.followUpsEnabled;
  }
  if (typeof input.heartbeatEnabled === 'boolean') {
    normalized.heartbeatEnabled = input.heartbeatEnabled;
  }
  if (typeof input.keepAwakeWhileWorking === 'boolean') {
    normalized.keepAwakeWhileWorking = input.keepAwakeWhileWorking;
  }
  if (typeof input.heartbeatDelaySeconds === 'number' && Number.isFinite(input.heartbeatDelaySeconds)) {
    normalized.heartbeatDelaySeconds = Math.max(10, Math.min(600, Math.round(input.heartbeatDelaySeconds)));
  }
  if (typeof input.heartbeatMaxNudges === 'number' && Number.isFinite(input.heartbeatMaxNudges)) {
    normalized.heartbeatMaxNudges = Math.max(1, Math.min(100, Math.round(input.heartbeatMaxNudges)));
  }
  if (typeof input.heartbeatMessage === 'string') {
    // Trim and cap; empty string clears the override (back to the built-in
    // default at read time). Cap guards against a pathological paste being
    // typed into a live session on every nudge.
    normalized.heartbeatMessage = input.heartbeatMessage.trim().slice(0, 1000);
  }
  if (typeof input.remoteDefaultPath === 'string') {
    // Global fallback start path for remotes with no per-project remotePath.
    // Same sanitation as the per-project field (trim, control-char reject,
    // length cap); empty string clears it (back to remote $HOME at read time).
    // sanitizeRemoteField throws on a control char / over-length value; if that
    // happens, leave the field unset rather than abort the whole config write.
    try {
      const cleaned = sanitizeRemoteField(input.remoteDefaultPath, 'remoteDefaultPath');
      if (cleaned) normalized.remoteDefaultPath = cleaned;
    } catch {
      /* invalid value ignored — keep the previous setting */
    }
  }
  if (
    input.tmuxScope === 'off' ||
    input.tmuxScope === 'remote' ||
    input.tmuxScope === 'all'
  ) {
    // Enum (mirrors overseerMode/contentScreenMode): only whitelisted values
    // kept; anything missing/invalid leaves it unset so the `all` default
    // applies. The renderer is untrusted, so a hand-edited / IPC-supplied
    // value is validated here in main (rule 1).
    normalized.tmuxScope = input.tmuxScope;
  }
  if (typeof input.remoteMcpEnabled === 'boolean') {
    normalized.remoteMcpEnabled = input.remoteMcpEnabled;
  }
  if (typeof input.enableUpdateSimulation === 'boolean') {
    normalized.enableUpdateSimulation = input.enableUpdateSimulation;
  }
  if (typeof input.voiceInputEnabled === 'boolean') {
    normalized.voiceInputEnabled = input.voiceInputEnabled;
  }
  if (typeof input.menubarPopoverEnabled === 'boolean') {
    normalized.menubarPopoverEnabled = input.menubarPopoverEnabled;
  }
  if (typeof input.localExtensionHotReloadEnabled === 'boolean') {
    normalized.localExtensionHotReloadEnabled = input.localExtensionHotReloadEnabled;
  }
  if (typeof input.voiceModel === 'string') {
    normalized.voiceModel = input.voiceModel.trim();
  }
  if (typeof input.voiceLanguage === 'string') {
    normalized.voiceLanguage = input.voiceLanguage.trim();
  }
  if (typeof input.maxLiveSessions === 'number' && Number.isFinite(input.maxLiveSessions)) {
    // Clamp to [min, hard-ceiling] so a hand-edited config can neither disable
    // the fd/memory guard (0 or negative) nor blow past the fd-safe ceiling.
    normalized.maxLiveSessions = Math.max(
      SESSION_MEMORY_DEFAULTS.minLiveSessions,
      Math.min(SESSION_MEMORY_DEFAULTS.maxLiveSessionsCeiling, Math.round(input.maxLiveSessions))
    );
  }
  if (typeof input.claudeMaxOldSpaceMB === 'number' && Number.isFinite(input.claudeMaxOldSpaceMB)) {
    // 0 disables injection (auto-size). Otherwise clamp to a sane heap window —
    // below 512MB starves a real agent; above 32GB is past any reasonable box.
    const v = Math.round(input.claudeMaxOldSpaceMB);
    normalized.claudeMaxOldSpaceMB = v <= 0 ? 0 : Math.max(512, Math.min(32768, v));
  }
  if (typeof input.cloneRoot === 'string') {
    // Trim; empty string clears the override (back to the ~/zcc-workspace
    // default). Expand a leading `~` to $HOME so a tilde path is accepted and
    // stored absolute. Only an absolute path is kept — a relative one would
    // clone somewhere unpredictable relative to the app's cwd.
    const trimmed = input.cloneRoot.trim();
    const expanded =
      trimmed === '~' || trimmed.startsWith('~/')
        ? join(app.getPath('home'), trimmed.slice(1))
        : trimmed;
    if (expanded === '' || isAbsolute(expanded)) normalized.cloneRoot = expanded;
  }
  if (typeof input.pdfExportDir === 'string') {
    // Same rules as cloneRoot: trim, expand a leading `~`, keep only absolute
    // (or empty, which clears the override back to the OS Downloads folder).
    const trimmed = input.pdfExportDir.trim();
    const expanded =
      trimmed === '~' || trimmed.startsWith('~/')
        ? join(app.getPath('home'), trimmed.slice(1))
        : trimmed;
    if (expanded === '' || isAbsolute(expanded)) normalized.pdfExportDir = expanded;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'windowBounds')) {
    normalized.windowBounds = normalizeBounds(input.windowBounds);
  }
  if (typeof input.windowMaximized === 'boolean') {
    normalized.windowMaximized = input.windowMaximized;
  }

  // Autonomous team run backstops: support 0-means-disabled for both timeout and
  // maxRounds (supervisor already treats <=0 as "no backstop"), and clamp positives
  // to prevent instant-fire typos or absurdly long caps.
  if (typeof input.autonomousTimeoutMs === 'number' && Number.isFinite(input.autonomousTimeoutMs)) {
    // 0 = disabled (no timeout). Otherwise clamp to a sane floor (>=60_000 = 1 min)
    // so a typo can't make the watchdog fire instantly; cap at 24h (86_400_000).
    const v = Math.round(input.autonomousTimeoutMs);
    normalized.autonomousTimeoutMs = v <= 0 ? 0 : Math.max(60_000, Math.min(86_400_000, v));
  }
  if (typeof input.autonomousMaxRounds === 'number' && Number.isFinite(input.autonomousMaxRounds)) {
    const v = Math.round(input.autonomousMaxRounds);
    normalized.autonomousMaxRounds = v <= 0 ? 0 : Math.max(1, Math.min(1000, v));
  }
  if (typeof input.autonomousNudgeDelaySeconds === 'number' && Number.isFinite(input.autonomousNudgeDelaySeconds)) {
    normalized.autonomousNudgeDelaySeconds = Math.max(10, Math.min(600, Math.round(input.autonomousNudgeDelaySeconds)));
  }

  return normalized;
}

export const store = {
  listProjects(): Project[] {
    return readProjectsFile().projects;
  },
  /**
   * One-time backfill: assign a palette color to every project that lacks one,
   * spreading colors across the palette. Idempotent — a no-op (and no write)
   * once all projects are colored, so it's cheap to call unconditionally at
   * startup. Returns the up-to-date project list either way.
   */
  backfillProjectColors(): Project[] {
    const projects = this.listProjects();
    const inUseColors = projects.map((p) => p.color).filter((c): c is string => !!c);
    let mutated = false;
    for (let i = 0; i < projects.length; i++) {
      const after = backfillProjectColor(projects[i], inUseColors);
      if (after !== projects[i]) {
        projects[i] = after;
        mutated = true;
      }
    }
    if (mutated) writeProjects(projects);
    return projects;
  },
  /**
   * Create a Project that points at a remote SSH host instead of a local
   * folder. We still write a placeholder local path so existing
   * path-touching call sites keep working — `~/.zcc/remote-projects/<id>`,
   * created empty. Terminal spawns branch on `project.remote` and skip the
   * local cwd entirely.
   */
  addRemoteProject(input: {
    host: string;
    user?: string;
    remotePath?: string;
    proxyJump?: string;
    name?: string;
  }): Project {
    const host = sanitizeRemoteField(input.host, 'host', { required: true })!;
    const user = sanitizeRemoteField(input.user, 'user');
    const remotePath = sanitizeRemoteField(input.remotePath, 'remotePath');
    const proxyJump = sanitizeRemoteField(input.proxyJump, 'proxyJump');
    const rawName = (input.name ?? '').trim() || host;
    if (rawName.length > 256) throw new Error('name too long (max 256)');
    // Reject ASCII control chars (0x00-0x1f) and DEL (0x7f) so the name
    // can't smuggle newlines or escapes into the projects.json round-trip
    // or the rendered UI.
    for (let i = 0; i < rawName.length; i++) {
      const code = rawName.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) throw new Error('name contains control characters');
    }
    // Reject argv-flag-shaped host/user/proxyJump — would otherwise be treated
    // as ssh options when we splice them into `${user}@${host}` / `-J <jump>`.
    if (host.startsWith('-')) throw new Error(`host cannot start with '-'`);
    if (user && user.startsWith('-')) throw new Error(`user cannot start with '-'`);
    if (proxyJump && proxyJump.startsWith('-')) throw new Error(`proxyJump cannot start with '-'`);
    const projects = this.listProjects();
    const taken = new Set(projects.map((p) => p.tag).filter((t): t is string => !!t));
    const tag = pickTag(rawName, taken);
    const id = randomUUID();
    const placeholder = join(dataDir, 'remote-projects', id);
    const remote: ProjectRemote = { host };
    if (user) remote.user = user;
    if (remotePath) remote.remotePath = remotePath;
    if (proxyJump) remote.proxyJump = proxyJump;
    const color = pickProjectColor(projects.map((p) => p.color));
    const project: Project = {
      id,
      name: rawName,
      path: placeholder,
      color,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      tag,
      remote
    };
    // Persist first; only mkdir the placeholder once the JSON write succeeds,
    // so a failed write doesn't orphan a directory on disk.
    projects.push(project);
    writeProjects(projects);
    if (!existsSync(placeholder)) mkdirSync(placeholder, { recursive: true });
    return project;
  },
  addProject(path: string): Project {
    const stat = statSync(path);
    if (!stat.isDirectory()) throw new Error('not a directory');
    const projects = this.listProjects();
    // A directly-created extension source (one that skipped the Creator's
    // ensureExtensionProject seam) should still group under "Extensions" rather
    // than show as a plain "Local" project. Detect it from the manifest on disk.
    const ext = detectExtensionSource(path);
    // A Quick Agent scratch subfolder is named from the raw prompt text at mint
    // time (before anything lives in it — see createScratchSubfolder), so it
    // reads like `install-this-project-in-20260724200250`. By the time
    // addProject registers it, the agent has usually cloned/init'd the real
    // repo inside, so prefer that repo's name over the synthetic one.
    const scratchDerivedName =
      !ext && isGeneratedScratchFolder(path) ? deriveNameFromGitOrigin(path) : null;
    const existing = projects.find((p) => p.path === path);
    if (existing) {
      existing.lastActiveAt = Date.now();
      // Heal a plain row that turns out to be an extension source (e.g. added
      // as a plain project before its manifest existed, or added by hand).
      if (ext && existing.category !== EXTENSION_PROJECT_CATEGORY) {
        existing.category = EXTENSION_PROJECT_CATEGORY;
        existing.name = `Ext: ${ext.title}`.slice(0, 256);
      } else if (
        scratchDerivedName &&
        !existing.category &&
        existing.name === basename(path)
      ) {
        // Only backfill if the name is still exactly the synthetic folder name
        // (i.e. nobody has renamed it since) — a first addProject call can run
        // before the clone lands, then register_project fires again after.
        existing.name = scratchDerivedName;
      }
      writeProjects(projects);
      return existing;
    }
    const displayName = ext
      ? `Ext: ${ext.title}`.slice(0, 256)
      : scratchDerivedName || basename(path) || path;
    const taken = new Set(projects.map((p) => p.tag).filter((t): t is string => !!t));
    // Tag off the same basis as `name` for the scratch-repo case (so the tag
    // reads like the real repo, not the synthetic folder); extension projects
    // keep tagging off the dir basename (== manifest.id) as before.
    const tag = pickTag(ext ? basename(path) || path : displayName, taken);
    const color = pickProjectColor(projects.map((p) => p.color));
    const project: Project = {
      id: randomUUID(),
      name: displayName,
      path,
      color,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      tag,
      ...(ext ? { category: EXTENSION_PROJECT_CATEGORY } : {})
    };
    projects.push(project);
    writeProjects(projects);
    return project;
  },
  /**
   * One-time rebrand migration: rename `~/cc-workspace` → `~/zcc-workspace` and
   * re-point any project row still anchored at the old path. No-op unless the
   * legacy folder exists and the new one does not — so it runs at most once and
   * never overwrites a `zcc-workspace` the user already has.
   */
  migrateLegacyScratchDir(newAnchor: string): void {
    const legacy = join(app.getPath('home'), LEGACY_SCRATCH_DIR_NAME);
    if (newAnchor === legacy) return; // defensive: names diverged
    if (!existsSync(legacy) || existsSync(newAnchor)) return;
    try {
      renameSync(legacy, newAnchor);
    } catch {
      // Cross-device or permission failure — leave the legacy dir in place and
      // let ensureQuickAgentProject mkdir a fresh new anchor. Old work stays at
      // ~/cc-workspace (the user can re-add it), but we never lose data.
      return;
    }
    // Re-point any registered project that pointed at the moved folder so its
    // id/tag/settings survive the rename rather than orphaning.
    const projects = this.listProjects();
    let changed = false;
    for (const p of projects) {
      if (p.path === legacy) {
        p.path = newAnchor;
        changed = true;
      }
    }
    if (changed) writeProjects(projects);
  },
  /**
   * Migrate (once) then ensure the scratch workspace dir exists, returning its
   * absolute path. The single funnel every scratch consumer must go through —
   * the Quick Agent anchor AND the git clone-root fallback — so whichever fires
   * first still gives the legacy-dir migration its chance to run before the new
   * folder is materialized. Bypassing this (mkdir'ing the scratch root directly)
   * would permanently disable the migration and strand pre-rebrand work.
   */
  ensureScratchRoot(): string {
    const anchor = scratchWorkspaceRoot();
    this.migrateLegacyScratchDir(anchor);
    mkdirSync(anchor, { recursive: true });
    // Pre-trust the workspace root itself (not just the per-session subfolders
    // minted by createScratchSubfolder) so a bare Claude Code launch at
    // ~/zcc-workspace doesn't trip the "Do you trust this folder?" prompt.
    // Safe + idempotent: this is an app-owned dir we just created, and the
    // merge skips when it's already trusted.
    trustDirInClaudeConfig(anchor);
    return anchor;
  },
  /**
   * The single built-in scratch project that backs the Agents-module Quick
   * Agent. Rooted at `~/zcc-workspace` (created on first call), reused on every
   * subsequent call via `addProject`'s path-dedup. Tagged `quickAgent` so the
   * UI can treat it specially. Idempotent.
   *
   * Migration: pre-rebrand installs anchored the scratch project at
   * `~/cc-workspace`. On first call we rename that folder to the new name (and
   * re-point any registered project still pointing at the old path) so existing
   * scratch work and its sessions carry over transparently. The rename is
   * skipped if the new folder already exists — we never clobber.
   */
  ensureQuickAgentProject(): Project {
    const anchor = this.ensureScratchRoot();
    const project = this.addProject(anchor);
    if (!project.quickAgent) {
      const projects = this.listProjects();
      const idx = projects.findIndex((p) => p.id === project.id);
      if (idx !== -1) {
        projects[idx] = { ...projects[idx], quickAgent: true };
        writeProjects(projects);
        return projects[idx];
      }
    }
    return project;
  },
  /**
   * Ensure a dedicated project rooted at a local extension's SOURCE working dir,
   * grouped under the "Extensions" category so the Creator agent has a stable,
   * easy-to-find home instead of sharing the flat Quick Agent scratch. Idempotent
   * by path (reuses the existing row, backfilling the category/name if a prior
   * addProject created it plain). The working dir must already exist (the
   * scaffold step mkdir's it); the caller confines it to the scratch workspace —
   * this is a dumb registration seam, not a path authority.
   *
   * `name` seeds the display label (e.g. the extension title); we prefix it so
   * the rail reads "Ext: My Tool" and doesn't collide visually with real repos.
   */
  ensureExtensionProject(workingDir: string, name: string): Project {
    const project = this.addProject(workingDir);
    const label = `Ext: ${name}`.slice(0, 256);
    if (project.category === EXTENSION_PROJECT_CATEGORY && project.name === label) {
      return project;
    }
    const projects = this.listProjects();
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx !== -1) {
      projects[idx] = {
        ...projects[idx],
        category: EXTENSION_PROJECT_CATEGORY,
        name: label
      };
      writeProjects(projects);
      return projects[idx];
    }
    return project;
  },
  /**
   * Mint a fresh, empty subfolder under the scratch workspace for an isolated
   * Quick Agent session, returning its absolute path. Lets parallel scratch
   * agents each work in their own dir instead of trampling one flat root. The
   * caller passes this back as the terminal `cwd`; it is inherently confined
   * (we build it from {@link scratchWorkspaceRoot}) and re-validated `isWithin`
   * the anchor on terminal creation. `label` seeds a human-readable prefix.
   */
  createScratchSubfolder(label?: string): string {
    const root = this.ensureScratchRoot();
    // Reuse the tag slugifier (lowercase, ascii, dash-separated) but keep the
    // folder prefix short; slugifyTag returns 'project' for empty/garbage input
    // which we'd rather render as 'session'.
    const raw = (label ?? '').trim();
    const slug = raw ? slugifyTag(raw).slice(0, 24).replace(/-+$/, '') : '';
    // A short timestamp keeps folders sortable + collision-resistant; the
    // counter loop is belt-and-suspenders for same-second launches.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const base = slug && slug !== 'project' ? `${slug}-${stamp}` : `session-${stamp}`;
    let dir = join(root, base);
    for (let n = 2; existsSync(dir); n++) dir = join(root, `${base}-${n}`);
    mkdirSync(dir, { recursive: true });
    // Pre-trust the minted dir so Claude Code doesn't show its "trust this
    // folder" prompt on every scratch launch. Safe: this is an empty,
    // app-managed folder we just created under the scratch root.
    trustDirInClaudeConfig(dir);
    return dir;
  },
  removeProject(id: string) {
    const projects = this.listProjects();
    const removed = projects.find((p) => p.id === id);
    writeProjects(projects.filter((p) => p.id !== id));
    // Drop any orphaned per-project settings so project-settings.json
    // doesn't grow unbounded as projects come and go.
    const all = readJsonRaw<Record<string, ProjectSettings>>(projectSettingsFile, {});
    if (id in all) {
      delete all[id];
      writeJson(projectSettingsFile, all);
    }
    // Clean up the remote-project placeholder dir we mkdir'd in addRemoteProject.
    // We only nuke paths under our own data dir — never anything user-supplied.
    if (removed?.remote) {
      const placeholderRoot = join(dataDir, 'remote-projects');
      const expected = join(placeholderRoot, id);
      if (removed.path === expected && existsSync(expected)) {
        try {
          rmSync(expected, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'color' | 'defaultAgents' | 'defaultPersonas' | 'launchDefault' | 'favorite'>> & {
      remotePath?: string;
    }
  ): Project | null {
    const projects = this.listProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    // `remotePath` isn't a top-level Project field — it lives on `remote`, so
    // pull it out before the generic merge and apply it separately below.
    const { remotePath: remotePathPatch, ...rest } = patch;
    // The renderer is untrusted (rule 1) and `color` is persisted and later
    // interpolated into inline styles / a CSS custom property, so main only
    // accepts a known palette member or an explicit reset (undefined). Any other
    // value — a hand-crafted hex, a control-char string — is dropped from the
    // patch so it can never reach projects.json or the DOM.
    const safePatch = { ...rest };
    if ('color' in safePatch && safePatch.color !== undefined) {
      if (!(PROJECT_COLORS as readonly string[]).includes(safePatch.color)) {
        delete safePatch.color;
      }
    }
    // `favorite` is a UI flag; coerce the untrusted value to a strict boolean
    // so only a real true/false ever reaches projects.json.
    if ('favorite' in safePatch) {
      safePatch.favorite = safePatch.favorite === true;
    }
    if ('launchDefault' in safePatch) {
      const launchDefault = normalizeProjectLaunchDefault(safePatch.launchDefault);
      if (launchDefault) safePatch.launchDefault = launchDefault;
      else delete safePatch.launchDefault;
    }
    const next = { ...projects[idx], ...safePatch };
    // Remote start-path override. Only meaningful for a remote project; ignored
    // for local ones. sanitizeRemoteField enforces the same length / control-char
    // guard as add-time (it feeds an ssh `cd` prefix in buildRemoteCmd). An empty
    // string clears the override so the project falls back to the global
    // remoteDefaultPath, then the remote $HOME.
    if (remotePathPatch !== undefined && next.remote) {
      const cleaned = sanitizeRemoteField(remotePathPatch, 'remotePath');
      const remote = { ...next.remote };
      if (cleaned) remote.remotePath = cleaned;
      else delete remote.remotePath;
      next.remote = remote;
    }
    projects[idx] = next;
    writeProjects(projects);
    return projects[idx];
  },
  reorderProjects(orderedIds: string[]): Project[] {
    const projects = this.listProjects();
    const byId = new Map(projects.map((p) => [p.id, p]));
    const next: Project[] = [];
    let i = 0;
    for (const id of orderedIds) {
      const p = byId.get(id);
      if (!p) continue;
      next.push({ ...p, sortIndex: i++ });
      byId.delete(id);
    }
    // Append any projects not included (defensive — shouldn't happen).
    for (const leftover of byId.values()) {
      next.push({ ...leftover, sortIndex: i++ });
    }
    writeProjects(next);
    return next;
  },
  touchProject(id: string): Project | null {
    const projects = this.listProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;

    // Backfill `tag` and `color` for any project missing them (legacy data, or
    // an entry written before the tag-/color-aware addProject path landed). We
    // walk all projects in one pass so duplicate fallback tags get distinct
    // `-2`, `-3`, … suffixes and so backfilled colors stay spread across the
    // palette deterministically.
    const taken = new Set(projects.map((p) => p.tag).filter((t): t is string => !!t));
    const inUseColors = projects.map((p) => p.color).filter((c): c is string => !!c);
    for (let i = 0; i < projects.length; i++) {
      const before = projects[i];
      let after = backfillProjectTag(before, taken);
      after = backfillProjectColor(after, inUseColors);
      if (after !== before) projects[i] = after;
    }

    projects[idx] = { ...projects[idx], lastActiveAt: Date.now() };
    writeProjects(projects);
    // The write above already persisted any tag/color backfills.
    return projects[idx];
  },
  getConfig(): AppConfig {
    const fallback: AppConfig = {
      version: 1,
      theme: 'dark',
      terminalTheme: DEFAULT_TERMINAL_THEME,
      shell: process.env.SHELL || '/bin/zsh',
      claudeBinary: 'claude',
      fontSize: 13,
      lastProjectId: null,
      workspaceModes: {},
      agentsBoardView: 'board',
      inboxGrouping: 'project',
      // Auto mode is ON by default (a claude session launches with the native
      // classifier-backed --permission-mode auto). Absent-in-file ⇒ true; the
      // user opts OUT by persisting false. See AppConfig.autoModeEnabled.
      autoModeEnabled: true,
      // tmux session persistence defaults to 'all' (both local and remote).
      // Absent-in-file ⇒ 'all'; the user narrows it to 'remote'-only or 'off'
      // by persisting one of those. Still degrades gracefully to a plain
      // node-pty spawn when tmux isn't installed (always on Windows). See
      // AppConfig.tmuxScope.
      tmuxScope: 'all',
      // Menu-bar popover is ON by default (macOS). Absent-in-file ⇒ true; the
      // user opts OUT by persisting false. The tray is still built regardless;
      // `menubarPopoverEnabled()` in index.ts also gates on darwin, so this
      // default is a no-op on win/linux. See AppConfig.menubarPopoverEnabled.
      menubarPopoverEnabled: true,
      // Local-extension hot-reload watcher is ON by default. Absent-in-file ⇒
      // true; the user opts OUT by persisting false. See
      // AppConfig.localExtensionHotReloadEnabled.
      localExtensionHotReloadEnabled: true,
      // Trust all ZCC tools is ON by default. Absent-in-file ⇒ true; the user
      // opts OUT by persisting false. This flips the default for every install
      // (fresh or updated) with no migration step — an existing explicit
      // `false` (a deliberate opt-out) still reads back false. See
      // AppConfig.trustZccToolsEnabled.
      trustZccToolsEnabled: true,
      // Default start path for remote (SSH) projects with no per-project
      // remotePath of their own. A per-project remotePath still overrides this;
      // blanking the Settings field re-applies this fallback. See
      // AppConfig.remoteDefaultPath.
      // A blank default lets each remote start from its own $HOME.
      remoteDefaultPath: ''
    };
    const stored = normalizeConfig(readJsonRaw<Partial<AppConfig>>(configFile, {}));
    return projectConfigCompatibility({ ...fallback, ...stored, version: 1 });
  },
  setConfig(patch: Partial<AppConfig>): AppConfig {
    const normalizedPatch = normalizeConfig(patch);
    const next = { ...this.getConfig(), ...normalizedPatch, version: 1 as const };
    // `undefined` is an intentional reset for optional canonical fields. The
    // normalizer omits it for safety, so apply this deletion after validation.
    const optionalHarnessKeys = [
      'defaultHarness',
      'harnessRouting',
      'claudeAppendSystemPrompt',
      'claudeExtraArgs',
      'claudeAddDirs',
      'claudeAllowedTools',
      'claudeDeniedTools',
      'defaultCodexSandbox',
      'defaultCodexApproval',
      'defaultExecutionState',
      'piProvider',
      'piModel',
      'piThinking'
    ] as const;
    for (const key of optionalHarnessKeys) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] === undefined) {
        delete next[key];
      }
    }
    // A disabled harness cannot remain the global default. Reset atomically to
    // the absent/Claude compatibility default rather than persisting invalid
    // state that launch UI would have to repair later.
    if (next.defaultHarness && !harnessEnabled(next, next.defaultHarness)) {
      delete next.defaultHarness;
    }
    writeJson(configFile, canonicalConfigForWrite(next));
    return next;
  },
  getProjectSettings(id: string): ProjectSettings {
    const all = readJsonRaw<Record<string, ProjectSettings>>(projectSettingsFile, {});
    return projectSettingsCompatibility(all[id] ?? {});
  },
  setProjectSettings(id: string, patch: Partial<ProjectSettings>): ProjectSettings {
    const all = readJsonRaw<Record<string, ProjectSettings>>(projectSettingsFile, {});
    const current = projectSettingsCompatibility(all[id] ?? {});
    const next = normalizeProjectSettings({ ...current, ...patch });
    all[id] = canonicalProjectSettingsForWrite(next);
    writeJson(projectSettingsFile, all);
    return next;
  }
};
