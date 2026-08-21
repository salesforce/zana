import { describe, it, expect } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createMicroVmEnvironment } from '../microvm-environment.js';
import type { ExecEnvContext } from '../execution-environment.js';

/**
 * LIVE full-app integration test for the `microvm` environment. Unlike the
 * fake-SDK adapter test, this drives the REAL `createMicroVmEnvironment()`
 * object (the exact one `pty.ts` attaches) against the REAL `microsandbox`
 * native addon — it boots an actual libkrun microVM. It therefore only runs
 * when explicitly opted in:
 *
 *   ZCC_MICROVM_LIVE=1 npx vitest run \
 *     src/main/harness/__tests__/microvm-environment.live.test.ts
 *
 * It exercises every microVM-specific seam end-to-end, standing in for the full
 * PtyManager launch (which just wires these same methods onto a session):
 *   1. createSession() boots a guest and runs the provider `{command,args}`.
 *   2. rewriteCallbackEnv() rewrites the host loopback callback URL to the
 *      guest-reachable host name, and the guest agent actually REACHES the host
 *      MCP/callback server through it (the plumbing every MCP tool, inbox_push,
 *      hook and agent_send rides on).
 *   3. write() reaches the guest stdin — the reply-injection path PtyManager
 *      uses for reply()/steer.
 *   4. onData streams guest stdout; onExit fires the clean exit code.
 *
 * The agent auth path (Bedrock via the SF-internal model gateway) is out of
 * scope here: the gateway is a VPN-only address unreachable from the guest
 * netns, and NONE of the surfaces above touch it. We use a `sh` agent — the
 * `shellProvider` shape — so the test is a faithful launch minus the model call.
 */

const LIVE = process.env.ZCC_MICROVM_LIVE === '1';
const d = LIVE ? describe : describe.skip;

// Booting a real microVM + an in-guest wget can take a few seconds cold.
const TIMEOUT = 90_000;

function ctx(over: Partial<ExecEnvContext & { cols: number; rows: number; sessionEnv: Record<string, string> }>) {
  return {
    sessionId: 'live-1',
    projectId: 'p-live',
    cwd: over.cwd ?? process.cwd(),
    cols: 80,
    rows: 24,
    sessionEnv: {},
    ...over
  } as ExecEnvContext & { cols: number; rows: number; sessionEnv: Record<string, string> };
}

