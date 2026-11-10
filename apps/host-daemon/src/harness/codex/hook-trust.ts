/**
 * Scoped trust for Zana's own Codex hooks.
 *
 * A `-c hooks.<Event>=…` hook lands in codex's session-flags config layer and is
 * UNTRUSTED until its content hash has a matching `trusted_hash` entry in
 * `hooks.state`. `--dangerously-bypass-hook-trust` skips that check for EVERY
 * hook (user and project hooks included). Instead we supply `hooks.state` for
 * exactly the handlers Zana generates, via one more `-c` override, so user and
 * project hooks keep their normal trust state and still go through the prompt.
 *
 * The hash is computed by codex and is an implementation detail that has been
 * refactored between releases. A drifted hash would leave our hooks `modified`
 * (not run), failing the native-tool veto OPEN. So scoped mode is enabled only
 * after {@link probeCodexHookTrust} proves, against the actual binary, that
 * codex's `currentHash` equals ours for every hook shape Zana emits and that
 * codex then reports them `trusted`. Anything else keeps the global bypass flag
 * (degraded). Remote launches cannot be probed locally and always use the flag.
 */

import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTreeWithoutFollowingLinks } from '@zana-ai/zcc-agent-process-utils';
import { buildCodexHookSpecs, renderHookOverrides, type CodexHookEventSpec } from './hook-trust-specs.js';

/** The global flag used when scoped trust is unavailable. */
export const CODEX_BYPASS_HOOK_TRUST_FLAG = '--dangerously-bypass-hook-trust';

/** Default per-handler timeout codex records in the hash identity (seconds). */
const HANDLER_TIMEOUT_SEC = 600;
/** Events whose default handler timeout differs (verified live against codex). */
const EVENT_TIMEOUT_SEC: Readonly<Record<string, number>> = { interrupt: 1 };
/** Events whose matcher is not part of codex's hook identity. */
const MATCHERLESS_EVENTS = new Set(['stop', 'user_prompt_submit', 'interrupt']);
const SESSION_FLAGS_KEY_PREFIX = '/<session-flags>/config.toml';

