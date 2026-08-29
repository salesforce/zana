/**
 * First-run dependency doctor for companion dependencies.
 *
 * When the app is installed from the .dmg, companion pieces may be absent. On
 * launch we DETECT them and AUTO-INSTALL the ones we can do non-interactively,
 * guiding the user through the rest:
 *
 *   - `claude` CLI            — MANUAL (Claude Code is an external install). Detect-only.
 *   - Zana MCP server         — INSTALLABLE: `npm i -g @zana-ai/mcp@latest`, then
 *                               `claude mcp add zana …` (the registration needs the claude CLI).
 *   - Zana Claude Code plugins— INSTALLABLE: `claude plugin marketplace add …` + `claude plugin install …`.
 *   - Bundled disk extensions — BUNDLED: seeded into ~/.zcc/extensions on boot by
 *                               extension-installer.ts. Reported here for completeness,
 *                               discovered generically (Rule 6 — never names a concrete id).
 *
 * This is a SETUP/REGISTRATION seam, not module-bus logic. It legitimately names
 * the external CLIs / npm package / MCP-server id it wires up. The disk-extension
 * section stays extension-agnostic (scans the install root) because those
 * genuinely are registry extensions.
 *
 * Posture mirrors updater.ts: a factory returning a small interface, pushing
 * status via the injected `safeSend`, owning no long-lived timers. Best-effort
 * throughout — a detection or install failure is reported, never thrown, and
 * never blocks boot.
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type {
  DependencyProgress,
  DependencyState,
  SetupStatus
} from '@zana-ai/zcc-domain/product';

export interface DoctorDeps {
  /** Same core push used by terminals/inbox/updater; no-ops if the window is gone. */
  safeSend: (channel: string, ...args: unknown[]) => void;
  log: (context: string, err: unknown) => void;
  /** Persist `AppConfig.setupDismissed`. */
  setDismissed: (dismissed: boolean) => void;
}

export interface Doctor {
  /** The current snapshot (last detection/install result). */
  snapshot(): SetupStatus;
  /** Re-run detection of every tracked dependency. Pushes status as it goes. */
  check(): Promise<void>;
  /** Run the auto-installable steps for any missing `installable` dependency. */
  install(): Promise<void>;
  /** Persist the "I've dealt with this" choice (Settings / banner ×). */
  dismiss(): void;
}

/** Result of a spawned command — never rejects; failures surface as `ok:false`. */
interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run a command with the (already PATH-repaired) process env. Best-effort. */
function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<CmdResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout ?? '').trim(),
          stderr: String(stderr ?? '').trim()
        });
      }
    );
  });
}

/** Stable ids for the tracked dependencies. */
const ID = {
  claude: 'claude-cli',
  zanaMcp: 'zana-mcp',
  zanaPlugins: 'zana-plugins'
} as const;

