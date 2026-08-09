/**
 * CursorProvider — launching the Cursor agent CLI (`cursor-agent`), for the
 * profiles it serves: `cursor` and `cursor-resume`.
 *
 * cursor-agent is very Claude-Code-shaped at the command line: a positional
 * prompt as the first user turn, `--resume`/`--continue` to reopen a prior
 * chat, and MCP servers discovered from `.cursor/mcp.json` / `~/.cursor/mcp.json`
 * (the same HTTP `mcpServers` schema Claude uses). But the launcher-injected
 * Claude flags — `--mcp-config`, `--settings` (lifecycle hooks), `--session-id`,
 * `--permission-mode` — are NOT part of cursor-agent's interface: it reads MCP
 * and hooks from its own on-disk config. So this provider is deliberately a
 * "base command + resume" provider in v1: it resolves the right binary and the
 * resume flag, and inherits the no-op arg builders + "no auto mode" defaults
 * from {@link BaseLaunchProvider} (those Claude-only flags would break the
 * spawn). Its `ProviderCapabilities` (see `providerCapabilities`) gate every
 * launcher injection OFF, matching this. The one non-default override note kept
 * below is `mcpArgs` — see why the cursor MCP bridge is externally blocked.
 *
 * This mirrors the MCP-less posture the remote ssh path already ships with —
 * the spawn, the tab, resume, and the Agents-board classification all work; the
 * MCP/hook bridge for cursor-agent is a follow-up (blocked end-to-end anyway
 * until the machine is logged into `cursor-agent`).
 *
 * Rule 6: the concrete profile literals (`'cursor'`, `'cursor-resume'`) and the
 * provider id (`'cursor-agent'`) appear ONLY here + the registry — `PtyManager`
 * dispatches through the interface.
 */

import type { AppConfig, LaunchProfileId } from '../../shared/types.js';
import type {
  HarnessAuthInjection,
  RemoteCommandInput,
  RemoteCommandResult,
  ResolvedLaunch
} from './launch-provider.js';
import type { HarnessAuthCredential, HarnessAuthKey } from '../harness-auth.js';
import { BaseLaunchProvider } from './base-provider.js';
import type { ModelLevel } from "../../shared/harness-adapter.js";
import { facetSupport, type TrustedHarnessAdapter } from './adapter-contract.js';

const CURSOR_EVIDENCE_VERSION = '2026.01.23';
const cursorEvidence = (id: string, observed: string) => ({
  id, versionRange: CURSOR_EVIDENCE_VERSION, scope: 'local' as const,
  probe: 'cursor-agent --version plus provider contract suite', observed, reviewedAt: '2026-08-04'
});

