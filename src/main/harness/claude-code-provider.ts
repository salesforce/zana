/**
 * ClaudeCodeProvider — everything provider-specific about launching the Claude
 * Code CLI (`claude`), for the three profiles it serves: `claude`,
 * `claude-resume`, `claude-yolo`.
 *
 * Every builder here moved out of `pty.ts` VERBATIM during the LaunchProvider
 * seam extraction. The golden-argv snapshot suite proves the argv/env/remote-
 * command output is byte-identical to the pre-extraction code. Do not "improve"
 * these while the seam is being landed — a behaviour change here is a snapshot
 * failure.
 *
 * Rule 6: this file (and the registry) are the ONLY places the concrete profile
 * literals (`'claude-yolo'`, `'claude-resume'`) and the provider id
 * (`'claude-code'`) may appear — `PtyManager` dispatches through the interface.
 */

import type {
  AppConfig,
  LaunchProfileId,
  Persona,
  ProjectSettings
} from '../../shared/types.js';
import { isClaudeProfile } from '../../shared/launch-provider.js';
import type {
  AutoModeInput,
  HarnessAuthInjection,
  RemoteCommandInput,
  RemoteCommandResult,
  ResolvedLaunch
} from './launch-provider.js';
import type { HarnessAuthCredential, HarnessAuthKey } from '../harness-auth.js';
import { BaseLaunchProvider } from './base-provider.js';
import { cleanExtraArgs, mergeAllowedTools, mergeDisallowedTools } from './argv-utils.js';
import { remoteCdPrefix, shellQuote, shellQuoteArgv } from './shell-quote.js';
import { extractPinnedSessionId, buildSystemPromptGuidance, inboxAllowedTools } from './spawn-plan.js';
import { resolveModelAlias } from '../model-resolve.js';
import type { ModelLevel } from '../../shared/harness-adapter.js';
import { resolveExecutionState, resolveModelTarget, resolveRoleTarget } from './target-resolution.js';
import { facetSupport, type TrustedHarnessAdapter } from './adapter-contract.js';

const CLAUDE_EVIDENCE_VERSION = '2.1.220';
const claudeEvidence = (id: string, scope: 'local' | 'remote', observed: string) => ({
  id, versionRange: CLAUDE_EVIDENCE_VERSION, scope,
  probe: 'claude --version plus golden argv and provider contract suite', observed, reviewedAt: '2026-08-04'
});

const CLAUDE_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'claude',
    label: 'Claude Code',
    agentDefaultEligible: true,
    terminalEligible: false,
    defaultProfileId: 'claude',
    compatibilityFallbackProfileId: 'claude',
    profiles: [
      { id: 'claude', posture: 'default' },
      { id: 'claude-resume', posture: 'resume' },
      { id: 'claude-yolo', posture: 'unrestricted' }
    ],
    capabilities: facetSupport({
      'system-instructions': 'exact', 'opening-prompt': 'exact', 'tool-allowlist': 'exact',
      'tool-denylist': 'exact', 'context-directories': 'exact', 'mcp-references': 'exact',
      'model-selection': 'exact', 'execution-policy': 'exact'
    }, undefined, Object.fromEntries([
      'system-instructions', 'opening-prompt', 'tool-allowlist', 'tool-denylist',
      'context-directories', 'mcp-references', 'model-selection', 'execution-policy'
    ].map((facet) => [facet, {
      local: claudeEvidence(`claude.facet.${facet}`, 'local', 'Provider contract and golden argv preserve native Claude behavior.'),
      remote: claudeEvidence(`claude.facet.${facet}`, 'remote', 'Remote provider contract preserves native Claude behavior.')
    }]))),
    targets: {
      roles: [],
      providers: [{ id: 'anthropic', label: 'Anthropic' }],
      providerModelRelationship: 'fixed-provider',
      models: [
        { id: 'haiku', label: 'Haiku (latest)', level: 'low', scope: ['local', 'remote'], evidenceVersion: CLAUDE_EVIDENCE_VERSION },
        { id: 'sonnet', label: 'Sonnet (latest)', level: 'medium', scope: ['local', 'remote'], evidenceVersion: CLAUDE_EVIDENCE_VERSION },
        { id: 'opus', label: 'Opus (latest)', level: 'high', scope: ['local', 'remote'], evidenceVersion: CLAUDE_EVIDENCE_VERSION },
        { id: 'fable', label: 'Fable (latest)', level: 'extra-high', scope: ['local', 'remote'], evidenceVersion: CLAUDE_EVIDENCE_VERSION }
      ],
      modelLevelMapping: { low: 'haiku', medium: 'sonnet', high: 'opus', 'extra-high': 'fable' },
      executionStateMapping: {
        plan: 'plan',
        interactive: 'default',
        'accept-edits': 'accept-edits',
        autonomous: 'bypassPermissions'
      }
    },
    settingsContributionIds: ['claude-global-defaults', 'claude-project-overrides'],
    initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
  },
  executionTargetMetadata: {
    plan: { equivalence: 'exact', scopes: ['local', 'remote'] },
    interactive: { equivalence: 'exact', scopes: ['local', 'remote'] },
    'accept-edits': { equivalence: 'exact', scopes: ['local', 'remote'] },
    autonomous: { equivalence: 'exact', scopes: ['local', 'remote'] }
  },
  collision: {
    model: [{ names: ['--model'], arity: 1, acceptsAttachedValue: true }],
    execution: [
      { names: ['--permission-mode'], arity: 1, acceptsAttachedValue: true },
      { names: ['--dangerously-skip-permissions'], arity: 0 }
    ],
    terminatesAtDoubleDash: true
  },
  evidence: [
    ...['haiku', 'sonnet', 'opus', 'fable'].flatMap((id) => [
      claudeEvidence(id, 'local', 'Native Claude --model alias accepted by golden argv contract.'),
      claudeEvidence(id, 'remote', 'Native Claude --model alias accepted by remote argv contract.')
    ]),
    ...['system-instructions', 'opening-prompt', 'tool-allowlist', 'tool-denylist', 'context-directories', 'mcp-references', 'model-selection', 'execution-policy']
      .flatMap((facet) => [
        claudeEvidence(`claude.facet.${facet}`, 'local', 'Provider contract and golden argv preserve native Claude behavior.'),
        claudeEvidence(`claude.facet.${facet}`, 'remote', 'Remote provider contract preserves native Claude behavior.')
      ])
  ]
};

