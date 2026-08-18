/**
 * OpenCodeProvider — launching the OpenCode CLI (`opencode`, npm `opencode-ai`),
 * for the profiles it serves: `opencode` and `opencode-resume`.
 *
 * OpenCode is a cursor/pi-shaped interactive TUI at the command line: the bare
 * `opencode [dir]` opens the TUI in a directory (the positional is a DIRECTORY,
 * not a seed prompt — a seed prompt is `--prompt <text>`), and `-c`/`--continue`
 * reopens the most-recent session in the cwd (`-s/--session <id>` targets a
 * specific one). Like cursor/pi it takes NONE of Claude's launcher-injected flags
 * — `--mcp-config`, `--settings` (lifecycle hooks), `--session-id`,
 * `--permission-mode`: OpenCode reads MCP servers, agents and plugins from its own
 * config (`opencode.json`), has no `--append-system-prompt` (personas map to named
 * `--agent` configs, not free text), and its session id is DETECTED via `-s`, not
 * minted at spawn. So this is a "base command + resume" provider, inheriting the
 * no-op arg builders + "no auto mode" defaults from {@link BaseLaunchProvider}
 * (those Claude-only flags would break the spawn). Its `ProviderCapabilities` (see
 * `providerCapabilities`) gate every launcher-flag injection OFF, matching this.
 *
 * MCP-VIA-ENV (the one thing OpenCode does that cursor/pi can't): OpenCode honours
 * `OPENCODE_CONFIG_CONTENT`, an env var holding inline config JSON that is
 * deep-merged LAST (highest precedence) over the discovered config. That lets the
 * launcher wire the zcc-inbox MCP server into every OpenCode tab WITHOUT touching
 * the user's project dir (Rule 2) and without clobbering the user's own MCP servers
 * (the merge is deep). {@link OpenCodeProvider.mcpEnv} returns that env var with the
 * resolved per-session URL baked straight into the value — the env-var analogue of
 * claude's `--mcp-config` file + `${ZCC_MCP_URL}` and codex's `-c mcp_servers…` arg.
 * `PtyManager` calls `mcpEnv` for every provider when it has a live MCP base URL and
 * merges the result into the child env; the concrete `OPENCODE_CONFIG_CONTENT`
 * string lives ONLY here (Rule 6).
 *
 * RESUME BY EXACT SESSION (mirrors Codex): OpenCode mints its own `ses_<hex>`
 * id server-side — no flag forces one at spawn — so a specific tab's own
 * conversation is DETECTED after spawn (`OpenCodeSessionResolver`, via
 * `opencode session list --format json` scoped to the tab's cwd) and stamped
 * onto the session (`TerminalSession.openCodeSessionId`). `resolveLaunch`'s
 * `resumeSessionId` param carries that detected id through to `-s/--session
 * <id>`, so restore reopens THAT conversation instead of the cwd's most-recent
 * one; absent an id it falls back to the blunt `-c/--continue`.
 *
 * v1 follow-ups (mirroring cursor/pi): a `--model provider/model` global default
 * (`AppConfig.opencodeModel`, pi's `piModel` pattern), a transcript reader for
 * `~/.local/share/opencode` sessions (flips `hasTranscript` on). Auth stays
 * OpenCode-owned (its `opencode auth login` / provider env keys), so
 * `authKey`/`authInjection` remain the base no-ops.
 *
 * Rule 6: the concrete profile literals (`'opencode'`, `'opencode-resume'`) and the
 * provider id (`'opencode'`) appear ONLY here + the registry — `PtyManager`
 * dispatches through the interface.
 */