export function createDoctor(deps: DoctorDeps): Doctor {
  const { safeSend, log } = deps;

  // Display order is fixed; detection fills in `phase`/`note` in place.
  const items: DependencyState[] = [
    {
      id: ID.claude,
      label: 'Claude Code CLI',
      detail: 'The `claude` command — required for Zana MCP + plugin wiring and for running agents.',
      kind: 'manual',
      phase: 'checking',
      manualCommand: 'See https://claude.com/claude-code to install the Claude Code CLI'
    },
    {
      id: ID.zanaMcp,
      label: 'Zana MCP server',
      detail: 'The @zana-ai/mcp server, registered with Claude Code so agents get Zana tools.',
      kind: 'installable',
      phase: 'checking',
      manualCommand: 'npm install -g @zana-ai/mcp@latest && claude mcp add zana -- npx -y @zana-ai/mcp'
    },
    {
      id: ID.zanaPlugins,
      label: 'Zana plugins',
      detail: 'The Zana Claude Code plugin marketplace + the zana / zana-loop plugins.',
      kind: 'installable',
      phase: 'checking',
      manualCommand:
        'claude plugin marketplace add grebmann1/zana && claude plugin install zana@zana-marketplace'
    }
  ];

  // Discovered disk extensions are appended after the fixed items; tracked by id
  // so a re-check updates in place rather than duplicating.
  const byId = (id: string) => items.find((i) => i.id === id);

  let busy = false;
  let lastJson = '';

  const snapshot = (): SetupStatus => ({ busy, items: items.map((i) => ({ ...i })) });

  const emit = () => {
    const status = snapshot();
    const json = JSON.stringify(status);
    if (json === lastJson) return;
    lastJson = json;
    safeSend(IPC.deps.onStatus, status);
  };

  const progress = (id: string, message: string) => {
    const p: DependencyProgress = { id, message };
    safeSend(IPC.deps.onProgress, p);
  };

  const setPhase = (id: string, phase: DependencyState['phase'], note?: string) => {
    const it = byId(id);
    if (!it) return;
    it.phase = phase;
    if (note !== undefined) it.note = note;
    emit();
  };

  /** Detect the bundled disk extensions seeded under ~/.zcc/extensions/<id>. */
  async function detectBundledExtensions(): Promise<void> {
    const root = process.env.ZCC_EXTENSIONS_DIR ?? join(homedir(), '.zcc', 'extensions');
    let names: string[] = [];
    try {
      names = (await readdir(root, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch {
      names = []; // dir not created yet → no bundled extensions installed
    }
    // Drop any previously-tracked extension rows so a removed extension doesn't
    // linger (the fixed items keep their ids; ext rows are namespaced).
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].id.startsWith('ext:')) items.splice(i, 1);
    }
    for (const name of names) {
      const manifest = join(root, name, 'extension.json');
      let label = name;
      let version = '';
      try {
        const m = JSON.parse(await readFile(manifest, 'utf-8')) as {
          name?: unknown;
          version?: unknown;
        };
        if (typeof m.name === 'string' && m.name) label = m.name;
        if (typeof m.version === 'string') version = m.version;
      } catch {
        // No manifest under this dir — not a real extension; skip it.
        continue;
      }
      items.push({
        id: `ext:${name}`,
        label: `${label} extension`,
        detail: 'Bundled in-app extension — seeded automatically on launch.',
        kind: 'bundled',
        phase: 'present',
        note: version ? `v${version}` : 'installed'
      });
    }
  }

  async function check(): Promise<void> {
    busy = true;
    for (const it of items) {
      if (!it.id.startsWith('ext:')) it.phase = 'checking';
    }
    emit();
    try {
      // claude CLI — manual, detect via `claude --version`.
      const claude = await run('claude', ['--version']);
      setPhase(ID.claude, claude.ok ? 'present' : 'missing', claude.ok ? claude.stdout : undefined);

      // Zana MCP — installable. The AUTHORITATIVE signal that it works is
      // `claude mcp get zana` succeeding: the server is registered as
      // `npx -y @zana-ai/mcp`, which fetches on demand and needs NO global npm
      // install, so a present-but-not-globally-installed machine is fully
      // functional. We therefore key "present" off registration, not `npm ls`
      // (which exits 1 / "(empty)" on a working npx-based setup). When claude
      // isn't around to ask, fall back to the npm-global presence as a hint.
      if (claude.ok) {
        const reg = await run('claude', ['mcp', 'get', 'zana']);
        setPhase(
          ID.zanaMcp,
          reg.ok ? 'present' : 'missing',
          reg.ok ? 'registered with Claude Code' : undefined
        );
      } else {
        const npmLs = await run('npm', ['ls', '-g', '@zana-ai/mcp', '--depth=0']);
        const mcpInstalled = npmLs.ok && /@zana-ai\/mcp@/.test(npmLs.stdout);
        setPhase(
          ID.zanaMcp,
          mcpInstalled ? 'present' : 'missing',
          mcpInstalled ? 'installed (register once the claude CLI is present)' : 'needs the claude CLI to register'
        );
      }

      // Zana plugins — installable; only checkable when claude is present. The
      // real signal is the plugin being INSTALLED (`claude plugin list` shows
      // `zana@zana-marketplace`), not merely the marketplace being configured —
      // a marketplace can be added without any plugin installed from it.
      if (claude.ok) {
        const plugins = await run('claude', ['plugin', 'list']);
        const installed = plugins.ok && /zana@zana-marketplace/.test(plugins.stdout);
        setPhase(
          ID.zanaPlugins,
          installed ? 'present' : 'missing',
          installed ? 'installed' : undefined
        );
      } else {
        setPhase(ID.zanaPlugins, 'missing', 'needs the claude CLI first');
      }

      await detectBundledExtensions();
    } catch (err) {
      log('dependencyDoctor.check', err);
    } finally {
      busy = false;
      emit();
    }
  }

  /** Install the Zana MCP server (npm global + Claude Code registration). */
  async function installZanaMcp(claudePresent: boolean): Promise<void> {
    setPhase(ID.zanaMcp, 'installing');
    progress(ID.zanaMcp, 'Installing @zana-ai/mcp globally (npm i -g)…');
    const npm = await run('npm', ['install', '-g', '@zana-ai/mcp@latest'], 180_000);
    if (!npm.ok) {
      setPhase(ID.zanaMcp, 'failed', npm.stderr.split('\n').pop() || 'npm install failed');
      return;
    }
    if (claudePresent) {
      const reg = await run('claude', ['mcp', 'get', 'zana']);
      if (!reg.ok) {
        progress(ID.zanaMcp, 'Registering the Zana MCP server with Claude Code…');
        // `claude mcp add` is idempotent (re-adding an existing server just
        // rewrites its config and exits 0), so this is safe even if a partial
        // prior run already registered it.
        const add = await run('claude', ['mcp', 'add', 'zana', '--', 'npx', '-y', '@zana-ai/mcp']);
        if (!add.ok) {
          setPhase(ID.zanaMcp, 'failed', 'installed, but `claude mcp add zana` failed');
          return;
        }
      }
      setPhase(ID.zanaMcp, 'installed', 'registered with Claude Code');
    } else {
      setPhase(ID.zanaMcp, 'installed', 'installed (register once the claude CLI is present)');
    }
  }

  /** Install the Zana plugin marketplace + plugins (requires the claude CLI). */
  async function installZanaPlugins(claudePresent: boolean): Promise<void> {
    if (!claudePresent) {
      setPhase(ID.zanaPlugins, 'failed', 'needs the claude CLI first');
      return;
    }
    setPhase(ID.zanaPlugins, 'installing');
    const market = await run('claude', ['plugin', 'marketplace', 'list']);
    if (!(market.ok && /zana-marketplace/.test(market.stdout))) {
      progress(ID.zanaPlugins, 'Adding the Zana plugin marketplace (grebmann1/zana)…');
      const add = await run('claude', ['plugin', 'marketplace', 'add', 'grebmann1/zana']);
      if (!add.ok) {
        setPhase(ID.zanaPlugins, 'failed', '`claude plugin marketplace add` failed');
        return;
      }
    }
    progress(ID.zanaPlugins, 'Installing the zana + zana-loop plugins…');
    // Best-effort: a plugin that's already installed exits non-zero — tolerate it.
    await run('claude', ['plugin', 'install', 'zana@zana-marketplace']);
    await run('claude', ['plugin', 'install', 'zana-loop@zana-marketplace']);
    setPhase(ID.zanaPlugins, 'installed', 'marketplace + plugins ready');
  }

  async function install(): Promise<void> {
    if (busy) return;
    busy = true;
    emit();
    try {
      const claudePresent = byId(ID.claude)?.phase === 'present';
      // Only act on installable items that aren't already satisfied.
      if (byId(ID.zanaMcp)?.phase === 'missing' || byId(ID.zanaMcp)?.phase === 'failed') {
        await installZanaMcp(claudePresent);
      }
      if (byId(ID.zanaPlugins)?.phase === 'missing' || byId(ID.zanaPlugins)?.phase === 'failed') {
        await installZanaPlugins(claudePresent);
      }
    } catch (err) {
      log('dependencyDoctor.install', err);
    } finally {
      busy = false;
      emit();
    }
  }

  return {
    snapshot,
    check,
    install,
    dismiss() {
      deps.setDismissed(true);
    }
  };
}

/** True if any tracked dependency is missing/failed — gates the first-run auto-open. */
export function hasMissingDeps(status: SetupStatus): boolean {
  return status.items.some((i) => i.phase === 'missing' || i.phase === 'failed');
}
