/**
 * "AI testing" — drive a REAL model agent and verify the OUTCOME via the inbox,
 * the way you'd check an agent's work in the app rather than asserting on bytes.
 *
 * This is a different testing mode from the deterministic-stub specs
 * (harness-lifecycle / agent-launch-ui use a fake binary so there's no model in
 * the loop). Here a real `claude-yolo` agent is launched with an instruction to
 * push a unique marker to the user's inbox via its `inbox_push` MCP tool, then we
 * poll `inbox:history` until that marker shows up. If it does, the whole live
 * path worked end-to-end: launch → argv prompt → agent runs → MCP `.mcp.json`
 * (ZCC_MCP_URL) → inbox_push → InboxStore → the entry the UI would render.
 *
 * WHY env-gated (skipped by default): it needs a real, authenticated `claude`
 * binary + network + tokens, so it can't run in ordinary CI (same rationale as
 * the marketplace network specs). Opt in explicitly:
 *
 *   ZCC_AI_E2E=1 npx playwright test e2e/ai-inbox-roundtrip.spec.ts
 *
 * It reads the developer's REAL claude binary from ~/.zcc/config.json (via
 * config.get) rather than a stub — that's the point; the fixture restores config
 * on teardown regardless. The agent runs `--dangerously-skip-permissions`
 * (claude-yolo) so no approval prompt blocks the headless run.
 *
 * The sandbox-HOME isolation that protects the deterministic specs is exactly
 * what would break a REAL agent: `claude` reads its onboarding flag + auth
 * (apiKeyHelper / gateway env) from HOME, so under a throwaway HOME it stalls on
 * onboarding and never runs the turn (this is why an earlier version of this spec
 * saw an empty inbox). So this spec opts into `seedClaudeAuth: true`, which copies
 * the real `~/.claude.json` + `~/.claude/` (+ a `~/.devbar` symlink for the auth
 * daemon socket) into the sandbox HOME before launch. If those artifacts are
 * absent (a machine with no logged-in claude), the spec skips cleanly.
 *
 * A second gate: `claude` shows a per-folder "Is this a project you trust?"
 * dialog for any unfamiliar dir and blocks on it — a headless run never presses
 * Enter, so the agent would hang there forever. Our project dir is a fresh tmp
 * dir, so we pre-accept the dialog by writing `hasTrustDialogAccepted` into the
 * sandbox `~/.claude.json` (both the raw and realpath'd dir, since claude keys on
 * the realpath) via `trustProjectInSandbox` BEFORE spawning.
 *
 * macOS caveat: the app resolves ~/.zcc via app.getPath('home'); we register a
 * throwaway "unit test" project and remove it (plus any spawned session) in
 * `finally`.
 */
import { test, expect, trustProjectInSandbox } from './fixtures/app';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const AI_E2E = process.env.ZCC_AI_E2E === '1' || process.env.ZCC_AI_E2E === 'true';

// Seed the sandbox HOME with the real claude auth/onboarding state — otherwise a
// real agent stalls on onboarding under the throwaway HOME and never runs.
test.use({ seedClaudeAuth: true });

