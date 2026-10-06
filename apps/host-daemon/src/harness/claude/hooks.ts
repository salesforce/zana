import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { ProviderCapabilities } from '@zana-ai/zcc-domain/launch-provider';
import { randomUUID } from 'node:crypto';

export type NativeToolHookState = 'announced' | 'awaiting-decision' | 'allowed' | 'denied' | 'executing' | 'succeeded' | 'failed' | 'cancelled';

export interface NativeToolHookEvent {
  invocationId: string;
  state: NativeToolHookState;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: number;
}

export interface NativeToolHookBridge {
  enabled?: boolean;
  before?: (event: NativeToolHookEvent) => boolean | Promise<boolean>;
  after?: (event: NativeToolHookEvent) => void | Promise<void>;
  emit?: (event: NativeToolHookEvent) => void | Promise<void>;
}

export function redactToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const seen = new WeakSet<object>();
  let visited = 0;
  const redact = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return value.length > 16_384 ? '[REDACTED]' : value;
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value) || depth > 20 || ++visited > 1_000) return '[REDACTED]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => redact(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 1_000)) {
      out[key] = /token|secret|password|key|credential/i.test(key) ? '[REDACTED]' : redact(item, depth + 1);
    }
    return out;
  };
  return redact(input, 0) as Record<string, unknown>;
}

/** Execute a capability-gated native tool with one ordered, terminal lifecycle. */
export async function executeNativeToolHook<T>(
  toolName: string,
  input: unknown,
  execute: () => Promise<T>,
  bridge: NativeToolHookBridge = {}
): Promise<T> {
  if (!bridge.enabled) return execute();
  const invocationId = randomUUID();
  const payload = redactToolInput(input);
  const emit = async (state: NativeToolHookState) => {
    await bridge.emit?.({ invocationId, state, toolName, input: payload, timestamp: Date.now() });
  };
  await emit('announced');
  await emit('awaiting-decision');
  let allowed = true;
  try { allowed = bridge.before ? await bridge.before({ invocationId, state: 'awaiting-decision', toolName, input: payload, timestamp: Date.now() }) : true; }
  catch { allowed = false; }
  if (!allowed) { await emit('denied'); throw new Error(`native tool denied: ${toolName}`); }
  await emit('allowed');
  await emit('executing');
  try {
    const result = await execute();
    await emit('succeeded');
    await bridge.after?.({ invocationId, state: 'succeeded', toolName, input: payload, timestamp: Date.now() });
    return result;
  } catch (error) {
    const state: NativeToolHookState = error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed';
    await emit(state);
    await bridge.after?.({ invocationId, state, toolName, input: payload, timestamp: Date.now() });
    throw error;
  }
}

export interface ClaudeLifecycleCallbacks {
  readonly stop?: string;
  readonly notify?: string;
  readonly firstPrompt?: string;
  readonly subagent?: string;
  readonly toolActivity?: string;
  readonly overseer?: string;
  readonly contentScreen?: string;
  readonly nativeTool?: string;
}