/**
 * Build the global CLI flags derived from AppConfig for claude / claude-resume
 * profiles. These are inserted BEFORE extraArgs so the caller can override.
 *
 * When `autoModeActive` (the resolved default — see {@link computeAutoModeActive}),
 * the permission mode is Claude Code's native `auto` (classifier-backed). It's
 * emitted in this global layer so an explicit persona / project / per-tab
 * `--permission-mode` still overrides it via last-occurrence-wins.
 */
function globalClaudeArgs(config: AppConfig, autoModeActive: boolean): string[] {
  const args: string[] = [];
  if (config.claudeAppendSystemPrompt) {
    args.push('--append-system-prompt', config.claudeAppendSystemPrompt);
  }
  for (const dir of config.claudeAddDirs ?? []) args.push('--add-dir', dir);
  if (config.claudeAllowedTools?.length) args.push('--allowedTools', config.claudeAllowedTools.join(','));
  if (config.claudeDeniedTools?.length) args.push('--disallowedTools', config.claudeDeniedTools.join(','));
  if (autoModeActive) args.push('--permission-mode', 'auto');
  args.push(...(config.claudeExtraArgs ?? []));
  return args;
}

/** Family aliases / version strings that cannot run auto mode (Bedrock/Vertex/
 * Foundry support only Sonnet 5 / Opus 4.7 / Opus 4.8; Haiku is never eligible).
 * We only block the one case settable from our UI — the `haiku` family alias —
 * and let anything else through; an exotic explicit old-version string is an
 * advanced-user concern and auto mode degrades gracefully (reports unavailable)
 * rather than corrupting the session. */
function modelSupportsAutoMode(model: string | undefined): boolean {
  if (!model) return true;
  return !/haiku/i.test(model);
}

/**
 * The model that will actually take effect for a launch, resolving the same
 * precedence as the emitted `--model` flags (last-occurrence-wins): per-tab
 * extraArgs > project settings > persona. Returns undefined when nothing pins
 * a model (claude decides). Used only to gate auto-mode eligibility.
 */