import type { AppConfig, LaunchProfileId } from '../../../shared/types.js';
import type {
  RemoteCommandInput,
  RemoteCommandResult,
  ResolvedLaunch
} from '../launch-provider.js';
import { BaseLaunchProvider } from '../base-provider.js';
import type {
  HarnessRoleTarget,
  ModelLevel,
  OpenCodeAgentDescriptor,
  OpenCodeAgentDiscoveryFailureReason,
  OpenCodeAgentDiscoveryResult
} from '../../../shared/harness-adapter.js';
import { facetSupport, type TrustedHarnessAdapter } from '../adapter-contract.js';
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { remoteCdPrefix, shellQuote, shellQuoteArgv } from '../shell-quote.js';
import { cleanExtraArgs } from '../argv-utils.js';
import { resolveExecutionState, resolveModelTarget, resolveRoleTarget } from '../target-resolution.js';

const OPENCODE_MIN_VERSION = '1.18.0';
const OPENCODE_REVIEWED_AT = '2026-08-04';
const openCodeEvidence = (id: string, observed: string, scope: 'local' | 'remote' = 'local') => ({
  id,
  versionRange: OPENCODE_MIN_VERSION,
  scope,
  probe: 'opencode --version; opencode --help; opencode run --help; opencode models aisuite',
  observed: `Minimum supported/reviewed CLI floor: ${OPENCODE_MIN_VERSION}. ${observed}`,
  reviewedAt: OPENCODE_REVIEWED_AT
});