const CURSOR_ADAPTER: TrustedHarnessAdapter = {
  // Release-maintained snapshot: refresh from `cursor-agent models` whenever a
  // ZCC version changes its supported Cursor CLI or account inventory. Keep
  // catalog, level mapping, and cursor-provider.test.ts in sync.
  descriptor: {
    id: 'cursor', label: 'Cursor', agentDefaultEligible: true, terminalEligible: false, defaultProfileId: 'cursor',
    profiles: [{ id: 'cursor', posture: 'default' }, { id: 'cursor-resume', posture: 'resume' }, { id: 'cursor-yolo', posture: 'unrestricted' }],
    capabilities: facetSupport({ 'opening-prompt': 'exact' }, undefined, {
      'opening-prompt': cursorEvidence('cursor.facet.opening-prompt', 'CLI accepts opening prompt as spawn argument.')
    }),
    settingsContributionIds: [],
    targets: {
      roles: [],
      providers: [
        { id: 'cursor', label: 'Cursor' },
        { id: 'anthropic', label: 'Anthropic' },
        { id: 'openai', label: 'OpenAI' }
      ],
      providerModelRelationship: 'combined-provider-model',
      models: [
        { id: 'cursor-grok-4.5-high', label: 'Cursor Grok 4.5 High', provider: 'cursor', level: 'high', scope: ['local'], evidenceVersion: CURSOR_EVIDENCE_VERSION },
        { id: 'claude-opus-5-high', label: 'Opus 5 High', provider: 'anthropic', level: 'high', scope: ['local'], evidenceVersion: CURSOR_EVIDENCE_VERSION },
        { id: 'gpt-5.6-sol-medium', label: 'GPT-5.6 Sol Medium', provider: 'openai', level: 'high', scope: ['local'], evidenceVersion: CURSOR_EVIDENCE_VERSION },
        { id: 'claude-sonnet-5-high', label: 'Sonnet 5 High', provider: 'anthropic', level: 'medium', scope: ['local'], evidenceVersion: CURSOR_EVIDENCE_VERSION },
        { id: 'gpt-5.6-terra-medium', label: 'GPT-5.6 Terra Medium', provider: 'openai', level: 'medium', scope: ['local'], evidenceVersion: CURSOR_EVIDENCE_VERSION },
        { id: 'claude-4.5-opus-high', label: 'Opus 4.5', provider: 'anthropic', level: 'high', scope: ['local'], evidenceVersion: CURSOR_EVIDENCE_VERSION },
        { id: 'claude-4.5-sonnet', label: 'Sonnet 4.5', provider: 'anthropic', level: 'medium', scope: ['local'], evidenceVersion: CURSOR_EVIDENCE_VERSION }
      ],
      modelLevelMapping: {
        low: undefined,
        medium: 'gpt-5.6-terra-medium',
        high: 'gpt-5.6-sol-medium',
        'extra-high': undefined
      },
      executionStateMapping: {
        plan: 'plan',
        interactive: 'default',
        'accept-edits': 'force',
        autonomous: 'force'
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
    model: [{ names: ['--model'], arity: 1, acceptsAttachedValue: true }],
    execution: [
      { names: ['--mode'], arity: 1, acceptsAttachedValue: true },
      { names: ['--force'], arity: 0 }
    ],
    terminatesAtDoubleDash: true
  },
  evidence: [
    cursorEvidence('cursor.facet.opening-prompt', 'CLI accepts opening prompt as spawn argument.'),
    ...['cursor-grok-4.5-high', 'claude-opus-5-high', 'gpt-5.6-sol-medium', 'claude-sonnet-5-high',
      'gpt-5.6-terra-medium', 'claude-4.5-opus-high', 'claude-4.5-sonnet']
      .map((id) => cursorEvidence(id, 'Cursor model catalog and --model contribution verified.'))
  ]
};

/** The cursor-agent binary: the configured path, else the bare name on PATH. */
function cursorBinary(config: AppConfig): string {
  return config.cursorBinary || 'cursor-agent';
}

export class CursorProvider extends BaseLaunchProvider {
  readonly id = 'cursor-agent';
  readonly adapter = CURSOR_ADAPTER;



  modelContribution(targetId: string, level?: ModelLevel) {
    return { args: ['--model', targetId] };
  }

  executionContribution(targetId: string) {
    const state = targetId.replace('cursor.execution.', '');
    if (state === 'plan') return { args: ['--mode', 'plan'] };
    if (state === 'accept-edits' || state === 'autonomous') return { args: ['--force'] };
    return {};
  }

  resolveLaunch(profile: LaunchProfileId, config: AppConfig, _autoModeActive: boolean): ResolvedLaunch {
    const command = cursorBinary(config);
    // `cursor-resume` reopens the most-recent chat in the cwd. `--resume` with no
    // id continues the latest chat (parity with claude's `--continue` intent);
    // it's the flag that pins the session, so `baseArgsPinSession` returns true.
    if (profile === 'cursor-resume') {
      return { command, args: ['--resume'] };
    }
    // cursor-yolo → `--force`: cursor-agent's documented permission bypass
    // (auto-approve every action). The YOLO twin of a plain cursor launch.
    if (profile === 'cursor-yolo') {
      return { command, args: ['--force'] };
    }
    return { command, args: [] };
  }

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    // cursor-resume's base args carry `--resume`, which pins the session.
    return profile === 'cursor-resume';
  }

  authInjection(_profile: LaunchProfileId, cred: HarnessAuthCredential): HarnessAuthInjection {
    // cursor-agent is credential-managed by its own `cursor-agent login` today; it
    // exposes no documented base-url/token env override we've verified. We still
    // wire the standard env vars best-effort (a stored token → `CURSOR_API_KEY`, a
    // base URL → `CURSOR_API_URL`) so a user who knows their gateway can set it,
    // but this path is UNVERIFIED against the binary (unlike claude/codex). Emit
    // only what's set; nothing stored ⇒ inject nothing (byte-identical launch).
    const env: Record<string, string> = {};
    if (cred.baseUrl) env.CURSOR_API_URL = cred.baseUrl;
    if (cred.token) env.CURSOR_API_KEY = cred.token;
    return Object.keys(env).length ? { env } : {};
  }

  authKey(_profile: LaunchProfileId): HarnessAuthKey {
    return 'cursor';
  }

  // mcpArgs / guidanceArgs / hookArgs / personaArgs / projectSettingsArgs and
  // computeAutoModeActive all inherit the EMPTY / false defaults from
  // BaseLaunchProvider. cursor-agent has no launcher-injectable MCP / guidance /
  // hook surface (it reads MCP only from the off-limits project `.cursor/mcp.json`
  // or global `~/.cursor/mcp.json` — no `--mcp-config`-style flag, and
  // `CURSOR_DATA_DIR` does NOT relocate that read), and its flag surface differs
  // from claude's (no --append-system-prompt / --add-dir / --allowedTools /
  // --permission-mode), so emitting any of those would break the spawn. Auto
  // mode is Claude Code's classifier-backed --permission-mode, not a cursor
  // concept. All of these are v1 follow-ups if cursor-agent grows a config-path
  // flag. See findings/multi-provider/A5-*.

  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    // Relies on `cursor-agent` being on the remote PATH (mirrors the claude
    // remote path, which uses the bare `claude` name rather than a local path).
    return this.simpleRemoteExec(input, 'cursor-agent');
  }

  title(profile: LaunchProfileId): string {
    if (profile === 'cursor-resume') return 'cursor --resume';
    if (profile === 'cursor-yolo') return 'cursor --force';
    return 'cursor';
  }
}
