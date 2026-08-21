/**
 * LIVE parse-verify test for {@link CodexProvider} against the REAL `codex` CLI.
 *
 * ## What this is (and is NOT)
 *
 * `cursor-codex-providers.test.ts` asserts the EXACT argv strings our provider
 * emits — a byte-level snapshot of what we THINK codex wants. It cannot prove
 * the installed binary actually ACCEPTS and APPLIES those `-c` overrides; a
 * codex version bump that renames a config key would sail past it.
 *
 * THIS file is that missing leg. It builds argv from the real `CodexProvider`
 * and feeds it to the installed `codex` binary via its own inspection
 * subcommands (`codex debug prompt-input` / `codex debug models`), then asserts
 * the binary honored the injection. It is the codex twin of
 * `pi-backend.live.test.ts` — "does the real thing work," not "do our strings
 * match."
 *
 * Three of the four `-c` bridges are verified here with NO model call, NO
 * network, and NO safety-disarming flag:
 *   · GUIDANCE (`-c developer_instructions=…`) → surfaces as a `developer`
 *     message in `codex debug prompt-input` output.
 *   · MCP (`-c mcp_servers.zcc-inbox.url=…`) → parses without error.
 *   · AUTH (`-c model_providers.zcc.*` block) → parses without error via
 *     `codex debug models`.
 * The HOOKS bridge is intentionally NOT exercised: it requires codex's
 * `--dangerously-bypass-hook-trust` flag, which shouldn't run in an unattended
 * `vitest` process — its exact argv is covered by the string-level suite.
 *
 * ## The REAL-TURN block (the leg that actually spends a token)
 *
 * The parse-verify tests use a fake token and never touch the network. The
 * `describe.skipIf(!hasToken())` block goes further: it feeds a REAL key through
 * our `authInjection` argv and runs `codex exec`, asserting a real model turn
 * comes back. This proves the thing that matters — codex's own stored apikey
 * 401s on the Responses API, but OUR custom-provider injection makes the turn
 * succeed. Supply the token (never printed) one of two ways:
 *
 *   ZCC_LIVE_CODEX=1 ZCC_CODEX_KEY=sk-…  npm run test:codex:live   # → official endpoint
 *   ZCC_LIVE_CODEX=1 OPENAI_API_KEY=sk-… npm run test:codex:live   # (alias)
 *
 * ENDPOINT: token only ⇒ the official `https://api.openai.com/v1`. To target a
 * different OpenAI-compatible endpoint, ALSO export `ZCC_CODEX_BASE_URL` — it
 * flows through `HarnessAuthCredential.baseUrl` into the injected
 * `model_providers.zcc.base_url`, exactly as the app's harness-auth store does.
 *
 * ## Auto-skip contract (why `npm test` stays green)
 *
 * The whole file is `describe.skipIf(!liveEnabled())`. It runs ONLY when:
 *   ZCC_LIVE_CODEX=1  AND  a `codex` binary is resolvable on PATH.
 * With the env unset (CI, a plain `vitest run`) the file SKIPS, never fails. The
 * real-turn block additionally needs a token, so it self-skips without one.
 *
 *   ZCC_LIVE_CODEX=1 npx vitest run src/main/harness/__tests__/codex-provider.live.test.ts
 *
 * `ZCC_CODEX_BIN` overrides which binary is probed (defaults to `codex`).
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { CodexProvider } from '../codex/provider.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { HarnessAuthCredential } from '../../harness-auth.js';

const CODEX_BIN = process.env.ZCC_CODEX_BIN || 'codex';
const LIVE_TIMEOUT_MS = 30_000;

/** The live suite runs only when explicitly enabled AND codex is present. */
function liveEnabled(): boolean {
  return process.env.ZCC_LIVE_CODEX === '1';
}

/** A real bearer for the real-turn block. `ZCC_CODEX_KEY` preferred; the plain
 *  `OPENAI_API_KEY` is accepted as an alias. Empty ⇒ that block self-skips. */
function liveToken(): string {
  return process.env.ZCC_CODEX_KEY || process.env.OPENAI_API_KEY || '';
}

