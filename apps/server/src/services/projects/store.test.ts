/**
 * Store tests for the scratch-workspace surface added in the Zana rebrand:
 *   - scratchWorkspaceRoot points at ~/zcc-workspace,
 *   - createScratchSubfolder mints fresh, isolated, collision-free dirs,
 *   - ensureQuickAgentProject migrates a legacy ~/cc-workspace once (and
 *     re-points any project row that pointed at it), but never clobbers an
 *     existing ~/zcc-workspace.
 *
 * `electron`'s `app.getPath('home')` is read at module-load time (for dataDir)
 * AND at call time (for the scratch root), so we mock it to a per-run tmp HOME
 * via vi.hoisted before importing the store.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ home: '' }));
h.home = mkdtempSync(join(tmpdir(), 'zcc-store-test-'));

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'home' ? h.home : h.home) }
}));

const { store, scratchWorkspaceRoot, SCRATCH_DIR_NAME, normalizeConfig } = await import('./store.js');
const { PROJECT_COLORS } = await import('@zana-ai/zcc-domain/project-colors');

const dataDir = join(h.home, '.zcc');
const projectsFile = join(dataDir, 'projects.json');
const configFile = join(dataDir, 'config.json');
const projectSettingsFile = join(dataDir, 'project-settings.json');

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));

function resetHome() {
  rmSync(h.home, { recursive: true, force: true });
  mkdirSync(h.home, { recursive: true });
}

beforeEach(() => resetHome());
afterAll(() => rmSync(h.home, { recursive: true, force: true }));

describe('scratchWorkspaceRoot', () => {
  it('points at ~/zcc-workspace', () => {
    expect(scratchWorkspaceRoot()).toBe(join(h.home, 'zcc-workspace'));
    expect(SCRATCH_DIR_NAME).toBe('zcc-workspace');
  });
});

describe('config — boolean feature flags round-trip through setConfig', () => {
  // Regression guard: normalizeConfig is a strict allow-list, so every boolean
  // flag must be enumerated there or setConfig silently drops it on save. This
  // bit idleTriageEnabled / agentSelfCloseEnabled — assert each survives a
  // write→read cycle so a new flag can't ship dead again. remoteMcpEnabled /
  // enableUpdateSimulation / microVmEnabled / followupsFromIdle previously
  // shipped without a normalizeConfig branch and are covered here for that
  // reason (see store-config-normalize.test.ts for the non-boolean-input cases).
  it.each([
    'idleTriageEnabled',
    'agentListNeedsYouFromTriage',
    'includeScheduledAgentsInAgentView',
    'agentSelfCloseEnabled',
    'closeIdlePeersEnabled',
    'teamLaunchEnabled',
    'goalsEnabled',
    'followUpsEnabled',
    'heartbeatEnabled',
    'autoRenameTabs',
    'inboxGuidanceEnabled',
    'voiceInputEnabled',
    'menubarPopoverEnabled',
    'trustZccToolsEnabled',
    'remoteMcpEnabled',
    'steerActiveThreadOnEnter',
    'showUnhandledProviderEvents',
    'providerBridgeRecordingEnabled',
    'enableUpdateSimulation',
    'microVmEnabled',
    'followupsFromIdle'
  ] as const)('persists %s', (flag) => {
    store.setConfig({ [flag]: true });
    expect(store.getConfig()[flag]).toBe(true);
    store.setConfig({ [flag]: false });
    expect(store.getConfig()[flag]).toBe(false);
  });

  // Menu-bar popover is ON by default (like autoModeEnabled):
  // absent-in-file reads back true; the user opts OUT by persisting false.
  it('defaults menubarPopoverEnabled to true when absent, opt-out with false', () => {
    expect(store.getConfig().menubarPopoverEnabled).toBe(true);
    store.setConfig({ menubarPopoverEnabled: false });
    expect(store.getConfig().menubarPopoverEnabled).toBe(false);
  });

  // Trust all ZCC tools is ON by default for every install (fresh or updated) —
  // absent-in-file reads back true with no migration step; an explicit false
  // (a deliberate opt-out) still reads back false.
  it('defaults trustZccToolsEnabled to true when absent, opt-out with false', () => {
    expect(store.getConfig().trustZccToolsEnabled).toBe(true);
    store.setConfig({ trustZccToolsEnabled: false });
    expect(store.getConfig().trustZccToolsEnabled).toBe(false);
  });

  // tmuxScope (tri-state, mirrors overseerMode) defaults to 'all' — absent-in-
  // file reads back 'all'; the user narrows it by persisting 'remote' or 'off'.
  it('defaults tmuxScope to "all" when absent, narrows with "remote"/"off"', () => {
    expect(store.getConfig().tmuxScope).toBe('all');
    store.setConfig({ tmuxScope: 'remote' });
    expect(store.getConfig().tmuxScope).toBe('remote');
    store.setConfig({ tmuxScope: 'off' });
    expect(store.getConfig().tmuxScope).toBe('off');
  });
});

describe('harness compatibility projection persistence', () => {
  it('round-trips supported global harness-routing fields', () => {
    const harnessRouting = {
      schemaVersion: 1 as const,
      byAdapter: {
        codex: {
          providerTargetId: 'openai',
          modelTargetId: 'gpt-4o',
          modelLevel: 'high' as const,
          executionState: 'plan' as const,
        }
      }
    };

    expect(normalizeConfig({ harnessRouting })).toMatchObject({ harnessRouting });
    store.setConfig({ harnessRouting });
    expect(store.getConfig().harnessRouting).toEqual(harnessRouting);
  });

  it('drops globally unsupported role, execution target, and compatibility fields', () => {
    expect(normalizeConfig({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          codex: {
            roleTargetId: 'reviewer',
            executionTargetId: 'codex.execution.plan',
            compatibility: { codexSandbox: 'read-only', codexApproval: 'on-request' }
          }
        }
      }
    })).not.toHaveProperty('harnessRouting');
  });

  it('rejects empty supported global provider and model targets', () => {
    expect(normalizeConfig({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { codex: { providerTargetId: ' ', modelTargetId: '' } }
      }
    })).not.toHaveProperty('harnessRouting');
  });

  it('does not serialize retired config keys during an unrelated save', () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      theme: 'dark',
      harnesses: { byId: { claude: { binary: '/opt/claude', compatibility: {
        model: 'opus', permissionMode: 'plan', autoMode: { enabled: false }
      } } } }
    }));

    expect(store.getConfig()).toMatchObject({
      claudeBinary: '/opt/claude', defaultModel: 'opus', defaultPermissionMode: 'plan', autoModeEnabled: false
    });
    store.setConfig({ fontSize: 15 });

    const disk = readJson(configFile);
    expect(disk.harnesses.byId.claude).toMatchObject({
      binary: '/opt/claude', compatibility: { model: 'opus', permissionMode: 'plan', autoMode: { enabled: false } }
    });
    for (const key of ['claudeBinary', 'defaultModel', 'defaultPermissionMode', 'autoModeEnabled']) {
      expect(disk).not.toHaveProperty(key);
    }
  });

  it('writes intentional legacy-shaped config updates into canonical containers', () => {
    store.setConfig({ claudeBinary: '/opt/claude', defaultModel: 'opus', autoModeEnabled: false });
    store.setConfig({ defaultModel: 'haiku' });

    const disk = readJson(configFile);
    expect(disk.harnesses.byId.claude).toMatchObject({
      binary: '/opt/claude', compatibility: {
        model: 'haiku',
        executionPolicy: { target: 'native-default-with-auto', autoMode: { enabled: false } }
      }
    });
    expect(disk).not.toHaveProperty('claudeBinary');
    expect(disk).not.toHaveProperty('defaultModel');
    expect(disk).not.toHaveProperty('autoModeEnabled');
    expect(store.getConfig()).toMatchObject({ claudeBinary: '/opt/claude', defaultModel: 'haiku', autoModeEnabled: false });
  });

  it('persists Claude native default and Auto Mode as one compatibility policy', () => {
    store.setConfig({ defaultPermissionMode: 'default', autoModeEnabled: true, autoModeAllow: ['git status'] });

    const compatibility = readJson(configFile).harnesses.byId.claude.compatibility;
    expect(compatibility.executionPolicy).toEqual({
      target: 'native-default-with-auto',
      autoMode: { enabled: true, allow: ['git status'] }
    });
    expect(compatibility).not.toHaveProperty('permissionMode');
    expect(compatibility).not.toHaveProperty('autoMode');
    expect(store.getConfig()).toMatchObject({
      defaultPermissionMode: 'default', autoModeEnabled: true, autoModeAllow: ['git status']
    });
  });

  it('does not serialize retired project settings during an unrelated save', () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(projectSettingsFile, JSON.stringify({ p1: {
      worktreeIsolation: true,
      harnesses: { byId: {
        claude: { compatibility: { model: 'sonnet', permissionMode: 'acceptEdits' } },
        codex: { compatibility: { codexSandbox: 'read-only' } }
      } }
    } }));

    expect(store.getProjectSettings('p1')).toMatchObject({
      model: 'sonnet', permissionMode: 'acceptEdits', codexSandbox: 'read-only'
    });
    store.setProjectSettings('p1', { worktreeIsolation: false });

    const disk = readJson(projectSettingsFile).p1;
    expect(disk.harnesses.byId.claude.compatibility).toMatchObject({ model: 'sonnet', permissionMode: 'acceptEdits' });
    expect(disk.harnesses.byId.codex.compatibility).toMatchObject({ codexSandbox: 'read-only' });
    expect(disk).not.toHaveProperty('model');
    expect(disk).not.toHaveProperty('permissionMode');
    expect(disk).not.toHaveProperty('codexSandbox');
  });

  it('writes intentional legacy-shaped project updates into canonical containers', () => {
    store.setProjectSettings('p1', { model: 'sonnet', permissionMode: 'plan', piModel: 'provider/model' });
    store.setProjectSettings('p1', { model: 'opus' });

    const disk = readJson(projectSettingsFile).p1;
    expect(disk.harnesses.byId.claude.compatibility).toMatchObject({ model: 'opus', permissionMode: 'plan' });
    expect(disk.harnesses.byId.codex.compatibility).toMatchObject({ model: 'opus' });
    expect(disk.harnesses.byId.pi.compatibility).toMatchObject({ model: 'provider/model' });
    expect(disk).not.toHaveProperty('model');
    expect(disk).not.toHaveProperty('permissionMode');
    expect(disk).not.toHaveProperty('piModel');
  });

  it('does not emit empty harness containers for unrelated project settings', () => {
    store.setProjectSettings('p1', { worktreeIsolation: true });
    expect(readJson(projectSettingsFile).p1).toEqual({ worktreeIsolation: true });
  });
});

describe('config — idle-triage dwell + sensitivity normalization', () => {
  // idleTriageDelaySeconds mirrors the heartbeatDelaySeconds idiom: a finite
  // number, rounded and clamped to [10, 600]. The renderer is untrusted, so a
  // hand-edited / out-of-range value must be clamped here in main (rule 1).
  it('round-trips a valid idleTriageDelaySeconds and rounds it', () => {
    store.setConfig({ idleTriageDelaySeconds: 30 });
    expect(store.getConfig().idleTriageDelaySeconds).toBe(30);
    store.setConfig({ idleTriageDelaySeconds: 45.6 });
    expect(store.getConfig().idleTriageDelaySeconds).toBe(46);
  });

  it('clamps idleTriageDelaySeconds to [10, 600]', () => {
    store.setConfig({ idleTriageDelaySeconds: 2 });
    expect(store.getConfig().idleTriageDelaySeconds).toBe(10);
    store.setConfig({ idleTriageDelaySeconds: 9999 });
    expect(store.getConfig().idleTriageDelaySeconds).toBe(600);
  });

  it('drops a non-finite / non-number idleTriageDelaySeconds (default applies downstream)', () => {
    store.setConfig({ idleTriageDelaySeconds: 25 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.setConfig({ idleTriageDelaySeconds: 'soon' as any });
    expect(store.getConfig().idleTriageDelaySeconds).toBe(25); // unchanged — bogus value ignored
    store.setConfig({ idleTriageDelaySeconds: Number.NaN });
    expect(store.getConfig().idleTriageDelaySeconds).toBe(25);
  });

  // idleAttentionSensitivity: only the whitelisted named levels persist;
  // anything else is dropped so the 'medium' default applies at read time.
  it.each(['high', 'medium', 'low'] as const)('persists the %s sensitivity level', (level) => {
    store.setConfig({ idleAttentionSensitivity: level });
    expect(store.getConfig().idleAttentionSensitivity).toBe(level);
  });

  it('drops an invalid idleAttentionSensitivity value', () => {
    store.setConfig({ idleAttentionSensitivity: 'low' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.setConfig({ idleAttentionSensitivity: 'paranoid' as any });
    expect(store.getConfig().idleAttentionSensitivity).toBe('low'); // unchanged — bogus value ignored
  });
});

describe('config — voiceModel / voiceLanguage normalization', () => {
  it('persists and trims voiceModel', () => {
    store.setConfig({ voiceModel: '  gpt-4o-transcribe  ' });
    expect(store.getConfig().voiceModel).toBe('gpt-4o-transcribe');
  });

  it('persists and trims voiceLanguage', () => {
    store.setConfig({ voiceLanguage: ' fr ' });
    expect(store.getConfig().voiceLanguage).toBe('fr');
  });

  it('drops a non-string voiceModel (unchanged)', () => {
    store.setConfig({ voiceModel: 'whisper-1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.setConfig({ voiceModel: 123 as any });
    expect(store.getConfig().voiceModel).toBe('whisper-1');
  });

  it('drops a non-string voiceLanguage (unchanged)', () => {
    store.setConfig({ voiceLanguage: 'en' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.setConfig({ voiceLanguage: true as any });
    expect(store.getConfig().voiceLanguage).toBe('en');
  });
});

describe('config — workspaceModes normalization (shape-only: non-empty string)', () => {
  // A project view is either a core WorkspaceMode OR an opaque extension module
  // id (an extension-contributed project tab, e.g. the `zana-tickets`
  // extension). Core can't value-whitelist extension ids, so normalizeConfig
  // validates SHAPE only — any non-empty string round-trips; empty/non-string
  // values are stripped. This is what lets an extension-id project view (and
  // the goals/followups/feed core modes) persist across launches.
  it('keeps every non-empty string (core modes + extension ids), drops empty/non-string', () => {
    store.setConfig({
      workspaceModes: {
        p: 'terminals',
        q: 'agents',
        r: 'library',
        s: 'feed',
        ext: 'zana-tickets',
        empty: '',
        bad: 123
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    });
    expect(store.getConfig().workspaceModes).toEqual({
      p: 'terminals',
      q: 'agents',
      r: 'library',
      s: 'feed',
      ext: 'zana-tickets'
    });
  });
});

describe('createScratchSubfolder', () => {
  it('creates a fresh empty dir under the scratch root', () => {
    const dir = store.createScratchSubfolder('My Cool Prompt');
    expect(existsSync(dir)).toBe(true);
    expect(dir.startsWith(scratchWorkspaceRoot())).toBe(true);
    // slug derived from the label, lowercased + dash-joined.
    expect(dir).toMatch(/zcc-workspace\/my-cool-prompt-\d{8}\d{6}$/);
  });

  it('never collides — repeated calls with the same label yield distinct dirs', () => {
    const a = store.createScratchSubfolder('dup');
    const b = store.createScratchSubfolder('dup');
    const c = store.createScratchSubfolder('dup');
    expect(new Set([a, b, c]).size).toBe(3);
    for (const d of [a, b, c]) expect(existsSync(d)).toBe(true);
  });

  it('falls back to a session-* prefix for empty/garbage labels', () => {
    // Trailing `-N` may be appended by the collision loop on same-second calls.
    expect(store.createScratchSubfolder('')).toMatch(/\/session-\d{14}(-\d+)?$/);
    expect(store.createScratchSubfolder('!!!')).toMatch(/\/session-\d{14}(-\d+)?$/);
    expect(store.createScratchSubfolder(undefined)).toMatch(/\/session-\d{14}(-\d+)?$/);
  });
});

describe('addProject — scratch-folder name derives from git origin', () => {
  function initGitRepoWithOrigin(dir: string, originUrl: string) {
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', originUrl]);
  }

  it('renames a Quick Agent scratch subfolder to the cloned repo name', () => {
    const dir = store.createScratchSubfolder('install this project in ~/foo: https://github.com/acme/widget');
    initGitRepoWithOrigin(dir, 'https://github.com/acme/widget.git');
    const p = store.addProject(dir);
    expect(p.name).toBe('widget');
    expect(p.tag).toBe('widget');
  });

  it('backfills an already-registered scratch row once the clone lands', () => {
    const dir = store.createScratchSubfolder('fetch this project https: git@github.com:acme/gizmo.git');
    const first = store.addProject(dir); // no git repo yet — keeps the synthetic name
    expect(first.name).toBe(dir.split('/').pop());
    initGitRepoWithOrigin(dir, 'git@github.com:acme/gizmo.git');
    const second = store.addProject(dir); // re-registered after the clone
    expect(second.name).toBe('gizmo');
  });

  it('leaves a user-renamed scratch project alone even after a later clone', () => {
    const dir = store.createScratchSubfolder('create a new project fro nothing');
    const first = store.addProject(dir);
    store.updateProject(first.id, { name: 'My Custom Name' });
    initGitRepoWithOrigin(dir, 'https://github.com/acme/late-clone.git');
    const second = store.addProject(dir);
    expect(second.name).toBe('My Custom Name');
  });

  it('does not touch a plain (non-scratch) project even if it has a git origin', () => {
    const dir = join(h.home, 'plain-project');
    mkdirSync(dir, { recursive: true });
    initGitRepoWithOrigin(dir, 'https://github.com/acme/should-not-apply.git');
    const p = store.addProject(dir);
    expect(p.name).toBe('plain-project');
  });
});

describe('project color assignment', () => {
  it('assigns a palette color on addProject', () => {
    const dir = join(h.home, 'proj-a');
    mkdirSync(dir, { recursive: true });
    const p = store.addProject(dir);
    expect(p.color).toBe(PROJECT_COLORS[0]);
  });

  it('spreads distinct colors across freshly added projects', () => {
    const colors: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      const dir = join(h.home, `proj-${i}`);
      mkdirSync(dir, { recursive: true });
      colors.push(store.addProject(dir).color);
    }
    expect(colors).toEqual([PROJECT_COLORS[0], PROJECT_COLORS[1], PROJECT_COLORS[2]]);
  });

  it('backfillProjectColors colors legacy rows and is idempotent', () => {
    // Seed a projects.json with two uncolored rows (pre-color schema).
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      projectsFile,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'a', name: 'A', path: join(h.home, 'a'), createdAt: 1, lastActiveAt: 1 },
          { id: 'b', name: 'B', path: join(h.home, 'b'), createdAt: 1, lastActiveAt: 1 }
        ]
      })
    );

    const after = store.backfillProjectColors();
    expect(after.map((p) => p.color)).toEqual([PROJECT_COLORS[0], PROJECT_COLORS[1]]);

    // Idempotent: a second pass leaves colors untouched.
    const again = store.backfillProjectColors();
    expect(again.map((p) => p.color)).toEqual([PROJECT_COLORS[0], PROJECT_COLORS[1]]);
  });

  it('backfill preserves an existing (even non-palette) color', () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      projectsFile,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'a', name: 'A', path: join(h.home, 'a'), color: '#abcdef', createdAt: 1, lastActiveAt: 1 }
        ]
      })
    );
    const after = store.backfillProjectColors();
    expect(after[0].color).toBe('#abcdef');
  });

  // updateProject is the untrusted-renderer boundary (rule 1): unlike backfill,
  // which preserves whatever is already on disk, it must reject any color that
  // isn't a known palette member before it reaches projects.json / the DOM.
  it('updateProject accepts a palette color', () => {
    const dir = join(h.home, 'proj-u1');
    mkdirSync(dir, { recursive: true });
    const p = store.addProject(dir);
    const updated = store.updateProject(p.id, { color: PROJECT_COLORS[3] });
    expect(updated?.color).toBe(PROJECT_COLORS[3]);
  });

  it('updateProject clears the color on explicit reset (undefined)', () => {
    const dir = join(h.home, 'proj-u2');
    mkdirSync(dir, { recursive: true });
    const p = store.addProject(dir); // starts colored
    const updated = store.updateProject(p.id, { color: undefined });
    expect(updated?.color).toBeUndefined();
  });

  it('updateProject drops a non-palette color, leaving the prior value intact', () => {
    const dir = join(h.home, 'proj-u3');
    mkdirSync(dir, { recursive: true });
    const p = store.addProject(dir);
    const before = p.color;
    // A hand-crafted hex and a control-char string both come from the untrusted
    // renderer; neither is a palette member, so both are dropped from the patch.
    expect(store.updateProject(p.id, { color: '#abcdef' })?.color).toBe(before);
    expect(store.updateProject(p.id, { color: 'red; }\n.x{' })?.color).toBe(before);
    // The drop is scoped to color — sibling fields in the same patch still apply.
    const renamed = store.updateProject(p.id, { name: 'Renamed', color: 'evil' });
    expect(renamed?.name).toBe('Renamed');
    expect(renamed?.color).toBe(before);
  });

  it('updateProject toggles favorite and coerces it to a strict boolean', () => {
    const dir = join(h.home, 'proj-u4');
    mkdirSync(dir, { recursive: true });
    const p = store.addProject(dir);
    expect(p.favorite).toBeUndefined();
    expect(store.updateProject(p.id, { favorite: true })?.favorite).toBe(true);
    expect(store.updateProject(p.id, { favorite: false })?.favorite).toBe(false);
    // An untrusted truthy non-boolean must not land a truthy non-boolean on
    // disk — it's coerced to false (only an exact `true` flips it on).
    const sneaky = store.updateProject(p.id, {
      favorite: 'yes' as unknown as boolean
    });
    expect(sneaky?.favorite).toBe(false);
  });

  // remotePath can be set during creation via addRemoteProject, but updateProject
  // does not currently support modifying it after creation (the feature was
  // planned but not implemented in the 0.8.7 merge).
  it('updateProject does not accept remotePath parameter', () => {
    const p = store.addRemoteProject({ host: 'kit-kat', remotePath: '/initial/path' });
    expect(p.remote?.remotePath).toBe('/initial/path');

    // updateProject's type signature doesn't include remotePath
    const updated = store.updateProject(p.id, { name: 'Updated Name' });
    // The remotePath remains unchanged from creation
    expect(updated?.remote?.remotePath).toBe('/initial/path');
    expect(updated?.name).toBe('Updated Name');
  });
});

describe('config — autonomous backstop normalization', () => {
  // Regression guard: autonomous config must preserve 0-means-disabled for
  // timeoutMs and maxRounds, while clamping positive values to prevent typos.

  it('autonomousTimeoutMs: preserves 0 (timeout disabled)', () => {
    store.setConfig({ autonomousTimeoutMs: 0 });
    expect(store.getConfig().autonomousTimeoutMs).toBe(0);
  });

  it('autonomousTimeoutMs: clamps positive values to [60000, 86400000]', () => {
    store.setConfig({ autonomousTimeoutMs: 30_000 }); // below floor
    expect(store.getConfig().autonomousTimeoutMs).toBe(60_000); // clamped to 1 min

    store.setConfig({ autonomousTimeoutMs: 180_000 }); // 3 minutes, within range
    expect(store.getConfig().autonomousTimeoutMs).toBe(180_000);

    store.setConfig({ autonomousTimeoutMs: 100_000_000 }); // above ceiling
    expect(store.getConfig().autonomousTimeoutMs).toBe(86_400_000); // clamped to 24h
  });

  it('autonomousTimeoutMs: treats negative as 0 (disabled)', () => {
    store.setConfig({ autonomousTimeoutMs: -1 });
    expect(store.getConfig().autonomousTimeoutMs).toBe(0);

    store.setConfig({ autonomousTimeoutMs: -5000 });
    expect(store.getConfig().autonomousTimeoutMs).toBe(0);
  });

  it('autonomousTimeoutMs: rounds fractional values', () => {
    store.setConfig({ autonomousTimeoutMs: 180_000.7 });
    expect(store.getConfig().autonomousTimeoutMs).toBe(180_001);
  });

  it('autonomousMaxRounds: preserves 0 (unlimited rounds)', () => {
    store.setConfig({ autonomousMaxRounds: 0 });
    expect(store.getConfig().autonomousMaxRounds).toBe(0);
  });

  it('autonomousMaxRounds: clamps positive values to [1, 1000]', () => {
    store.setConfig({ autonomousMaxRounds: -5 }); // negative
    expect(store.getConfig().autonomousMaxRounds).toBe(0); // treated as disabled

    store.setConfig({ autonomousMaxRounds: 0.4 }); // fractional, rounds to 0
    expect(store.getConfig().autonomousMaxRounds).toBe(0);

    store.setConfig({ autonomousMaxRounds: 0.5 }); // fractional, rounds to 1
    expect(store.getConfig().autonomousMaxRounds).toBe(1);

    store.setConfig({ autonomousMaxRounds: 1 }); // floor
    expect(store.getConfig().autonomousMaxRounds).toBe(1);

    store.setConfig({ autonomousMaxRounds: 50 }); // within range
    expect(store.getConfig().autonomousMaxRounds).toBe(50);

    store.setConfig({ autonomousMaxRounds: 2000 }); // above ceiling
    expect(store.getConfig().autonomousMaxRounds).toBe(1000);
  });

  it('autonomousNudgeDelaySeconds: clamps to [10, 600] (no zero-disable)', () => {
    store.setConfig({ autonomousNudgeDelaySeconds: 5 }); // below floor
    expect(store.getConfig().autonomousNudgeDelaySeconds).toBe(10);

    store.setConfig({ autonomousNudgeDelaySeconds: 45 }); // default, within range
    expect(store.getConfig().autonomousNudgeDelaySeconds).toBe(45);

    store.setConfig({ autonomousNudgeDelaySeconds: 1000 }); // above ceiling
    expect(store.getConfig().autonomousNudgeDelaySeconds).toBe(600);
  });

  it('all three autonomous settings survive a round-trip', () => {
    store.setConfig({
      autonomousTimeoutMs: 0,
      autonomousMaxRounds: 100,
      autonomousNudgeDelaySeconds: 30
    });
    const config = store.getConfig();
    expect(config.autonomousTimeoutMs).toBe(0);
    expect(config.autonomousMaxRounds).toBe(100);
    expect(config.autonomousNudgeDelaySeconds).toBe(30);
  });
});

describe('ensureQuickAgentProject — legacy migration', () => {
  it('renames ~/cc-workspace → ~/zcc-workspace when only the legacy dir exists', () => {
    const legacy = join(h.home, 'cc-workspace');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'keepme.txt'), 'scratch work');

    const project = store.ensureQuickAgentProject();

    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(scratchWorkspaceRoot())).toBe(true);
    // content carried over
    expect(existsSync(join(scratchWorkspaceRoot(), 'keepme.txt'))).toBe(true);
    expect(project.path).toBe(scratchWorkspaceRoot());
    expect(project.quickAgent).toBe(true);
    expect(project.name).toBe('Default Workspace');
    expect(project.tag).toBe('zcc-workspace');
  });

  it('re-points a registered project that pointed at the legacy path', () => {
    const legacy = join(h.home, 'cc-workspace');
    mkdirSync(legacy, { recursive: true });
    // Seed a projects.json whose row points at the legacy folder.
    const existing = store.addProject(legacy); // registers ~/cc-workspace
    expect(existing.path).toBe(legacy);

    store.ensureQuickAgentProject();

    const rows = store.listProjects().filter((p) => p.path === scratchWorkspaceRoot());
    expect(rows.length).toBe(1);
    // same id survived the rename (re-pointed, not orphaned + re-added)
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].name).toBe('Default Workspace');
    expect(store.listProjects().some((p) => p.path === legacy)).toBe(false);
  });

  it('never clobbers an existing ~/zcc-workspace (no migration when both exist)', () => {
    const legacy = join(h.home, 'cc-workspace');
    const current = scratchWorkspaceRoot();
    mkdirSync(legacy, { recursive: true });
    mkdirSync(current, { recursive: true });
    writeFileSync(join(legacy, 'old.txt'), 'old');
    writeFileSync(join(current, 'new.txt'), 'new');

    store.ensureQuickAgentProject();

    // both dirs untouched — legacy not moved, current not overwritten
    expect(existsSync(join(legacy, 'old.txt'))).toBe(true);
    expect(existsSync(join(current, 'new.txt'))).toBe(true);
    expect(existsSync(join(current, 'old.txt'))).toBe(false);
  });

  it('ensureScratchRoot migrates the legacy dir (clone-first path)', () => {
    // Regression for the clone-before-QuickAgent ordering: a pre-rebrand user
    // whose first post-upgrade action is "Import from Git" hits ensureScratchRoot
    // via cloneRoot(), NOT ensureQuickAgentProject. Migration must still fire.
    const legacy = join(h.home, 'cc-workspace');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'repo-marker'), 'x');

    const root = store.ensureScratchRoot();

    expect(root).toBe(scratchWorkspaceRoot());
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(scratchWorkspaceRoot(), 'repo-marker'))).toBe(true);
  });

  it('creates a fresh ~/zcc-workspace when no legacy dir exists', () => {
    expect(existsSync(projectsFile)).toBe(false);
    const project = store.ensureQuickAgentProject();
    expect(existsSync(scratchWorkspaceRoot())).toBe(true);
    expect(project.path).toBe(scratchWorkspaceRoot());
    expect(project.quickAgent).toBe(true);
    expect(project.name).toBe('Default Workspace');
    expect(project.tag).toBe('zcc-workspace');
    // exactly one scratch dir, freshly made
    expect(readdirSync(h.home)).toContain('zcc-workspace');
  });

  it('relabels a stored zcc-workspace name without changing the tag', () => {
    const first = store.ensureQuickAgentProject();
    store.updateProject(first.id, { name: 'zcc-workspace' });

    const project = store.ensureQuickAgentProject();

    expect(project.id).toBe(first.id);
    expect(project.name).toBe('Default Workspace');
    expect(project.tag).toBe('zcc-workspace');
    expect(project.path).toBe(scratchWorkspaceRoot());
  });

  it('keeps a custom scratch-workspace name', () => {
    const first = store.ensureQuickAgentProject();
    store.updateProject(first.id, { name: 'My Scratch' });

    expect(store.ensureQuickAgentProject().name).toBe('My Scratch');
  });
});