const OPENCODE_ADAPTER: TrustedHarnessAdapter = {
  // Release-maintained snapshot: refresh from `opencode models` whenever a ZCC
  // version changes its supported OpenCode CLI or provider account inventory.
  // Keep catalog, level mapping, and opencode-provider.test.ts in sync.
  descriptor: {
    id: 'opencode', label: 'OpenCode', agentDefaultEligible: true, terminalEligible: false, defaultProfileId: 'opencode',
    profiles: [{ id: 'opencode', posture: 'default' }, { id: 'opencode-resume', posture: 'resume' }],
    capabilities: facetSupport(
      { 'opening-prompt': 'exact', 'mcp-references': 'exact' },
      { 'opening-prompt': 'exact' },
      {
        'opening-prompt': {
          local: openCodeEvidence('opencode.facet.opening-prompt', 'CLI accepts task bytes through --prompt.'),
          remote: openCodeEvidence('opencode.facet.opening-prompt-remote', 'Remote login-shell command binds task bytes through --prompt.', 'remote')
        },
        'mcp-references': openCodeEvidence('opencode.facet.mcp-references', 'CLI accepts merged MCP configuration through OPENCODE_CONFIG_CONTENT.')
      }
    ),
    settingsContributionIds: [],
    configFiles: [{ id: 'native-settings', label: 'Native settings', scopes: [], effect: 'unsupported', rawEdit: false, reason: 'Native project settings file is not verified.' }],
    targets: {
      roles: [
        { id: 'build', label: 'Build', executionStates: ['accept-edits', 'autonomous'], scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION },
        { id: 'plan', label: 'Plan', executionStates: ['plan'], scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION }
      ],
      providers: [
        { id: 'openai', label: 'OpenAI' },
        { id: 'anthropic', label: 'Anthropic' },
        { id: 'google', label: 'Google' }
      ],
      providerModelRelationship: 'combined-provider-model',
      models: [
        { id: 'aisuite/gpt-5.6-luna', label: 'Luna', provider: 'openai', level: 'low', scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION },
        { id: 'aisuite/gpt-5.6-terra', label: 'Terra', provider: 'openai', level: 'medium', scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION },
        { id: 'aisuite/gpt-5.6-sol', label: 'Sol', provider: 'openai', level: 'high', scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION },
        { id: 'aisuite/us.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Haiku', provider: 'anthropic', level: 'low', scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION },
        { id: 'aisuite/us.anthropic.claude-sonnet-5', label: 'Sonnet', provider: 'anthropic', level: 'medium', scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION },
        { id: 'aisuite/gemini-3.1-pro-preview', label: 'Gemini Pro', provider: 'google', level: 'medium', scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION },
        { id: 'aisuite/gemini-3.5-flash', label: 'Gemini Flash', provider: 'google', level: 'low', scope: ['local'], evidenceVersion: OPENCODE_MIN_VERSION }
      ],
      modelLevelMapping: {
        low: 'aisuite/gpt-5.6-luna',
        medium: 'aisuite/gpt-5.6-terra',
        high: 'aisuite/gpt-5.6-sol',
        'extra-high': undefined
      },
      executionStateMapping: {
        plan: 'plan',
        interactive: 'default',
        'accept-edits': 'build + auto-approve',
        autonomous: 'build + auto-approve'
      }
    },
    initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
  },
  executionTargetMetadata: {
    plan: { equivalence: 'exact', scopes: ['local'] },
    interactive: { equivalence: 'conditional', scopes: ['local'] },
    'accept-edits': { equivalence: 'closest', scopes: ['local'] },
    autonomous: { equivalence: 'exact', scopes: ['local'] }
  },
  collision: {
    role: [{ names: ['--agent'], arity: 1, acceptsAttachedValue: true }],
    model: [{ names: ['--model', '-m'], arity: 1, acceptsAttachedValue: true }],
    execution: [
      { names: ['--agent'], arity: 1, acceptsAttachedValue: true },
      { names: ['--auto'], arity: 0 }
    ],
    terminatesAtDoubleDash: true
  },
  status: {
    mode: 'screen-scan',
    detectBlockedPrompt(recentText) {
      const t = recentText.toLowerCase();
      return (
        (t.includes('permission required') &&
          (t.includes('reject') || t.includes('allow once') || t.includes('allow always'))) ||
        (t.includes('enter submit') && t.includes('esc dismiss'))
      );
    }
  },
  evidence: [
    openCodeEvidence('aisuite/gpt-5.6-luna', 'Model appears in opencode models aisuite and --model accepts provider/model IDs.'),
    openCodeEvidence('aisuite/gpt-5.6-terra', 'Model appears in opencode models aisuite and --model accepts provider/model IDs.'),
    openCodeEvidence('aisuite/gpt-5.6-sol', 'Model appears in opencode models aisuite and --model accepts provider/model IDs.'),
    openCodeEvidence('aisuite/us.anthropic.claude-haiku-4-5-20251001-v1:0', 'Model appears in opencode models aisuite and --model accepts provider/model IDs.'),
    openCodeEvidence('aisuite/us.anthropic.claude-sonnet-5', 'Model appears in opencode models aisuite and --model accepts provider/model IDs.'),
    openCodeEvidence('aisuite/gemini-3.1-pro-preview', 'Model appears in opencode models aisuite and --model accepts provider/model IDs.'),
    openCodeEvidence('aisuite/gemini-3.5-flash', 'Model appears in opencode models aisuite and --model accepts provider/model IDs.'),
    openCodeEvidence('build', 'Built-in build role appears in effective opencode agent list output.'),
    openCodeEvidence('plan', 'Built-in plan role appears in effective opencode agent list output.'),
    openCodeEvidence('opencode.role.discovery', 'Project-scoped opencode agent list supplies exact effective role names before launch.')
  ]
};

/** The `opencode` binary: the configured path, else the bare name on PATH. */
function opencodeBinary(config: AppConfig): string {
  return config.opencodeBinary || 'opencode';
}

const OPENCODE_AGENT_HEADING = /^([A-Za-z0-9][A-Za-z0-9._:/-]{0,255})\s+\((primary|subagent|all)\)$/;
const OPENCODE_DEBUG_CONCURRENCY = 2;
const OPENCODE_DISCOVERY_OUTPUT_LIMIT = 2 * 1024 * 1024;

export class OpenCodeAgentDiscoveryError extends Error {
  constructor(
    readonly code: OpenCodeAgentDiscoveryFailureReason,
    readonly agentId?: string,
    options?: { cause?: unknown }
  ) {
    super(code, options);
    this.name = 'OpenCodeAgentDiscoveryError';
  }
}