/** Optional endpoint override for the real turn — mirrors the app's
 *  harness-auth `baseUrl`. Absent ⇒ our injection defaults to the official host. */
function liveBaseUrl(): string {
  return process.env.ZCC_CODEX_BASE_URL || '';
}

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  codexBinary: CODEX_BIN,
  fontSize: 13,
  lastProjectId: null
};

/** Run `codex <args>` and return {ok, stdout, stderr}. Never rejects — a
 *  non-zero exit (parse rejection) resolves with ok:false so a test can assert
 *  on it.
 *
 *  We `spawn` (not `execFile`) and CLOSE stdin immediately: `codex exec` reads
 *  stdin for an appended `<stdin>` block and blocks on EOF, so leaving the pipe
 *  open (execFile's default) hangs the turn forever. Ending stdin is the
 *  headless equivalent of `< /dev/null`. */
function runCodex(
  args: string[],
  env?: Record<string, string>,
  timeoutMs = LIVE_TIMEOUT_MS
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(CODEX_BIN, args, {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, stdout, stderr });
    };
    const timer = setTimeout(() => {
      stderr += '\n[timed out]';
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      stderr += `\n${e.message}`;
      finish(false);
    });
    child.on('close', (code) => finish(code === 0));
    // Close stdin so `codex exec` doesn't wait for a piped `<stdin>` block.
    child.stdin.end();
  });
}

describe.skipIf(!liveEnabled())('CodexProvider — LIVE parse-verify against the real codex CLI', () => {
  const provider = new CodexProvider();

  it(
    'binary is resolvable and reports a version (env sanity)',
    async () => {
      const res = await runCodex(['--version']);
      expect(res.ok, `codex --version failed: ${res.stderr}`).toBe(true);
      expect(res.stdout).toMatch(/codex/i);
    },
    LIVE_TIMEOUT_MS
  );

  it(
    'GUIDANCE: our developer_instructions -c override surfaces as a developer message',
    async () => {
      const marker = 'ZCC-LIVE-GUIDANCE-MARKER-7f3a';
      const args = provider.guidanceArgs('codex', `${marker}: push findings to the inbox`);
      expect(args.length).toBeGreaterThan(0);

      const res = await runCodex(['debug', 'prompt-input', ...args]);
      expect(res.ok, `codex rejected our guidance override: ${res.stderr}`).toBe(true);

      // The prompt-input list is JSON; our text must appear in a developer-role
      // message (verified: codex renders developer_instructions verbatim there).
      const items = JSON.parse(res.stdout) as Array<{
        role?: string;
        content?: Array<{ text?: string }>;
      }>;
      const developerText = items
        .filter((m) => m.role === 'developer')
        .flatMap((m) => m.content ?? [])
        .map((c) => c.text ?? '')
        .join('\n');
      expect(developerText).toContain(marker);
    },
    LIVE_TIMEOUT_MS
  );

  it(
    'GUIDANCE: TOML-significant chars (quotes, newlines) round-trip through the real parser',
    async () => {
      const marker = 'ZCC-LIVE-ESCAPE "quoted"\nsecond-line\ttabbed';
      const args = provider.guidanceArgs('codex', marker);
      const res = await runCodex(['debug', 'prompt-input', ...args]);
      expect(res.ok, `codex rejected escaped guidance: ${res.stderr}`).toBe(true);

      const items = JSON.parse(res.stdout) as Array<{
        role?: string;
        content?: Array<{ text?: string }>;
      }>;
      const developerText = items
        .filter((m) => m.role === 'developer')
        .flatMap((m) => m.content ?? [])
        .map((c) => c.text ?? '')
        .join('\n');
      // The escaping must decode back to the ORIGINAL string, quotes/newlines intact.
      expect(developerText).toContain('ZCC-LIVE-ESCAPE "quoted"');
      expect(developerText).toContain('second-line');
      expect(developerText).toContain('tabbed');
    },
    LIVE_TIMEOUT_MS
  );

  it(
    'MCP: our mcp_servers.zcc-inbox.url -c override parses without error',
    async () => {
      const args = provider.mcpArgs('codex', 'http://127.0.0.1:59123/mcp/proj-x/sess-y');
      expect(args).toEqual([
        '-c',
        'mcp_servers.zcc-inbox.url="http://127.0.0.1:59123/mcp/proj-x/sess-y"'
      ]);
      // `debug prompt-input` loads the full config (incl. mcp_servers) — a bad
      // key or malformed TOML value would make it exit non-zero.
      const res = await runCodex(['debug', 'prompt-input', ...args]);
      expect(res.ok, `codex rejected our MCP override: ${res.stderr}`).toBe(true);
    },
    LIVE_TIMEOUT_MS
  );

  it(
    'AUTH: our custom-provider -c block parses via `codex debug models`',
    async () => {
      const cred: HarnessAuthCredential = {
        baseUrl: 'https://api.openai.com/v1',
        token: 'sk-zcc-live-probe-not-a-real-key'
      };
      const injection = provider.authInjection('codex', cred);
      expect(injection.args && injection.args.length).toBeGreaterThan(0);

      // `debug models` renders the catalog for the SELECTED model_provider — it
      // must accept our injected `model_providers.zcc.*` block + the env var it
      // names. We do NOT hit the network (no token is validated by `debug`).
      const res = await runCodex(['debug', 'models', ...(injection.args ?? [])], injection.env);
      expect(res.ok, `codex rejected our auth provider block: ${res.stderr}`).toBe(true);
    },
    LIVE_TIMEOUT_MS
  );

  it(
    'LAUNCH: resolveLaunch produces a codex invocation the binary understands (resume --help)',
    async () => {
      const resolved = provider.resolveLaunch('codex-resume', CONFIG, false);
      expect(resolved.command).toBe(CODEX_BIN);
      expect(resolved.args).toEqual(['resume', '--last']);
      // Prove `resume` is a real subcommand on this binary (not a flag) — asking
      // for its help is side-effect-free and exits 0 iff the subcommand exists.
      const res = await runCodex(['resume', '--help']);
      expect(res.ok, `codex resume --help failed: ${res.stderr}`).toBe(true);
    },
    LIVE_TIMEOUT_MS
  );
});