function resolveEffectiveModel(opts: {
  persona?: Persona;
  projectSettings?: ProjectSettings;
  extraArgs: string[];
}): string | undefined {
  const fromExtra = (() => {
    const i = opts.extraArgs.findIndex((a) => a === '--model' || a.startsWith('--model='));
    if (i < 0) return undefined;
    const a = opts.extraArgs[i];
    if (a.includes('=')) return a.slice(a.indexOf('=') + 1) || undefined;
    return opts.extraArgs[i + 1];
  })();
  const personaModel = opts.persona
    ? (opts.persona.model ||
       opts.persona.harnessRouting?.byAdapter?.claude?.modelTargetId ||
       opts.persona.harnessRouting?.byAdapter?.claude?.compatibility?.model)
    : undefined;
  const projectModel = opts.projectSettings?.harnessRouting?.byAdapter?.claude?.modelTargetId
    || opts.projectSettings?.harnessRouting?.byAdapter?.claude?.compatibility?.model
    || opts.projectSettings?.model;
  return fromExtra || projectModel || personaModel;
}

/**
 * Build CLI flags derived from a Persona. Mirrors {@link buildProjectSettingsArgs}
 * in shape and flag style — same order, same yolo guard, same "model and
 * permissionMode last" convention. Inserted AFTER claudeMcpArgs (so persona
 * append-system-prompt layers on top of inbox guidance) and BEFORE
 * projectSettings (so persona choices take priority over project defaults).
 *
 * Precedence order:
 *   base profile args → AppConfig globals → claudeMcpArgs → projectSettings →
 *   PERSONA → hookArgs → per-tab extraArgs
 *
 * Exported standalone (and re-exported from `pty.ts`) because several tests
 * build persona argv directly without going through a launch.
 */
export function personaArgs_build(p: Persona, baseProfile: LaunchProfileId): string[] {
  const args: string[] = [];
  if (p.appendSystemPrompt) {
    args.push('--append-system-prompt', p.appendSystemPrompt);
  }
  for (const dir of p.addDirs ?? []) {
    args.push('--add-dir', dir);
  }
  if ((p.allowedTools ?? []).length > 0) {
    args.push('--allowedTools', p.allowedTools!.join(','));
  }
  if ((p.deniedTools ?? []).length > 0) {
    args.push('--disallowedTools', p.deniedTools!.join(','));
  }
  // model / permissionMode appended last so they override any global value
  // (claude CLI: last occurrence wins for these flags). permissionMode is
  // skipped when the effective base profile is claude-yolo — it forces
  // --dangerously-skip-permissions, which takes precedence.

  const permMode = p.permissionMode || p.harnessRouting?.byAdapter?.claude?.executionTargetId || p.harnessRouting?.byAdapter?.claude?.compatibility?.permissionMode;
  if (permMode && baseProfile !== 'claude-yolo') {
    args.push('--permission-mode', permMode);
  }
  return args;
}

/**
 * Build CLI flags derived from per-project ProjectSettings.
 * Inserted AFTER the global AppConfig flags and claudeMcpArgs so they
 * override globals, and BEFORE per-tab extraArgs so per-tab args win.
 */
function buildProjectSettingsArgs(s: ProjectSettings, profile: LaunchProfileId): string[] {
  const args: string[] = [];
  if (s.appendSystemPrompt) {
    args.push('--append-system-prompt', s.appendSystemPrompt);
  }
  for (const dir of s.addDirs ?? []) {
    args.push('--add-dir', dir);
  }
  if ((s.allowedTools ?? []).length > 0) {
    args.push('--allowedTools', s.allowedTools!.join(','));
  }
  if ((s.deniedTools ?? []).length > 0) {
    args.push('--disallowedTools', s.deniedTools!.join(','));
  }
  // model / permissionMode appended last so they override any global value
  // (claude CLI: last occurrence wins for these flags).

  if (s.permissionMode && profile !== 'claude-yolo') {
    args.push('--permission-mode', s.permissionMode);
  }
  if (s.extraArgs) {
    args.push(...s.extraArgs);
  }
  return args;
}

export class ClaudeCodeProvider extends BaseLaunchProvider {
  readonly id = 'claude-code';
  readonly adapter = CLAUDE_ADAPTER;

  modelContribution(targetId: string, level?: ModelLevel) {
    return { args: ['--model', resolveModelAlias(targetId)] };
  }

  roleContribution(roleId: string) {
    return {};
  }

  executionContribution(targetId: string) {
    const state = targetId.replace('claude.execution.', '') as 'plan' | 'interactive' | 'accept-edits' | 'autonomous';
    const mode = {
      plan: 'plan',
      interactive: 'default',
      'accept-edits': 'acceptEdits',
      autonomous: 'bypassPermissions'
    }[state];
    return mode === 'default' ? {} : { args: ['--permission-mode', mode] };
  }