d('microvm environment — LIVE full-app integration', () => {
  it(
    'boots a guest, reaches the host callback server, and round-trips reply-injection',
    async () => {
      const env = createMicroVmEnvironment(); // the real production object

      // A RW workspace the guest mounts at /workspace — a real, existing dir.
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcc-microvm-live-'));
      fs.writeFileSync(path.join(workDir, 'host-marker.txt'), 'from-host\n');

      // --- REAL host callback server (stands in for the MCP/hook server) ------
      let callbackHit = false;
      let callbackPath = '';
      const server = http.createServer((req, res) => {
        callbackHit = true;
        callbackPath = req.url ?? '';
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('MCP-CALLBACK-OK');
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as import('node:net').AddressInfo).port;

      // The per-session callback env the pty layer would build — a HOST env, so
      // it carries a macOS-style PATH/HOME that is meaningless in the Linux
      // guest. Run it through the REAL rewriteCallbackEnv (loopback ->
      // host.microsandbox.internal); createSession then scrubs the host-fs vars
      // so the guest OS defaults apply (the exact bug this test caught).
      const rawEnv = {
        ZCC_MCP_URL: `http://127.0.0.1:${port}/mcp/ping`,
        PATH: '/Users/someone/.local/bin:/usr/local/bin', // host macOS PATH (no /bin)
        HOME: '/Users/someone' // host HOME (doesn't exist in guest)
      };
      const sessionEnv = env.rewriteCallbackEnv(rawEnv, ctx({ cwd: workDir }));
      expect(sessionEnv.ZCC_MCP_URL).toContain('host.microsandbox.internal');
      expect(sessionEnv.ZCC_MCP_URL).toContain(`:${port}/mcp/ping`);

      // The in-guest "agent": call the host callback via the rewritten URL
      // (proves guest->host), read the host's marker file from the RW mount,
      // then read one line from stdin and echo it (proves reply-injection).
      const agentScript = [
        'echo AGENT-UP',
        // busybox wget is present in alpine; -O- streams the body to stdout.
        'echo "CALLBACK:$(wget -q -O- "$ZCC_MCP_URL" 2>/dev/null || echo WGET-FAIL)"',
        'echo "MOUNT:$(cat /workspace/host-marker.txt 2>/dev/null || echo NO-MOUNT)"',
        'IFS= read -r line',
        'echo "REPLY_GOT:$line"'
      ].join('; ');

      const session = await env.createSession!(
        { command: 'sh', args: ['-c', agentScript] },
        ctx({ cwd: workDir, microVmImage: 'alpine', sessionEnv })
      );

      const chunks: string[] = [];
      let exitCode: number | null = null;
      let replied = false;
      session.onData((chunk) => {
        chunks.push(chunk);
        // Inject a reply once the guest has hit the host callback — the same
        // ordering PtyManager.reply() relies on (write after the agent asks).
        if (!replied && chunks.join('').includes('CALLBACK:')) {
          replied = true;
          session.write('hello-from-host\n');
        }
      });
      session.onExit((e) => (exitCode = e.exitCode));

      // Wait for a clean exit (bounded).
      const deadline = Date.now() + TIMEOUT - 5_000;
      while (exitCode === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      server.close();
      try {
        session.kill();
      } catch {
        /* best-effort */
      }
      fs.rmSync(workDir, { recursive: true, force: true });

      const out = chunks.join('');
      // 1. Agent booted + ran in-guest.
      expect(out).toContain('AGENT-UP');
      // 2. Guest reached the REAL host callback server via the rewritten URL.
      expect(callbackHit).toBe(true);
      expect(callbackPath).toBe('/mcp/ping');
      expect(out).toContain('CALLBACK:MCP-CALLBACK-OK');
      // 3. RW workspace bind-mount is readable in-guest.
      expect(out).toContain('MOUNT:from-host');
      // 4. Reply-injection through write() reached the guest stdin.
      expect(out).toContain('REPLY_GOT:hello-from-host');
      // 5. Clean exit.
      expect(exitCode).toBe(0);
    },
    TIMEOUT
  );

  it(
    'remaps a host login shell (/bin/zsh) to the guest /bin/sh and boots an interactive shell',
    async () => {
      // The `shell` launch profile resolves to the host's configured login shell
      // — an ABSOLUTE HOST path (`/bin/zsh` on macOS) that doesn't exist in the
      // Linux guest rootfs. remapGuestCommand rewrites it to `/bin/sh`. This is
      // the real end-to-end proof: launch with the exact shape shellProvider
      // produces and confirm a guest shell actually boots + runs a command.
      const env = createMicroVmEnvironment();
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcc-microvm-shell-'));

      // A host login shell path + a command piped over stdin (the shell keeps
      // reading stdin because we don't pass -c). Prove the guest shell runs it.
      const session = await env.createSession!(
        { command: '/bin/zsh', args: [] },
        ctx({ cwd: workDir, microVmImage: 'alpine' })
      );

      const chunks: string[] = [];
      let exitCode: number | null = null;
      session.onData((chunk) => chunks.push(chunk));
      session.onExit((e) => (exitCode = e.exitCode));

      // Drive the remapped /bin/sh over stdin, then exit it.
      session.write('echo SHELL-UP; exit 0\n');

      const deadline = Date.now() + TIMEOUT - 5_000;
      while (exitCode === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      try {
        session.kill();
      } catch {
        /* best-effort */
      }
      fs.rmSync(workDir, { recursive: true, force: true });

      const out = chunks.join('');
      // The remapped /bin/sh booted and ran our piped command — the host
      // /bin/zsh would have failed to launch (silent exit 1, no output).
      expect(out).toContain('SHELL-UP');
      expect(exitCode).toBe(0);
    },
    TIMEOUT
  );
});
