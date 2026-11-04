import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CODEX_BYPASS_HOOK_TRUST_FLAG,
  codexEventLabel,
  codexHandlerHash,
  codexHookStateArgs,
  codexHookTrustEntries,
  judgeHookList,
  probeCodexHookTrust,
  resetCodexHookTrustProbeCache
} from '../hook-trust.js';
import { buildCodexHookSpecs, renderHookOverrides, type CodexHookEventSpec } from '../hook-trust-specs.js';

// Hashes below were read from `currentHash` of a live codex-cli 0.163.0
// `app-server` `hooks/list` for a handler whose command is the literal `x`.
const LIVE_X: Array<[string, string, string]> = [
  ['PreToolUse', '*', 'sha256:d45cad3a97f5da232114b0dc9ca05a3f9e009c837ab5cce24784763e811e223d'],
  ['PermissionRequest', '*', 'sha256:3de6392e06988c325a3e9ffd9d97ac74e6dee7881e8f9255f5c113364eca3b1b'],
  ['PostToolUse', '*', 'sha256:28e36e3220a6e921775fbb6ab4aa9f312e72273ff05b209ba81727e383c55e42'],
  ['SessionStart', '*', 'sha256:315a717ff392f0cf26eff046f3232c273fda114cd09e712000016737220e70d4'],
  ['UserPromptSubmit', '*', 'sha256:9f83d2c9d1b48d3700283cd1d70b9fc7ad739f3245049d933978e90187ee8a84'],
  ['SubagentStart', '*', 'sha256:45154a3ae9acb1707c3933700fb74a72a2164499ad5d5ce1bd28501fdc09b2bb'],
  ['SubagentStop', '*', 'sha256:e22c0ce0d7f12e9348d939b9acc9d9e3f4a3da8234d99eb20d56ff3c3a088482'],
  ['Stop', '*', 'sha256:6f14477468be127a92604ce05b51030268ccd6077fa7a807515589cfcfc7fd17'],
  ['Interrupt', '*', 'sha256:62ff3f22d466214a78ee1c476871d1929af10e332f3b32e22b856433017c72fe']
];

const ALL_URLS = {
  stop: 'http://127.0.0.1:1/hook/stop/p/s',
  notify: 'http://127.0.0.1:1/hook/notify/p/s',
  firstPrompt: 'http://127.0.0.1:1/hook/firstprompt/p/s',
  subagent: 'http://127.0.0.1:1/hook/subagent/p/s',
  nativeTool: 'http://127.0.0.1:1/hook/nativetool/p/s'
};