export interface ClaudeLifecycleContribution {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface ClaudeHookSettings {
  readonly stop: boolean;
  readonly notify: boolean;
  readonly firstPrompt?: boolean;
  readonly question?: boolean;
  readonly subagents?: boolean;
  readonly forwardSubagentPayload?: boolean;
  readonly toolActivity?: boolean;
  readonly overseer?: boolean;
  readonly overseerCurlMaxSec?: number;
  readonly contentScreen?: boolean;
  readonly contentScreenCurlMaxSec?: number;
  readonly nativeTool?: boolean;
  readonly autoMode?: Record<string, unknown>;
}

/**
 * Render Claude Code's inline `--settings` payload without changing hook order.
 * The callback URLs remain host-minted; this module owns only Claude's encoding.
 */
export function buildClaudeHookSettings(opts: ClaudeHookSettings): string {
  const hooks: Record<string, unknown[]> = {};

  if (opts.stop) {
    const stopCmd =
      'ZCC_IN=$(cat); ' +
      'case "$ZCC_IN" in *\'"stop_hook_active":true\'*) exit 0;; esac; ' +
      'if [ -n "$ZCC_HOOK_URL" ]; then ' +
      'curl -s -m 5 -X POST "$ZCC_HOOK_URL" >/dev/null 2>&1 || true; ' +
      'fi; exit 0';
    hooks.Stop = [{ matcher: '', hooks: [{ type: 'command', command: stopCmd }] }];
  }

  if (opts.notify) {
    const postBlocked =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/blocked" >/dev/null 2>&1 || true; exit 0';
    const postUnblocked =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/unblocked" >/dev/null 2>&1 || true; exit 0';
    const notifyBlocked =
      'ZCC_IN=$(cat); ' +
      'case "$ZCC_IN" in ' +
      '*\'"permission_prompt"\'*|*\'"elicitation_dialog"\'*) ' +
      '[ -n "$ZCC_NOTIFY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/blocked" >/dev/null 2>&1 || true;; ' +
      'esac; exit 0';
    hooks.Notification = [{ matcher: '', hooks: [{ type: 'command', command: notifyBlocked }] }];
    hooks.PreToolUse = [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: postBlocked }] }];
    hooks.PostToolUse = [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: postUnblocked }] }];
    hooks.UserPromptSubmit = [{ matcher: '', hooks: [{ type: 'command', command: postUnblocked }] }];
    if (!opts.stop) {
      const stopUnblock = { type: 'command', command: postUnblocked };
      if (Array.isArray(hooks.Stop)) (hooks.Stop[0] as { hooks: unknown[] }).hooks.push(stopUnblock);
      else hooks.Stop = [{ matcher: '', hooks: [stopUnblock] }];
    }
  }

  if (opts.firstPrompt) {
    const postFirstPrompt =
      'ZCC_IN=$(cat); ' +
      '[ -n "$ZCC_FIRSTPROMPT_URL" ] && ' +
      'printf "%s" "$ZCC_IN" | ' +
      'curl -s -m 5 -X POST --data-binary @- "$ZCC_FIRSTPROMPT_URL" >/dev/null 2>&1 || true; exit 0';
    const firstPromptHook = { type: 'command', command: postFirstPrompt };
    if (Array.isArray(hooks.UserPromptSubmit)) {
      (hooks.UserPromptSubmit as unknown[]).push({ matcher: '', hooks: [firstPromptHook] });
    } else {
      hooks.UserPromptSubmit = [{ matcher: '', hooks: [firstPromptHook] }];
    }
  }

  if (opts.question) {
    const postQuestion =
      'ZCC_IN=$(cat); ' +
      '[ -n "$ZCC_QUESTION_URL" ] && ' +
      'printf "%s" "$ZCC_IN" | ' +
      'curl -s -m 5 -X POST --data-binary @- "$ZCC_QUESTION_URL" >/dev/null 2>&1 || true; exit 0';
    const questionHook = { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: postQuestion }] };
    if (Array.isArray(hooks.PreToolUse)) hooks.PreToolUse.push(questionHook);
    else hooks.PreToolUse = [questionHook];
  }

  if (opts.subagents) {
    const postStart = opts.forwardSubagentPayload
      ? 'ZCC_IN=$(cat); ' +
        '[ -n "$ZCC_SUBAGENT_URL" ] && ' +
        'printf "%s" "$ZCC_IN" | ' +
        'curl -s -m 5 -X POST --data-binary @- "$ZCC_SUBAGENT_URL/start" >/dev/null 2>&1 || true; exit 0'
      : 'cat >/dev/null 2>&1; ' +
        '[ -n "$ZCC_SUBAGENT_URL" ] && ' +
        'curl -s -m 5 -X POST "$ZCC_SUBAGENT_URL/start" >/dev/null 2>&1 || true; exit 0';
    const postStop =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_SUBAGENT_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_SUBAGENT_URL/stop" >/dev/null 2>&1 || true; exit 0';
    const taskStart = { matcher: 'Task', hooks: [{ type: 'command', command: postStart }] };
    if (Array.isArray(hooks.PreToolUse)) hooks.PreToolUse.push(taskStart);
    else hooks.PreToolUse = [taskStart];
    hooks.SubagentStop = [{ matcher: '', hooks: [{ type: 'command', command: postStop }] }];
  }

  if (opts.toolActivity) {
    const postToolStart =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_TOOLACTIVITY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_TOOLACTIVITY_URL/start" >/dev/null 2>&1 || true; exit 0';
    const postToolStop =
      'cat >/dev/null 2>&1; ' +
      '[ -n "$ZCC_TOOLACTIVITY_URL" ] && ' +
      'curl -s -m 5 -X POST "$ZCC_TOOLACTIVITY_URL/stop" >/dev/null 2>&1 || true; exit 0';
    const toolStartHook = { matcher: '', hooks: [{ type: 'command', command: postToolStart }] };
    const toolStopHook = { matcher: '', hooks: [{ type: 'command', command: postToolStop }] };
    if (Array.isArray(hooks.PreToolUse)) hooks.PreToolUse.push(toolStartHook);
    else hooks.PreToolUse = [toolStartHook];
    if (Array.isArray(hooks.PostToolUse)) hooks.PostToolUse.push(toolStopHook);
    else hooks.PostToolUse = [toolStopHook];
    const postToolClear = {
      type: 'command',
      command:
        'cat >/dev/null 2>&1; ' +
        '[ -n "$ZCC_TOOLACTIVITY_URL" ] && ' +
        'curl -s -m 5 -X POST "$ZCC_TOOLACTIVITY_URL/clear" >/dev/null 2>&1 || true; exit 0'
    };
    if (Array.isArray(hooks.Stop)) (hooks.Stop[0] as { hooks: unknown[] }).hooks.push(postToolClear);
    else hooks.Stop = [{ matcher: '', hooks: [postToolClear] }];
  }

  if (opts.overseer) {
    const curlMaxSec = opts.overseerCurlMaxSec ?? 10;
    const overseerCmd =
      'ZCC_IN=$(cat); ' +
      'if [ -n "$ZCC_OVERSEER_URL" ]; then ' +
      'printf "%s" "$ZCC_IN" | ' +
      `curl -s -m ${curlMaxSec} -X POST --data-binary @- "$ZCC_OVERSEER_URL" 2>/dev/null || true; ` +
      'fi; exit 0';
    const overseerHook = { matcher: '', hooks: [{ type: 'command', command: overseerCmd }] };
    if (Array.isArray(hooks.PreToolUse)) hooks.PreToolUse.push(overseerHook);
    else hooks.PreToolUse = [overseerHook];
  }

  if (opts.contentScreen) {
    const contentScreenCurlMaxSec = opts.contentScreenCurlMaxSec ?? 10;
    const contentScreenCmd =
      'ZCC_IN=$(cat); ' +
      'if [ -n "$ZCC_CONTENTSCREEN_URL" ]; then ' +
      'printf "%s" "$ZCC_IN" | ' +
      `curl -s -m ${contentScreenCurlMaxSec} -X POST --data-binary @- "$ZCC_CONTENTSCREEN_URL" 2>/dev/null || true; ` +
      'fi; exit 0';
    const contentScreenHook = { matcher: '', hooks: [{ type: 'command', command: contentScreenCmd }] };
    if (Array.isArray(hooks.PostToolUse)) hooks.PostToolUse.push(contentScreenHook);
    else hooks.PostToolUse = [contentScreenHook];
  }

  if (opts.nativeTool) {
    // OBL-004: this must actually BLOCK, so unlike overseer/contentScreen (which
    // discard the curl reply and always exit 0) we relay the policy route's
    // `hookSpecificOutput.permissionDecision` JSON verbatim to stdout — Claude's
    // own PreToolUse contract. FAIL CLOSED: an empty/missing reply (unset env,
    // timeout, transport failure) synthesizes an explicit `deny` ourselves,
    // matching the Codex-side fix (see codex/provider.ts hookArgs).
    const nativeToolCmd =
      'ZCC_IN=$(cat); ' +
      'OUT=""; ' +
      '[ -n "$ZCC_NATIVETOOL_URL" ] && ' +
      'OUT=$(printf "%s" "$ZCC_IN" | curl -s -m 5 -X POST --data-binary @- "$ZCC_NATIVETOOL_URL" 2>/dev/null); ' +
      'if [ -z "$OUT" ]; then ' +
      'echo \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"native tool policy unreachable"}}\'; ' +
      'else printf "%s" "$OUT"; fi; exit 0';
    const nativeToolHook = { matcher: '', hooks: [{ type: 'command', command: nativeToolCmd }] };
    if (Array.isArray(hooks.PreToolUse)) hooks.PreToolUse.push(nativeToolHook);
    else hooks.PreToolUse = [nativeToolHook];
  }

  const settings: Record<string, unknown> = { hooks };
  if (opts.autoMode) settings.autoMode = opts.autoMode;
  return JSON.stringify(settings);
}