export function parseOpenCodeAgentDescriptors(output: string): readonly OpenCodeAgentDescriptor[] {
  const seen = new Set<string>();
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(OPENCODE_AGENT_HEADING);
    const id = match?.[1];
    const mode = match?.[2] as OpenCodeAgentDescriptor['mode'] | undefined;
    if (!id || !mode || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: id, mode, hidden: false, directLaunchAllowed: mode !== 'subagent' }];
  });
}

/** Empty stdout is a valid empty catalog; non-empty stdout must yield at least one descriptor. */
export function parseOpenCodeAgentDiscoveryOutput(output: string): readonly OpenCodeAgentDescriptor[] {
  const descriptors = parseOpenCodeAgentDescriptors(output);
  if (output.trim() && descriptors.length === 0) {
    throw new Error('OpenCode agent discovery returned non-empty unrecognized output');
  }
  return descriptors;
}

type OpenCodeAgentDebugMetadata = Pick<OpenCodeAgentDescriptor, 'hidden'>;

export class OpenCodeAgentDebugParseError extends Error {
  constructor() {
    super('OpenCode agent debug returned invalid metadata');
    this.name = 'OpenCodeAgentDebugParseError';
  }
}

export function parseOpenCodeAgentDebugOutput(output: string): OpenCodeAgentDebugMetadata {
  const trimmed = output.trimStart();
  if (!trimmed.startsWith('{')) throw new OpenCodeAgentDebugParseError();

  // Electron receives only the first 8 KiB of OpenCode's 17-26 KiB debug JSON.
  // `hidden` is a top-level header field before the large permission payload, so
  // inspect only that bounded header instead of requiring the truncated document
  // to parse. String values are removed first so prompt text cannot spoof a key.
  const permissionAt = trimmed.indexOf('\n  "permission"');
  const header = trimmed.slice(0, permissionAt >= 0 ? permissionAt : Math.min(trimmed.length, 4_096));
  return { hidden: /"hidden"\s*:\s*true\s*(?:,|\r?\n|})/.test(header) };
}

export async function enrichOpenCodeAgentDescriptors(
  descriptors: readonly OpenCodeAgentDescriptor[],
  loadDebug: (id: string) => Promise<string>
): Promise<readonly OpenCodeAgentDescriptor[]> {
  const enriched = [...descriptors];
  const candidateIndexes = enriched.flatMap((descriptor, index) => descriptor.mode === 'subagent' ? [] : [index]);
  let next = 0;
  const worker = async () => {
    while (next < candidateIndexes.length) {
      const index = candidateIndexes[next++];
      const descriptor = enriched[index];
      let output: string;
      try {
        output = await loadDebug(descriptor.id);
      } catch (cause) {
        throw new OpenCodeAgentDiscoveryError('debug-failed', descriptor.id, { cause });
      }
      let hidden: boolean;
      try {
        ({ hidden } = parseOpenCodeAgentDebugOutput(output));
      } catch (cause) {
        throw new OpenCodeAgentDiscoveryError(
          'invalid-debug-metadata',
          descriptor.id,
          { cause }
        );
      }
      enriched[index] = { ...descriptor, hidden, directLaunchAllowed: !hidden };
    }
  };
  await Promise.all(Array.from({ length: Math.min(OPENCODE_DEBUG_CONCURRENCY, candidateIndexes.length) }, worker));
  return enriched;
}

type DiscoveryOptions = { bypassCache?: boolean };
type DiscoveryLoader = () => Promise<readonly OpenCodeAgentDescriptor[]>;

export class OpenCodeAgentDiscoveryCache {
  private readonly entries = new Map<string, {
    value?: readonly OpenCodeAgentDescriptor[];
    expiresAt?: number;
    inFlight?: Promise<readonly OpenCodeAgentDescriptor[]>;
  }>();
  private readonly generations = new Map<string, {
    next: number;
    latestSuccessful: number;
    active: number;
  }>();
  private activeLoads = 0;
  private readonly loadQueue: Array<() => void> = [];
  private readonly forcedInFlight = new Map<string, Promise<readonly OpenCodeAgentDescriptor[]>>();