// Skipped unless explicitly opted in — a real model call, not deterministic.
test.describe(AI_E2E ? 'AI inbox round-trip' : 'AI inbox round-trip (skipped — set ZCC_AI_E2E=1)', () => {
  test.skip(!AI_E2E, 'Set ZCC_AI_E2E=1 to run the real-agent inbox round-trip.');
  // No logged-in claude on this machine → nothing to seed → skip cleanly.
  test.skip(
    !existsSync(join(homedir(), '.claude.json')),
    'No ~/.claude.json — the machine has no logged-in claude to drive.'
  );

  // A real model turn + tool call can take a while, and tearing down a live
  // Electron app with a running agent adds its own time — the test timeout must
  // cover boot + the poll budget + teardown, so give it generous headroom above
  // the 120s poll below (an under-budgeted timeout fails in teardown even after
  // the assertion passed).
  test.setTimeout(300_000);

  test('a real agent completes an instruction and its work lands in the inbox', async ({ app }) => {
    const { window, home } = app;

    // A unique marker so we can find THIS run's inbox entry and nothing else.
    // Time-free (Date.now is fine in a spec, unlike workflow scripts) + a random
    // tail so re-runs never collide.
    const marker = `ZCC_AI_TEST_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    // Confirm a real claude binary is configured; skip cleanly if not (so a
    // machine without one doesn't hard-fail the opted-in run).
    const claudeBinary = await window.evaluate(async () => {
      const cfg = await window.cc.config.get();
      return (cfg as { claudeBinary?: string }).claudeBinary ?? null;
    });
    test.skip(!claudeBinary, 'No claudeBinary configured in ~/.zcc/config.json.');

    // A dedicated throwaway "unit test" project to scope the run + the inbox read.
    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-ai-unit-test-'));
    // Pre-accept claude's per-folder trust dialog for this dir (both raw and
    // realpath'd — claude keys on the realpath, e.g. /private/var/... on macOS)
    // so the agent doesn't block on it and never run the prompt.
    trustProjectInSandbox(home, projectDir);
    trustProjectInSandbox(home, realpathSync(projectDir));
    let projectId: string | null = null;
    let sessionId: string | null = null;

    try {
      projectId = await window.evaluate(async (path) => {
        const res = await window.cc.projects.add(path);
        const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
          id: string;
        };
        return proj.id;
      }, projectDir);
      expect(projectId).toBeTruthy();

      // The instruction: do a trivial task, then report via the inbox tool. We
      // ask for the exact marker so the assertion is unambiguous. claude-yolo →
      // --dangerously-skip-permissions so the MCP tool call isn't gated.
      const instruction =
        `You are running inside an automated test. Do exactly one thing: call the ` +
        `inbox_push MCP tool (server: zcc-inbox) with a short comment whose text ` +
        `is exactly "${marker}". Do not do anything else. After the tool returns, stop.`;

      sessionId = await window.evaluate(
        async ({ pid, text }) => {
          const res = await window.cc.terminals.create({
            projectId: pid,
            profile: 'claude-yolo',
            cols: 80,
            rows: 24,
            title: 'AI unit test',
            extraArgs: [text]
          });
          const s = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
            id: string;
          };
          return s.id;
        },
        { pid: projectId, text: instruction }
      );
      expect(sessionId).toBeTruthy();

      // Verify the OUTCOME the way a user would: watch the inbox for the marker.
      // Poll inbox:history (scoped to our project) until the entry the agent
      // pushed appears — that proves the real launch→MCP→inbox path end to end.
      try {
        await expect
          .poll(
            async () =>
              window.evaluate(async (pid) => {
                const res = (await window.cc.inbox.history({ projectId: pid, limit: 50 })) as {
                  entries?: Array<{ comments?: string; docs?: unknown }>;
                };
                return JSON.stringify(res.entries ?? []);
              }, projectId),
            {
              timeout: 120_000,
              intervals: [2_000],
              message: `Expected an inbox entry containing the marker ${marker}`
            }
          )
          .toContain(marker);
      } catch (err) {
        // On failure, dump the agent's PTY backlog so a real-model run that
        // didn't push (hung on a prompt, errored, or just didn't call the tool)
        // is diagnosable from CI output rather than opaque.
        const backlog = sessionId
          ? await window.evaluate(
              (sid) => window.cc.terminals.backlog(sid).catch(() => '<no backlog>'),
              sessionId
            )
          : '<no session>';
        console.log('=== AI ROUND-TRIP FAILED — agent PTY backlog (tail) ===');
        console.log(String(backlog).slice(-3000));
        console.log('=== end backlog ===');
        throw err;
      }
    } finally {
      if (sessionId) {
        await window.evaluate(async (sid) => {
          try {
            await window.cc.terminals.close(sid);
          } catch {
            /* best-effort */
          }
        }, sessionId);
      }
      if (projectId) {
        await window.evaluate(async (pid) => {
          try {
            await window.cc.projects.remove(pid);
          } catch {
            /* best-effort */
          }
        }, projectId);
      }
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });
});