  resolveLaunch(profile: LaunchProfileId, config: AppConfig, autoModeActive: boolean): ResolvedLaunch {
    switch (profile) {
      case 'claude':
        return { command: config.claudeBinary, args: globalClaudeArgs(config, autoModeActive) };
      case 'claude-resume':
        return {
          command: config.claudeBinary,
          args: ['--resume', ...globalClaudeArgs(config, autoModeActive)]
        };
      case 'claude-yolo':
        // --dangerously-skip-permissions takes precedence; do NOT inject --permission-mode.
        return { command: config.claudeBinary, args: ['--dangerously-skip-permissions'] };
      default:
        // Unreachable: the registry only routes claude-family profiles here.
        return { command: config.claudeBinary, args: [] };
    }
  }

  // mcpArgs / guidanceArgs / hookArgs all inherit the EMPTY defaults from
  // BaseLaunchProvider: claude carries MCP as the launcher-owned `--mcp-config`
  // FILE + `ZCC_MCP_URL` env, guidance as the `--append-system-prompt` that
  // `PtyManager` splices into `claudeMcpArgs`, and lifecycle hooks as the
  // launcher-owned `--settings` JSON + `ZCC_*_URL` env — all gated on
  // `injectsClaudeMcpConfig` and owned by `PtyManager`, NOT delivered as command-line
  // args here. (codex is the only provider that overrides these — it carries
  // all three as `-c` args.)

  authInjection(_profile: LaunchProfileId, cred: HarnessAuthCredential): HarnessAuthInjection {
    // Claude Code takes a gateway/proxy endpoint + bearer purely through env:
    // `ANTHROPIC_BASE_URL` points the CLI at the endpoint, `ANTHROPIC_AUTH_TOKEN`
    // is the bearer it sends (distinct from `ANTHROPIC_API_KEY`, which is the
    // first-party-console key path — the token form is what a gateway expects).
    // No argv needed. Emit only the vars we actually have, so a plain launch (no
    // stored/ambient credential) injects nothing and stays byte-identical.
    const env: Record<string, string> = {};
    if (cred.baseUrl) env.ANTHROPIC_BASE_URL = cred.baseUrl;
    if (cred.token) env.ANTHROPIC_AUTH_TOKEN = cred.token;
    return Object.keys(env).length ? { env } : {};
  }

  authKey(_profile: LaunchProfileId): HarnessAuthKey {
    return 'claude';
  }

  personaArgs(persona: Persona, profile: LaunchProfileId): string[] {
    return personaArgs_build(persona, profile);
  }

  projectSettingsArgs(settings: ProjectSettings, profile: LaunchProfileId): string[] {
    return buildProjectSettingsArgs(settings, profile);
  }