describe('codex hook trust hashing', () => {
  it.each(LIVE_X)('matches live codex for %s', (event, matcher, expected) => {
    expect(codexHandlerHash(event, matcher, 'x')).toBe(expected);
  });

  it('matches live codex for the multi-handler UserPromptSubmit group and Stop', () => {
    expect(codexHandlerHash('UserPromptSubmit', '*', 'a')).toBe('sha256:aed49e880e6f0f325bf01279b70ae96881385dd833b37dc1c840c5c6f0137787');
    expect(codexHandlerHash('UserPromptSubmit', '*', 'b')).toBe('sha256:69824ff972468b6c8c6e1d06f9d696624894059ac0255f2fa105438ab90b261d');
    expect(codexHandlerHash('Stop', '*', 'echo hi')).toBe('sha256:f2aa169c7a1cf9b7cc9b61ce5ecec0315e0f7d13ac35935b1aa74440f9a839f8');
  });

  it('omits the matcher from the identity of matcher-less events only', () => {
    expect(codexHandlerHash('Stop', '*', 'x')).toBe(codexHandlerHash('Stop', 'other', 'x'));
    expect(codexHandlerHash('PreToolUse', '*', 'x')).not.toBe(codexHandlerHash('PreToolUse', 'other', 'x'));
  });

  it('does not escape non-ASCII commands', () => {
    expect(codexHandlerHash('Stop', '*', 'é')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(codexHandlerHash('Stop', '*', 'é')).not.toBe(codexHandlerHash('Stop', '*', 'e'));
  });

  it('labels events in snake_case', () => {
    expect(codexEventLabel('PreToolUse')).toBe('pre_tool_use');
    expect(codexEventLabel('Stop')).toBe('stop');
    expect(codexEventLabel('SubagentStop')).toBe('subagent_stop');
  });
});

describe('hooks.state construction', () => {
  it('indexes groups per event and handlers per group', () => {
    const entries = codexHookTrustEntries(buildCodexHookSpecs(ALL_URLS));
    const keys = entries.map((e) => e.key);
    expect(keys).toContain('/<session-flags>/config.toml:pre_tool_use:0:0');
    expect(keys).toContain('/<session-flags>/config.toml:pre_tool_use:1:0');
    expect(keys).toContain('/<session-flags>/config.toml:user_prompt_submit:0:0');
    expect(keys).toContain('/<session-flags>/config.toml:user_prompt_submit:0:1');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('emits one -c override trusting only generated handlers', () => {
    const specs = buildCodexHookSpecs({ stop: ALL_URLS.stop });
    const args = codexHookStateArgs(specs);
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('-c');
    expect(args[1]).toBe(
      `hooks.state={"/<session-flags>/config.toml:stop:0:0"={trusted_hash="${codexHookTrustEntries(specs)[0]!.hash}"}}`
    );
  });

  it('emits nothing without specs', () => {
    expect(codexHookStateArgs([])).toEqual([]);
    expect(buildCodexHookSpecs({})).toEqual([]);
  });

  it('renders the same -c overrides the launcher always shipped', () => {
    const specs = buildCodexHookSpecs({ stop: ALL_URLS.stop });
    expect(renderHookOverrides(specs)).toEqual([
      '-c',
      `hooks.Stop=[{matcher="*",hooks=[{type="command",command="cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST \\"${ALL_URLS.stop}\\""}]}]`
    ]);
  });
});

describe('judgeHookList', () => {
  const specs = buildCodexHookSpecs({ stop: ALL_URLS.stop });
  const [entry] = codexHookTrustEntries(specs);
  const listed = (over: object = {}) => ({
    data: [{ hooks: [
      { key: '/etc/codex/requirements.toml:stop:0:0', source: 'system', trustStatus: 'managed', currentHash: 'sha256:0' },
      { key: entry!.key, source: 'sessionFlags', trustStatus: 'trusted', currentHash: entry!.hash, ...over }
    ] }]
  });

  it('accepts matching trusted hooks and ignores other layers', () => {
    expect(judgeHookList(listed(), specs)).toEqual({ mode: 'scoped' });
  });
  it('rejects a hash mismatch', () => {
    expect(judgeHookList(listed({ currentHash: 'sha256:bad' }), specs).reason).toMatch(/hash mismatch/);
  });
  it('rejects a hook codex does not report trusted', () => {
    expect(judgeHookList(listed({ trustStatus: 'modified' }), specs).reason).toMatch(/modified/);
  });
  it('rejects a missing key and a wrong count', () => {
    expect(judgeHookList(listed({ key: 'other' }), specs).reason).toMatch(/not listed/);
    expect(judgeHookList({ data: [{ hooks: [] }] }, specs).reason).toMatch(/listed 0/);
    expect(judgeHookList(undefined, specs).mode).toBe('bypass');
  });
});

describe('probeCodexHookTrust with a fake app-server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-fake-codex-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => resetCodexHookTrustProbeCache());

  const specs: CodexHookEventSpec[] = buildCodexHookSpecs({ stop: ALL_URLS.stop, notify: ALL_URLS.notify });

  /** A fake `codex app-server` speaking the JSON-RPC subset the probe uses. */
  function fake(name: string, behavior: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!/usr/bin/env node
const mode = ${JSON.stringify(behavior)};
const entries = ${JSON.stringify(codexHookTrustEntries(specs))};
if (mode === 'exit') process.exit(3);
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (mode === 'hang') continue;
    const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\\n');
    if (m.id === 1) { process.stdout.write('not json\\n'); send({ id: 1, result: {} }); }
    if (m.id === 2) {
      if (mode === 'error') return send({ id: 2, error: { code: -32601, message: 'no' } });
      if (mode === 'huge') return process.stdout.write('x'.repeat(9 * 1024 * 1024));
      const hooks = entries.map((e) => ({ key: e.key, source: 'sessionFlags',
        currentHash: mode === 'mismatch' ? 'sha256:bad' : e.hash,
        trustStatus: mode === 'untrusted' ? 'untrusted' : 'trusted' }));
      send({ id: 2, result: { data: [{ hooks }] } });
    }
  }
});
`);
    chmodSync(path, 0o755);
    return path;
  }

  it('verifies a conformant binary and caches the verdict', async () => {
    const bin = fake('ok', 'ok');
    expect(await probeCodexHookTrust(bin, 'k-ok', { specs })).toEqual({ mode: 'scoped' });
    // Cached: a different (broken) binary under the same key is not re-run.
    expect(await probeCodexHookTrust(fake('ok-broken', 'exit'), 'k-ok', { specs })).toEqual({ mode: 'scoped' });
  });

  it('falls back on a hash mismatch and caches that definitive verdict', async () => {
    const result = await probeCodexHookTrust(fake('mm', 'mismatch'), 'k-mm', { specs });
    expect(result.mode).toBe('bypass');
    expect(result.reason).toMatch(/hash mismatch/);
    expect(await probeCodexHookTrust(fake('mm2', 'ok'), 'k-mm', { specs })).toEqual(result);
  });

  it('falls back when codex reports hooks untrusted', async () => {
    expect((await probeCodexHookTrust(fake('un', 'untrusted'), 'k-un', { specs })).mode).toBe('bypass');
  });

  it('falls back when hooks/list is unsupported', async () => {
    const result = await probeCodexHookTrust(fake('er', 'error'), 'k-er', { specs });
    expect(result.reason).toMatch(/unsupported/);
  });

  it('falls back on exit, missing binary and timeout without caching them', async () => {
    expect((await probeCodexHookTrust(fake('ex', 'exit'), 'k-t', { specs })).reason).toMatch(/exited/);
    expect((await probeCodexHookTrust(join(dir, 'missing'), 'k-t', { specs })).reason).toMatch(/spawn failed|exited/);
    expect((await probeCodexHookTrust(fake('hg', 'hang'), 'k-t', { specs, timeoutMs: 400 })).reason).toMatch(/timed out/);
    // Transient failures are retried: the same key now verifies.
    expect(await probeCodexHookTrust(fake('ok2', 'ok'), 'k-t', { specs })).toEqual({ mode: 'scoped' });
  });

  it('falls back when output exceeds the size cap', async () => {
    expect((await probeCodexHookTrust(fake('hu', 'huge'), 'k-hu', { specs })).reason).toMatch(/size cap/);
  });

  it('serializes concurrent probes', async () => {
    const bin = fake('conc', 'ok');
    const results = await Promise.all([
      probeCodexHookTrust(bin, 'k-c1', { specs }),
      probeCodexHookTrust(bin, 'k-c2', { specs })
    ]);
    expect(results.map((r) => r.mode)).toEqual(['scoped', 'scoped']);
  });
});

const codexPresent = spawnSync('codex', ['--version'], { windowsHide: true }).status === 0;

describe.skipIf(!codexPresent)('live codex conformance', () => {
  it('codex reports our computed hashes as trusted for every shape Zana emits', async () => {
    resetCodexHookTrustProbeCache();
    const result = await probeCodexHookTrust('codex', 'live-codex');
    expect(result).toEqual({ mode: 'scoped' });
  }, 30_000);
});

it('exports the degraded fallback flag name', () => {
  expect(CODEX_BYPASS_HOOK_TRUST_FLAG).toBe('--dangerously-bypass-hook-trust');
});