  constructor(
    private readonly successTtlMs = Infinity,
    private readonly maxEntries = 8,
    private readonly now = Date.now,
    private readonly maxConcurrentLoads = 2,
    private readonly maxPendingLoads = 16
  ) {}

  discover(command: string, cwd: string, load: DiscoveryLoader, options: DiscoveryOptions = {}) {
    const key = JSON.stringify([command, cwd]);
    if (!options.bypassCache) {
      const existing = this.entries.get(key);
      if (existing?.value && (existing.expiresAt ?? 0) > this.now()) return Promise.resolve(existing.value);
      if (existing?.inFlight) return existing.inFlight;
    } else {
      const forced = this.forcedInFlight.get(key);
      if (forced) return forced;
    }
    const generationState = this.generations.get(key) ?? { next: 0, latestSuccessful: 0, active: 0 };
    const generation = ++generationState.next;
    generationState.active += 1;
    this.generations.set(key, generationState);
    const inFlight = this.runBounded(load).then((value) => {
      if (generation >= generationState.latestSuccessful) {
        generationState.latestSuccessful = generation;
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: this.now() + this.successTtlMs });
        while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
      }
      return value;
    }).catch((error) => {
      if (this.entries.get(key)?.inFlight === inFlight) this.entries.delete(key);
      throw error;
    }).finally(() => {
      generationState.active -= 1;
      if (generationState.active === 0) this.generations.delete(key);
    });
    if (!options.bypassCache) this.entries.set(key, { inFlight });
    else {
      this.forcedInFlight.set(key, inFlight);
      void inFlight.finally(() => {
        if (this.forcedInFlight.get(key) === inFlight) this.forcedInFlight.delete(key);
      }).catch(() => {});
    }
    return inFlight;
  }

  private async runBounded(load: DiscoveryLoader) {
    if (this.activeLoads >= this.maxConcurrentLoads) {
      if (this.loadQueue.length >= this.maxPendingLoads) {
        throw new Error('OpenCode agent discovery queue is full');
      }
      await new Promise<void>((resolve) => this.loadQueue.push(resolve));
    } else {
      this.activeLoads += 1;
    }
    try {
      return await load();
    } finally {
      const next = this.loadQueue.shift();
      if (next) next();
      else this.activeLoads -= 1;
    }
  }
}

const agentDiscoveryCache = new OpenCodeAgentDiscoveryCache();

class OpenCodeDebugCommandGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  async run<T>(load: () => Promise<T>): Promise<T> {
    if (this.active >= OPENCODE_DEBUG_CONCURRENCY) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active += 1;
    try {
      return await load();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

const debugCommandGate = new OpenCodeDebugCommandGate();

function runOpenCodeCaptured(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const outputPath = join(tmpdir(), `zcc-opencode-${randomUUID()}.json`);
    const outputFd = openSync(outputPath, 'wx', 0o600);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { closeSync(outputFd); } catch { /* already closed */ }
      try {
        if (error) reject(error);
        else {
          const output = readFileSync(outputPath);
          if (output.length > OPENCODE_DISCOVERY_OUTPUT_LIMIT) {
            reject(new Error('OpenCode discovery output exceeded limit'));
          } else {
            resolve(output.toString('utf8'));
          }
        }
      } finally {
        rmSync(outputPath, { force: true });
      }
    };
    const child = spawn(command, args, { cwd, stdio: ['ignore', outputFd, 'ignore'] });
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('OpenCode discovery timed out'));
    }, 8_000);
    child.once('error', finish);
    child.once('close', (code) => {
      if (code !== 0) finish(new Error('OpenCode discovery command failed'));
      else finish();
    });
  });
}