  /**
   * Resolve whether a launch runs in auto mode. Auto mode is the DEFAULT
   * (`autoModeEnabled` absent ⇒ on) but only stands in for the *default* permission
   * mode: any explicitly-chosen mode wins and turns it off for that launch. It's
   * claude-family only (never yolo, which is already --dangerously-skip-permissions)
   * and skipped when the effective model can't support it.
   */
  computeAutoModeActive(input: AutoModeInput): boolean {
    if (!isClaudeProfile(input.profile) || input.profile === 'claude-yolo') {
      return false;
    }
    if (input.config.autoModeEnabled === false) return false;
    // Any explicitly-chosen permission mode (global non-default, per-persona,
    // per-project, or per-tab) takes precedence over the auto-mode default.
    const globalOverride =
      !!input.config.defaultPermissionMode && input.config.defaultPermissionMode !== 'default';
    const structuredExecution = input.config.harnessRouting?.byAdapter?.claude?.executionState;
    const perTabStructuredExecution = input.harnessRouting?.byAdapter?.claude?.executionState;
    const projectExecution = input.projectSettings?.harnessRouting?.byAdapter?.claude?.executionState
      ?? input.projectSettings?.executionState;
    const perTabOverride = input.extraArgs.some(
      (a) => a === '--permission-mode' || a.startsWith('--permission-mode=')
    );
    const personaPermissionMode = input.persona
      ? (input.persona.permissionMode ||
         input.persona.harnessRouting?.byAdapter?.claude?.executionTargetId ||
         input.persona.harnessRouting?.byAdapter?.claude?.compatibility?.permissionMode)
      : undefined;
    const personaExecution = input.persona?.harnessRouting?.byAdapter?.claude?.executionState
      ?? input.persona?.executionState;
    if (
      globalOverride ||
      structuredExecution ||
      input.config.defaultExecutionState ||
      perTabStructuredExecution ||
      projectExecution ||
      personaPermissionMode ||
      personaExecution ||
      input.projectSettings?.permissionMode ||
      perTabOverride
    ) {
      return false;
    }
    const effectiveModel = resolveEffectiveModel({
      persona: input.persona,
      projectSettings: input.projectSettings,
      extraArgs: input.extraArgs
    });
    return modelSupportsAutoMode(effectiveModel);
  }

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    // claude-resume's base args carry `--resume`, which pins the session.
    return profile === 'claude-resume';
  }

  /**
   * Build the single command string handed to the remote sshd. Runs the claude
   * CLI with the same global / per-project / persona flag stack the local path
   * uses. MCP is off by default (byte-identical to the historical remote argv);
   * when the caller opts in (`remoteMcpEnabled` → `input.remoteMcpUrl` set), it
   * splices an inline `--mcp-config` pointed at the reverse-tunnel loopback URL
   * plus the inbox `--allowedTools` and inbox-usage `--append-system-prompt`
   * guidance, so the remote agent gains the same zcc-inbox surface a local agent
   * has. Relies on `claude` being on the remote PATH.
   */
  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    // Start path precedence: per-project remotePath → global remoteDefaultPath →
    // remote $HOME (no cd prefix).
    const startPath = input.remote.remotePath || input.config.remoteDefaultPath;
    const cdPrefix = remoteCdPrefix(startPath);

    // Mirror the local precedence stack: base → globals → projectSettings → PERSONA.
    const effectiveProfile = input.persona?.baseProfile ?? input.profile;
    const remoteExtra = cleanExtraArgs(input.extraArgs);
    const autoModeActive = this.computeAutoModeActive({
      profile: effectiveProfile,
      config: input.config,
      persona: input.persona,
      projectSettings: input.projectSettings,
      harnessRouting: input.harnessRouting,
      extraArgs: remoteExtra
    });
    
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

    const { args: baseArgs } = this.resolveLaunch(effectiveProfile, input.config, autoModeActive);
    const personaArgs =
      input.persona && isClaudeProfile(effectiveProfile)
        ? personaArgs_build(input.persona, effectiveProfile)
        : [];
    const psArgs = input.projectSettings
      ? buildProjectSettingsArgs(input.projectSettings, effectiveProfile)
      : [];


    // Hook `--settings` (merges with the remote's own settings files, never
    // replaces them — same additive contract as the local path). Only spliced
    // when the caller wired the reverse tunnel + hook env; a plain remote spawn
    // (no callback URL) keeps the historical no-hooks behaviour.
    const hookArgs = input.hookSettingsJson ? ['--settings', input.hookSettingsJson] : [];
    // Remote MCP forwarding (opt-in, `remoteMcpEnabled`): when `createRemote`
    // wired the reverse tunnel AND handed us the loopback MCP URL, register the
    // zcc-inbox server INLINE — the URL is baked into the `--mcp-config` JSON so
    // no remote `.mcp.json` file is needed (the local path writes a file + relies
    // on `${ZCC_MCP_URL}` substitution; the remote can't, so we embed the resolved
    // loopback URL directly). This gives the remote agent the SAME inbox surface a
    // local agent has, reached over the `ssh -R` tunnel back to our MCP server.
    // Only claude-family profiles carry MCP (guarded by `isClaudeProfile`).
    const mcpEnabled = !!input.remoteMcpUrl && isClaudeProfile(effectiveProfile);
    const mcpConfigJson = mcpEnabled
      ? JSON.stringify({
          mcpServers: { 'zcc-inbox': { type: 'streamable-http', url: input.remoteMcpUrl } }
        })
      : undefined;
    const mcpArgs = mcpConfigJson ? ['--mcp-config', mcpConfigJson] : [];
    // Inbox-usage guidance, appended to the system prompt so the remote agent
    // knows the inbox / mesh / follow-up / library tools exist and when to use
    // them — the remote twin of the local `create()` `--append-system-prompt`. Only
    // when MCP is actually wired (otherwise the tools aren't reachable).
    const guidanceArgs = mcpEnabled
      ? ['--append-system-prompt', buildSystemPromptGuidance(input.scheduled ?? false)]
      : [];
    // The inbox allowlist, folded into the single `--allowedTools` flag below so a
    // persona/project allowlist can't drop it (last-wins). Empty when MCP is off,
    // so the historical no-inbox remote argv is byte-identical.
    const inboxAllow = mcpEnabled ? inboxAllowedTools(input.scheduled ?? false) : [];
    // Per-tab claude session id — the remote twin of the local `create()` block. Mint
    // a stable `--session-id` ONLY when we own it: skip when the caller already
    // pins a session (resume/continue/session-id in extraArgs, or the
    // claude-resume profile), else a second `--session-id` conflicts. Capturing
    // the id is what makes a remote conversation resumable across a relaunch.
    const caps = this.capabilities(effectiveProfile);
    const callerPinsSession =
      this.baseArgsPinSession(effectiveProfile) ||
      remoteExtra.some(
        (a) =>
          a === '--resume' ||
          a === '-r' ||
          a === '--continue' ||
          a === '-c' ||
          a === '--session-id' ||
          a.startsWith('--resume=') ||
          a.startsWith('--continue=') ||
          a.startsWith('--session-id=')
      );
    // A resume reconnect (`input.resume`) is mutually exclusive with minting a
    // fresh `--session-id`: `--continue` resumes the prior on-disk conversation
    // (which owns its own id), so a freshly-minted id would both conflict at the
    // CLI and start a NEW conversation, defeating the resume. So a resume spawn
    // suppresses minting (the fork's remote path never minted on resume) and
    // relies on `--continue` below to own the session.
    const minted =
      caps.acceptsSessionId && !callerPinsSession && !input.resume && input.mintClaudeSessionId
        ? input.mintClaudeSessionId()
        : undefined;
    const claudeSessionId = minted ?? extractPinnedSessionId(remoteExtra);
    const sessionIdArgs = minted ? ['--session-id', minted] : [];
    // Reconnect resume (`input.resume`): append `--continue` so a create-fresh
    // reconnect (the remote tmux session was gone) picks up the cwd's most-recent
    // conversation. Skip when the caller already pins a resume/continue/session-id
    // flag (`callerPinsSession`, computed above) so we never double the flag.
    const resumeArgs = input.resume && !callerPinsSession ? ['--continue'] : [];
    // Fold every `--allowedTools` occurrence into ONE last-wins flag — same as
    // the local assembly in `PtyManager.create`. Without this, a persona
    // allowlist AND a project allowlist would emit two `--allowedTools` flags and
    // the claude CLI's last-occurrence-wins would silently DROP the persona's
    // list on the remote path. When remote MCP is off, `inboxAllow` is empty so
    // the merge just dedups the persona + project lists (byte-identical to the
    // historical no-MCP remote argv); when on, it folds in the inbox tools.
    // Same fold for `--disallowedTools` (persona/project deny-list vs. remoteExtra).
    const argv = mergeDisallowedTools(
      mergeAllowedTools(
        [
          'claude',
          ...baseArgs,
          ...(!modelTarget.structuredSelected ? (modelTarget.contribution.args || []) : []),
          ...mcpArgs,
          ...sessionIdArgs,
          ...psArgs,
          ...personaArgs,
          ...(modelTarget.structuredSelected ? (modelTarget.contribution.args || []) : []),
          ...(roleTarget.contribution.args || []),
          ...(execution.contribution.args || []),
          ...guidanceArgs,
          ...hookArgs,
          ...resumeArgs,
          ...remoteExtra
        ],
        inboxAllow
      ),
      []
    );
    // Prepend the enable var so auto mode also lights up on a remote Bedrock/Vertex
    // /Foundry host (harmless no-op on the Anthropic API). The remote claude reads
    // its own settings files for classifier trust; we only carry the flag + env.
    const autoModeEnv = autoModeActive ? 'CLAUDE_CODE_ENABLE_AUTO_MODE=1 ' : '';
    // Per-session hook-callback URLs, exported as a `KEY='val' …` prefix on the
    // exec so the remote claude's hook commands (`curl "$ZCC_NOTIFY_URL/blocked"`
    // …) resolve them. Values are the reverse-tunnel loopback endpoint. Quoted
    // with shellQuote so a URL can't break out of the command string.
    const hookEnvPrefix = input.hookEnv
      ? Object.entries(input.hookEnv)
          .map(([k, v]) => `${k}=${shellQuote(v)} `)
          .join('')
      : '';
    return {
      cmd: `${cdPrefix}${autoModeEnv}${hookEnvPrefix}exec ${shellQuoteArgv(argv)}`,
      claudeSessionId
    };
  }

  title(profile: LaunchProfileId): string {
    switch (profile) {
      case 'claude':
        return 'claude';
      case 'claude-resume':
        return 'claude --resume';
      case 'claude-yolo':
        return 'claude --yolo';
      default:
        return 'claude';
    }
  }
}