/** `PreToolUse` -> `pre_tool_use` (codex's event label in hook keys and hashes). */
export function codexEventLabel(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Recursively sorted-key compact JSON, non-ASCII left unescaped. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Codex's content hash for one command handler of one matcher group. */
export function codexHandlerHash(event: string, matcher: string, command: string): string {
  const label = codexEventLabel(event);
  const identity = {
    event_name: label,
    matcher: MATCHERLESS_EVENTS.has(label) ? undefined : matcher,
    hooks: [{ type: 'command', command, timeout: EVENT_TIMEOUT_SEC[label] ?? HANDLER_TIMEOUT_SEC, async: false }]
  };
  return `sha256:${createHash('sha256').update(canonicalJson(identity), 'utf8').digest('hex')}`;
}

/** `hooks.state` entries (key -> hash) for every handler in the specs. */
export function codexHookTrustEntries(specs: readonly CodexHookEventSpec[]): Array<{ key: string; hash: string }> {
  return specs.flatMap((spec) =>
    spec.groups.flatMap((group, groupIdx) =>
      group.commands.map((command, handlerIdx) => ({
        key: `${SESSION_FLAGS_KEY_PREFIX}:${codexEventLabel(spec.event)}:${groupIdx}:${handlerIdx}`,
        hash: codexHandlerHash(spec.event, group.matcher, command)
      }))
    )
  );
}

/** The single `-c hooks.state={…}` override trusting exactly Zana's handlers. */
export function codexHookStateArgs(specs: readonly CodexHookEventSpec[]): string[] {
  const entries = codexHookTrustEntries(specs);
  if (entries.length === 0) return [];
  const table = entries.map(({ key, hash }) => `"${key}"={trusted_hash="${hash}"}`).join(',');
  return ['-c', `hooks.state={${table}}`];
}

export type CodexHookTrustMode = 'scoped' | 'bypass';

export interface CodexHookTrustProbeResult {
  readonly mode: CodexHookTrustMode;
  /** Why the mode is `bypass`; undefined when scoped. */
  readonly reason?: string;
}

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_POLL_MS = 40;
/** Cap on captured stdout; managed-hook payloads on enterprise hosts are large. */
const PROBE_MAX_BYTES = 8 * 1024 * 1024;

/** Sample URLs enabling every callback so the fixture covers every emitted shape. */
function fixtureSpecs(): CodexHookEventSpec[] {
  const base = 'http://127.0.0.1:1/hook';
  return buildCodexHookSpecs({
    stop: `${base}/stop/p/s`,
    notify: `${base}/notify/p/s`,
    firstPrompt: `${base}/firstprompt/p/s`,
    subagent: `${base}/subagent/p/s`,
    nativeTool: `${base}/nativetool/p/s`
  } as Parameters<typeof buildCodexHookSpecs>[0]);
}

interface ListedHook {
  key?: unknown;
  currentHash?: unknown;
  trustStatus?: unknown;
  source?: unknown;
}

/** Pure verdict over a `hooks/list` result. Exported for tests. */
export function judgeHookList(result: unknown, specs: readonly CodexHookEventSpec[]): CodexHookTrustProbeResult {
  const hooks = ((result as { data?: Array<{ hooks?: ListedHook[] }> } | undefined)?.data ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .filter((hook) => hook.source === 'sessionFlags');
  const expected = codexHookTrustEntries(specs);
  if (hooks.length !== expected.length) {
    return { mode: 'bypass', reason: `codex listed ${hooks.length} session-flags hooks, expected ${expected.length}` };
  }
  const byKey = new Map(hooks.map((hook) => [hook.key, hook]));
  for (const { key, hash } of expected) {
    const listed = byKey.get(key);
    if (!listed) return { mode: 'bypass', reason: `hook ${key} not listed by codex` };
    if (listed.currentHash !== hash) return { mode: 'bypass', reason: `hash mismatch for ${key}` };
    if (listed.trustStatus !== 'trusted') {
      return { mode: 'bypass', reason: `hook ${key} is ${String(listed.trustStatus)} with state supplied` };
    }
  }
  return { mode: 'scoped' };
}

const rpc = (message: object) => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`;

/** One run of the app-server `hooks/list` exchange. Never rejects. */
async function runProbe(binary: string, specs: readonly CodexHookEventSpec[], timeoutMs: number): Promise<CodexHookTrustProbeResult & { transient?: boolean }> {
  const scratch = mkdtempSync(join(tmpdir(), 'zcc-codex-trust-'));
  const home = join(scratch, 'home');
  const cwd = join(scratch, 'cwd');
  const outPath = join(scratch, 'out.jsonl');
  let outFd: number | undefined;
  let child: ChildProcess | undefined;
  try {
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    // stdout goes to a 0600 temp file rather than a pipe: hooks/list output is
    // large and piped child stdout is not trusted to arrive complete.
    outFd = openSync(outPath, 'w', 0o600);
    const args = ['app-server', ...renderHookOverrides(specs), ...codexHookStateArgs(specs)];
    child = spawn(binary, args, {
      stdio: ['pipe', outFd, 'ignore'],
      windowsHide: true,
      cwd,
      env: { ...process.env, CODEX_HOME: home }
    });
    const proc = child;
    let spawnError: string | undefined;
    let exited = false;
    proc.once('error', (error) => { spawnError = error.message; });
    proc.once('exit', () => { exited = true; });
    proc.stdin?.on('error', () => undefined);
    proc.stdin?.write(rpc({ id: 1, method: 'initialize', params: { clientInfo: { name: 'zana-command-center', version: '1.0' }, capabilities: {} } }));

    let sentList = false;
    let consumed = 0;
    let pending = '';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, PROBE_POLL_MS));
      if (spawnError) return { mode: 'bypass', reason: `spawn failed: ${spawnError}`, transient: true };
      const size = statSync(outPath).size;
      if (size > PROBE_MAX_BYTES) return { mode: 'bypass', reason: 'probe output exceeded size cap' };
      if (size > consumed) {
        const text = readFileSync(outPath).subarray(consumed, size).toString('utf8');
        consumed = size;
        pending += text;
        for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          let message: { id?: number; result?: unknown; error?: unknown };
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.id === 1 && !sentList) {
            sentList = true;
            proc.stdin?.write(rpc({ method: 'initialized' }));
            proc.stdin?.write(rpc({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } }));
          } else if (message.id === 2) {
            if (message.error) return { mode: 'bypass', reason: 'hooks/list returned an error (unsupported binary)' };
            return judgeHookList(message.result, specs);
          }
        }
      }
      if (exited) return { mode: 'bypass', reason: 'codex app-server exited before answering', transient: true };
    }
    return { mode: 'bypass', reason: 'probe timed out', transient: true };
  } catch (error) {
    return { mode: 'bypass', reason: `probe failed: ${error instanceof Error ? error.message : String(error)}`, transient: true };
  } finally {
    try { child?.kill(); } catch { /* already gone */ }
    if (outFd !== undefined) { try { closeSync(outFd); } catch { /* closed */ } }
    try { removeTreeWithoutFollowingLinks(scratch); } catch { /* best effort */ }
  }
}

const verdicts = new Map<string, CodexHookTrustProbeResult>();
let chain: Promise<unknown> = Promise.resolve();

/** Test hook: forget cached verdicts. */
export function resetCodexHookTrustProbeCache(): void {
  verdicts.clear();
}

/**
 * Probe one codex binary once per `cacheKey` (path + version). Probes run one at
 * a time. Verified and definitive-mismatch verdicts are cached; spawn failures,
 * timeouts and exits are transient and retried on the next call.
 */
export function probeCodexHookTrust(
  binary: string,
  cacheKey: string = binary,
  options: { specs?: readonly CodexHookEventSpec[]; timeoutMs?: number } = {}
): Promise<CodexHookTrustProbeResult> {
  const specs = options.specs ?? fixtureSpecs();
  const cached = verdicts.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const run = chain.then(async () => {
    const again = verdicts.get(cacheKey);
    if (again) return again;
    const { transient, ...result } = await runProbe(binary, specs, options.timeoutMs ?? PROBE_TIMEOUT_MS);
    if (!transient) verdicts.set(cacheKey, result);
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}