function runOpenCodeAgentDebug(command: string, cwd: string, id: string) {
  return debugCommandGate.run(() => runOpenCodeCaptured(command, ['debug', 'agent', id], cwd));
}

function runOpenCodeAgentDiscovery(command: string, cwd: string) {
  return runOpenCodeCaptured(command, ['agent', 'list'], cwd).then(async (stdout) => {
    try {
      const descriptors = parseOpenCodeAgentDiscoveryOutput(stdout);
      return await enrichOpenCodeAgentDescriptors(
        descriptors,
        (id) => runOpenCodeAgentDebug(command, cwd, id)
      );
    } catch (cause) {
      if (cause instanceof OpenCodeAgentDiscoveryError) throw cause;
      throw new OpenCodeAgentDiscoveryError('list-failed', undefined, { cause });
    }
  });
}

function discoverOpenCodeAgents(context: { cwd: string; config: AppConfig }, options?: DiscoveryOptions) {
  const command = opencodeBinary(context.config);
  return agentDiscoveryCache.discover(
    command,
    context.cwd,
    () => runOpenCodeAgentDiscovery(command, context.cwd),
    options
  );
}

export class OpenCodeProvider extends BaseLaunchProvider {
  readonly id = 'opencode';
  readonly adapter = OPENCODE_ADAPTER;
  readonly acceptsDynamicRoleTargets = true;

  dynamicRoleEvidenceTarget(target: { id: string; label: string; scope: readonly ('local' | 'remote')[] }, _installedVersion: string) {
    return { ...target, id: 'opencode.role.discovery', scope: [...target.scope], evidenceVersion: OPENCODE_MIN_VERSION };
  }

  validateRoutingCombination(input: { roleTargetId?: string; executionOrigin: string }) {
    return input.roleTargetId && input.executionOrigin !== 'inherited-native-default'
      ? 'OpenCode native role and execution state require one compatible role policy; clear one selection'
      : undefined;
  }

  static roleTargetsFromDiscovery(
    result: OpenCodeAgentDiscoveryResult,
    staticRoles: readonly HarnessRoleTarget[]
  ): readonly HarnessRoleTarget[] {
    if (result.status === 'failure') return staticRoles;
    return result.descriptors.filter(({ directLaunchAllowed }) => directLaunchAllowed).map(({ id, label }) => ({
      id, label, scope: ['local']
    }));
  }

  static failureResult(error: unknown): OpenCodeAgentDiscoveryResult {
    if (error instanceof OpenCodeAgentDiscoveryError) {
      return {
        status: 'failure',
        reason: error.code,
        ...(error.agentId ? { agentId: error.agentId } : {})
      };
    }
    return { status: 'failure', reason: 'list-failed' };
  }

  async discoverRoleTargets(context: { cwd: string; config: AppConfig }) {
    try {
      const result = await this.discoverAgentDescriptors(context);
      if (result.status === 'failure') return [];
      return OpenCodeProvider.roleTargetsFromDiscovery(result, this.adapter.descriptor.targets?.roles ?? []);
    } catch {
      return [];
    }
  }

  async discoverAgentDescriptors(
    context: { cwd: string; config: AppConfig },
    options: DiscoveryOptions = {}
  ): Promise<OpenCodeAgentDiscoveryResult> {
    try {
      return { status: 'success', descriptors: [...await discoverOpenCodeAgents(context, options)] };
    } catch (error) {
      return OpenCodeProvider.failureResult(error);
    }
  }

  modelContribution(targetId: string, level?: ModelLevel) {
    return { args: ["--model", targetId] };
  }

  roleContribution(roleId: string) {
    return { args: ["--agent", roleId] };
  }

  executionContribution(targetId: string) {
    const state = targetId.replace('opencode.execution.', '');
    if (state === 'plan') return { args: ['--agent', 'plan'] };
    if (state === 'accept-edits' || state === 'autonomous') {
      return { args: ['--agent', 'build', '--auto'] };
    }
    return {};
  }