// A generous ceiling for a real model round-trip (cold start + reasoning).
const REAL_TURN_TIMEOUT_MS = 120_000;

describe.skipIf(!liveEnabled() || !liveToken())(
  'CodexProvider — REAL model turn through authInjection (spends a token)',
  () => {
    const provider = new CodexProvider();

    it(
      'a real turn completes when the key is routed through our custom-provider injection',
      async () => {
        // Build the SAME injection the app would from a stored harness-auth
        // credential: token only ⇒ official endpoint; + baseUrl ⇒ override.
        const cred: HarnessAuthCredential = { token: liveToken() };
        const baseUrl = liveBaseUrl();
        if (baseUrl) cred.baseUrl = baseUrl;

        const injection = provider.authInjection('codex', cred);
        expect(injection.args, 'expected auth args from a real token').toBeTruthy();
        expect(injection.env, 'expected the token env var').toBeTruthy();

        // Non-interactive turn. `exec` reads the prompt as a positional arg and
        // exits after one turn — no TTY, no session to clean up.
        const marker = 'ZCC-REALTURN-OK';
        const res = await runCodex(
          [
            'exec',
            '--skip-git-repo-check',
            ...(injection.args ?? []),
            `Reply with exactly this token and nothing else: ${marker}`
          ],
          injection.env,
          REAL_TURN_TIMEOUT_MS
        );

        expect(res.ok, `real codex turn failed: ${res.stderr}`).toBe(true);
        // The reply is echoed in exec's transcript output. A 401 (codex's own
        // apikey path) would have made ok:false above — this asserts the model
        // actually answered through OUR injected provider.
        expect(res.stdout).toContain(marker);
        // And it did NOT fall through to an auth error.
        expect(res.stdout + res.stderr).not.toMatch(/401 Unauthorized/);
      },
      REAL_TURN_TIMEOUT_MS
    );
  }
);