export function buildClaudeAutoModeSettings(config: AppConfig): Record<string, unknown> | undefined {
  const block: Record<string, unknown> = {};
  const withDefaults = (arr?: string[]) => arr && arr.length > 0 ? ['$defaults', ...arr] : undefined;
  const env = withDefaults(config.autoModeEnvironment);
  if (env) block.environment = env;
  const allow = withDefaults(config.autoModeAllow);
  if (allow) block.allow = allow;
  const soft = withDefaults(config.autoModeSoftDeny);
  if (soft) block.soft_deny = soft;
  const hard = withDefaults(config.autoModeHardDeny);
  if (hard) block.hard_deny = hard;
  if (config.autoModeClassifyAllShell === true) block.classifyAllShell = true;
  return Object.keys(block).length > 0 ? block : undefined;
}

/**
 * Claude owns hook eligibility and its native settings/env encoding. The host only
 * mints callback endpoints and applies this contribution in its stable argv/env slots.
 */
export function renderClaudeLifecycle(input: {
  readonly profile: LaunchProfileId;
  readonly caps: ProviderCapabilities;
  readonly config: AppConfig;
  readonly scheduled: boolean;
  readonly headless: boolean;
  readonly autoModeActive: boolean;
  readonly callbacks: ClaudeLifecycleCallbacks;
  readonly scope: 'local' | 'remote';
}): ClaudeLifecycleContribution {
  if (!input.caps.injectsClaudeMcpConfig) return { args: [], env: {} };

  const remote = input.scope === 'remote';
  const overseerMode = input.config.overseerMode ?? 'off';
  const contentScreenMode = input.config.contentScreenMode ?? 'off';
  const stop = !remote && !!input.callbacks.stop;
  const notify = !!input.callbacks.notify;
  const firstPrompt = !!input.callbacks.firstPrompt && !input.scheduled;
  const subagents = !!input.callbacks.subagent;
  const toolActivity = !remote && !!input.callbacks.toolActivity;
  const overseer = !remote &&
    !!input.callbacks.overseer &&
    overseerMode !== 'off' &&
    !input.autoModeActive &&
    !input.scheduled &&
    !input.headless &&
    input.caps.acceptsPermissionMode;
  const contentScreen = !remote && !!input.callbacks.contentScreen && contentScreenMode !== 'off';
  // Unlike overseer/contentScreen/toolActivity, native-tool policy is a
  // security-blocking gate (OBL-004) rather than an advisory ping — it stays
  // live for both local and remote launches, same as notify/subagent.
  const nativeTool = !!input.callbacks.nativeTool;
  const autoMode = !remote && input.autoModeActive
    ? buildClaudeAutoModeSettings(input.config)
    : undefined;
  const wantsAnyHook = stop || notify || firstPrompt || subagents || toolActivity || overseer || contentScreen || nativeTool;
  const settings = wantsAnyHook || autoMode
    ? buildClaudeHookSettings({
    stop,
    notify,
    firstPrompt,
    subagents,
    forwardSubagentPayload: true,
    toolActivity,
    overseer,
    overseerCurlMaxSec:
      overseerMode !== 'off' && input.config.overseerDeepTierEnabled === true ? 28 : 10,
    contentScreen,
    nativeTool,
    autoMode
      })
    : undefined;
  const env: Record<string, string> = {};
  if (input.autoModeActive) env.CLAUDE_CODE_ENABLE_AUTO_MODE = '1';
  if (remote) {
    if (input.callbacks.notify) env.ZCC_NOTIFY_URL = input.callbacks.notify;
    if (subagents && input.callbacks.subagent) env.ZCC_SUBAGENT_URL = input.callbacks.subagent;
    if (firstPrompt && input.callbacks.firstPrompt) env.ZCC_FIRSTPROMPT_URL = input.callbacks.firstPrompt;
  } else {
    if (input.callbacks.stop) env.ZCC_HOOK_URL = input.callbacks.stop;
    if (input.callbacks.notify) env.ZCC_NOTIFY_URL = input.callbacks.notify;
    if (firstPrompt && input.callbacks.firstPrompt) env.ZCC_FIRSTPROMPT_URL = input.callbacks.firstPrompt;
    if (subagents && input.callbacks.subagent) env.ZCC_SUBAGENT_URL = input.callbacks.subagent;
  }
  if (toolActivity && input.callbacks.toolActivity) env.ZCC_TOOLACTIVITY_URL = input.callbacks.toolActivity;
  if (overseer && input.callbacks.overseer) env.ZCC_OVERSEER_URL = input.callbacks.overseer;
  if (contentScreen && input.callbacks.contentScreen) env.ZCC_CONTENTSCREEN_URL = input.callbacks.contentScreen;
  if (nativeTool && input.callbacks.nativeTool) env.ZCC_NATIVETOOL_URL = input.callbacks.nativeTool;
  return { args: settings ? ['--settings', settings] : [], env };
}