  resolveLaunch(
    profile: LaunchProfileId,
    config: AppConfig,
    _autoModeActive: boolean,
    resumeSessionId?: string
  ): ResolvedLaunch {
    const command = opencodeBinary(config);
    // `opencode-resume` continues a session in the cwd. With a DETECTED
    // session id (see OpenCodeSessionResolver) it resumes THAT exact
    // conversation via `-s/--session <id>` — the opencode twin of codex's
    // `resume <uuid>` — so restore reopens a specific tab's own conversation
    // instead of collapsing every tab in a cwd onto the most-recent one.
    // Without a detected id it falls back to `-c/--continue` (the cwd's
    // most-recent session). Either dialect pins the session, so
    // `baseArgsPinSession` returns true for both.
    if (profile === 'opencode-resume') {
      return { command, args: resumeSessionId ? ['--session', resumeSessionId] : ['--continue'] };
    }
    return { command, args: [] };
  }

  /**
   * OpenCode reads MCP from its merged config, and honours `OPENCODE_CONFIG_CONTENT`
   * — inline config JSON deep-merged LAST over the discovered config. We wire the
   * zcc-inbox server in there with the identity-bearing per-session URL baked
   * straight into the value: no file written (Rule 2), no `{env:…}` substitution
   * needed, and the deep merge preserves the user's own `mcp` entries. `type:
   * "remote"` + `url` is OpenCode's `StreamableHTTPClientTransport` server shape,
   * matching the zcc-inbox streamable-http server the claude path points at.
   */
  mcpEnv(_profile: LaunchProfileId, mcpUrl: string): Record<string, string> {
    const config = {
      mcp: {
        'zcc-inbox': {
          type: 'remote',
          url: mcpUrl,
          enabled: true
        }
      }
    };
    return { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
  }

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    // opencode-resume's base args carry `--continue`, which pins the session.
    return profile === 'opencode-resume';
  }

  /**
   * OpenCode's TUI emits no OSC status glyph and wires no lifecycle hook
   * (`emitsOscStatus:false` + `supportsHooks:false`), and — verified by a live
   * node-pty probe — goes FULLY SILENT the instant it paints a permission prompt
   * (0 bytes for the whole dwell). So without this the output-activity heuristic
   * settles the session to `idle` ~1.5 s later and a "needs-you" wait reads as
   * "done" — the exact gap this closes.
   *
   * The prompt text is grounded in the OpenCode binary itself (v1.18.4): the TUI
   * component renders `△` (U+25B3) + the localized `permission.title`, whose en
   * value is the literal `"Permission required"`, above the action buttons
   * `"Allow once"` / `"Allow always"` / `"Reject"` (source strings
   * `M(q,T("△")),M(q,T("Permission required"))` and
   * `options:{once:"Allow once",always:"Allow always"}`). We require the title
   * AND at least one action label so ordinary streamed output (which may mention
   * "permission" in prose) can never trip it.
   *
   * SECOND SURFACE — the interactive QUESTION prompt (`ask` tool / QuestionV2).
   * OpenCode goes just as silent when it paints a numbered-options question card
   * (e.g. "How would you like to spend a free weekend?" 1–5 + a "Type your own
   * answer" row) as it does for a permission prompt — so it too settled to `idle`
   * and read as "done" while actually awaiting the user. The permission text above
   * never appears on this surface, so it needs its own signal. The distinctive,
   * blocking-only tell is the key-hint FOOTER the select/question component renders:
   * `↑↓ select  enter submit  esc dismiss`. In the binary that bar is composed by
   * span concatenation — `r("enter ")` + `"submit"` and `r("esc ")` + `"dismiss"`
   * — so the two phrases `"enter submit"` and `"esc dismiss"` appear contiguously in
   * the rendered screen text. We require BOTH together: a submit/dismiss key hint
   * pair is emitted only by an open interactive prompt, never by streamed prose, so
   * it can't false-positive on ordinary output.
   *
   * LOCALE LIMITATION (v1): the permission `title` AND the footer key-hint labels
   * (`submit`/`dismiss`) are all localized in the binary
   * (`"Berechtigung erforderlich"`, …); only the `△` glyph is locale-independent.
   * These match the English strings — correct for the default/most-common install.
   * A locale-independent match (the `△` glyph, or the numeric-key nav glyphs) is a
   * follow-up, tracked alongside migrating this to a data-driven
   * `manifests/opencode.toml` rule once the manifest evaluator lands.
   */
  detectBlockedPrompt(_profile: LaunchProfileId, recentText: string): boolean {
    const t = recentText.toLowerCase();
    // Surface 1 — permission prompt: localized title + at least one action button.
    if (
      t.includes('permission required') &&
      (t.includes('reject') || t.includes('allow once') || t.includes('allow always'))
    ) {
      return true;
    }
    // Surface 2 — interactive question (ask/QuestionV2): the select-footer key-hint
    // pair, emitted only while a prompt is open (both phrases required).
    return t.includes('enter submit') && t.includes('esc dismiss');
  }

