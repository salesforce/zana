/**
 * First-run dependency doctor for companion CLIs.
 *
 * On launch we DETECT them and guide the user through the rest:
 *
 *   - Claude Code CLI (`claude`)     — MANUAL. Required for first-run auto-open.
 *   - Cursor CLI (`cursor-agent`)    — INSTALLABLE (official install script).
 *   - OpenCode CLI (`opencode`)      — INSTALLABLE (`npm i -g opencode-ai`).
 *   - Pi CLI (`pi`)                  — INSTALLABLE (`npm i -g @earendil-works/pi-coding-agent`).
 *   - Codex CLI (`codex`)            — INSTALLABLE (`npm i -g @openai/codex`).
 *   - SF CLI (`sf`)                  — INSTALLABLE (`npm i -g @salesforce/cli`).
 *
 * Optional CLIs (everything except Claude Code) appear in the checklist but
 * do not auto-open it — most machines will not have every harness.
 *
 * Posture mirrors updater.ts: a factory returning a small interface, pushing
 * status via the injected `safeSend`, owning no long-lived timers. Best-effort
 * throughout — a detection or install failure is reported, never thrown, and
 * never blocks boot.
 */

import { execFile } from 'node:child_process';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type {
  DependencyKind,
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

const NPM_INSTALL_TIMEOUT_MS = 180_000;
const CURSOR_INSTALL_SCRIPT = 'curl -fsSL https://cursor.com/install | bash';

interface CompanionSpec {
  id: string;
  label: string;
  detail: string;
  kind: DependencyKind;
  required: boolean;
  bin: string;
  versionArgs: readonly string[];
  manualCommand: string;
  install?: { command: string; args: readonly string[]; timeoutMs: number };
}

function npmGlobalInstall(pkg: string): NonNullable<CompanionSpec['install']> {
  return {
    command: 'npm',
    args: ['install', '-g', `${pkg}@latest`],
    timeoutMs: NPM_INSTALL_TIMEOUT_MS
  };
}

/** Display order is the checklist order. */
const COMPANIONS: readonly CompanionSpec[] = [
  {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    detail: 'The `claude` command — required for running Claude Code agents.',
    kind: 'manual',
    required: true,
    bin: 'claude',
    versionArgs: ['--version'],
    manualCommand: 'See https://claude.com/claude-code to install the Claude Code CLI'
  },
  {
    id: 'cursor-cli',
    label: 'Cursor CLI',
    detail: 'The `cursor-agent` command — Cursor agent harness.',
    kind: 'installable',
    required: false,
    bin: 'cursor-agent',
    versionArgs: ['--version'],
    manualCommand: CURSOR_INSTALL_SCRIPT,
    install: { command: 'sh', args: ['-c', CURSOR_INSTALL_SCRIPT], timeoutMs: NPM_INSTALL_TIMEOUT_MS }
  },
  {
    id: 'opencode-cli',
    label: 'OpenCode CLI',
    detail: 'The `opencode` command — OpenCode agent harness.',
    kind: 'installable',
    required: false,
    bin: 'opencode',
    versionArgs: ['--version'],
    manualCommand: 'npm install -g opencode-ai@latest',
    install: npmGlobalInstall('opencode-ai')
  },
  {
    id: 'pi-cli',
    label: 'Pi CLI',
    detail: 'The `pi` command — Pi coding agent harness.',
    kind: 'installable',
    required: false,
    bin: 'pi',
    versionArgs: ['--version'],
    manualCommand: 'npm install -g @earendil-works/pi-coding-agent@latest',
    install: npmGlobalInstall('@earendil-works/pi-coding-agent')
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    detail: 'The `codex` command — Codex agent harness.',
    kind: 'installable',
    required: false,
    bin: 'codex',
    versionArgs: ['--version'],
    manualCommand: 'npm install -g @openai/codex@latest',
    install: npmGlobalInstall('@openai/codex')
  },
  {
    id: 'sf-cli',
    label: 'SF CLI',
    detail: 'The `sf` command — Salesforce CLI.',
    kind: 'installable',
    required: false,
    bin: 'sf',
    versionArgs: ['--version'],
    manualCommand: 'npm install -g @salesforce/cli@latest',
    install: npmGlobalInstall('@salesforce/cli')
  }
];

/** Run a command with the (already PATH-repaired) process env. Best-effort. */
function run(cmd: string, args: readonly string[], timeoutMs = 15_000): Promise<CmdResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
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

function versionNote(stdout: string): string {
  const line =
    stdout
      .split(/\r?\n/u)
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? stdout.trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

function failNote(result: CmdResult): string {
  const line =
    result.stderr
      .split(/\r?\n/u)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .pop() ||
    result.stdout
      .split(/\r?\n/u)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .pop() ||
    'install failed';
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

export function createDoctor(deps: DoctorDeps): Doctor {
  const { safeSend, log } = deps;

  const items: DependencyState[] = COMPANIONS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    detail: spec.detail,
    kind: spec.kind,
    phase: 'checking',
    manualCommand: spec.manualCommand,
    required: spec.required
  }));

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
    it.note = note;
    emit();
  };

  async function probe(spec: CompanionSpec): Promise<void> {
    const result = await run(spec.bin, spec.versionArgs);
    setPhase(spec.id, result.ok ? 'present' : 'missing', result.ok ? versionNote(result.stdout) : undefined);
  }

  async function check(): Promise<void> {
    busy = true;
    for (const it of items) it.phase = 'checking';
    emit();
    try {
      await Promise.all(COMPANIONS.map((spec) => probe(spec)));
    } catch (err) {
      log('dependencyDoctor.check', err);
    } finally {
      busy = false;
      emit();
    }
  }

  async function installOne(spec: CompanionSpec): Promise<void> {
    if (!spec.install) return;
    const current = byId(spec.id);
    if (current?.phase !== 'missing' && current?.phase !== 'failed') return;

    setPhase(spec.id, 'installing');
    progress(spec.id, `Installing ${spec.label}…`);
    const result = await run(spec.install.command, spec.install.args, spec.install.timeoutMs);
    if (!result.ok) {
      setPhase(spec.id, 'failed', failNote(result));
      return;
    }
    const verify = await run(spec.bin, spec.versionArgs);
    setPhase(
      spec.id,
      'installed',
      verify.ok ? versionNote(verify.stdout) : 'installed'
    );
  }

  async function install(): Promise<void> {
    if (busy) return;
    busy = true;
    emit();
    try {
      for (const spec of COMPANIONS) {
        if (spec.kind === 'installable') await installOne(spec);
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

/**
 * True if a required dependency is missing/failed — gates the first-run
 * auto-open. Optional CLIs (`required: false`) are listed but never trip this.
 */
export function hasMissingDeps(status: SetupStatus): boolean {
  return status.items.some(
    (i) => i.required !== false && (i.phase === 'missing' || i.phase === 'failed')
  );
}