  // guidanceArgs / hookArgs / personaArgs / projectSettingsArgs / authInjection /
  // authKey and computeAutoModeActive all inherit the EMPTY / false / null
  // defaults from BaseLaunchProvider. OpenCode has no launcher-injectable guidance
  // (no `--append-system-prompt`; AGENTS.md in the cwd is auto-loaded instead) or
  // hook surface (no `--settings`), its flag surface differs from claude's (no
  // --session-id / --permission-mode), and it authenticates via its own
  // `opencode auth login` or provider env keys — there is no verified single
  // endpoint+token spawn-env override to inject. Auto mode is Claude Code's
  // classifier-backed --permission-mode, not an OpenCode concept. All are v1
  // follow-ups if OpenCode grows a launcher-injectable surface. mcpArgs stays the
  // base no-op — OpenCode carries MCP as env (mcpEnv), not args.

  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    const startPath = input.remote.remotePath || input.config.remoteDefaultPath;
    const remoteExtra = cleanExtraArgs(input.extraArgs);
    const effectiveProfile = input.persona?.baseProfile ?? input.profile;
    const { args: baseArgs } = this.resolveLaunch(effectiveProfile, input.config, false);
    const modelTarget = resolveModelTarget(this, {
      config: input.config,
      persona: input.persona,
      projectSettings: input.projectSettings,
      perTabRouting: input.harnessRouting,
      profile: effectiveProfile,
      extraArgs: remoteExtra,
      scope: 'remote'
    });
    const roleTarget = resolveRoleTarget(this, {
      config: input.config,
      persona: input.persona,
      projectSettings: input.projectSettings,
      perTabRouting: input.harnessRouting,
      profile: effectiveProfile,
      extraArgs: remoteExtra,
      scope: 'remote'
    });
    const execution = resolveExecutionState(this, {
      config: input.config,
      persona: input.persona,
      projectSettings: input.projectSettings,
      perTabRouting: input.harnessRouting,
      profile: effectiveProfile,
      extraArgs: remoteExtra,
      scope: 'remote'
    });
    // Remote tmux inherits its server's stale PATH. A pane-local login shell loads
    // the remote user's CLI installation without mutating that shared environment.
    const argv = [
      'opencode',
      ...baseArgs,
      ...(modelTarget.contribution.args || []),
      ...(roleTarget.contribution.args || []),
      ...(execution.contribution.args || []),
      ...remoteExtra
    ];
    return {
      cmd: `${remoteCdPrefix(startPath)}exec 'bash' '-lic' ${shellQuote(`exec ${shellQuoteArgv(argv)}`)}`
    };
  }

  title(profile: LaunchProfileId): string {
    return profile === 'opencode-resume' ? 'opencode --continue' : 'opencode';
  }
}
