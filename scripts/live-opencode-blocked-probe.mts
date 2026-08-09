/**
 * LIVE end-to-end probe for the LAS-07 OpenCode "needs-you" detection.
 *
 * Spawns the REAL `opencode` TUI via node-pty, wires its raw PTY stream through
 * the ACTUAL production modules — OutputActivityMonitor (working/idle),
 * ScreenScanBlockedDetector (blocked), fused by AgentStatusTracker via the real
 * OpenCodeProvider.detectBlockedPrompt — exactly as src/main/index.ts does, then
 * asks the agent to run a shell command so OpenCode paints its `△ Permission
 * required` prompt and goes silent. Asserts the fused state flips to `blocked`
 * (NOT idle), then answers the prompt and asserts it clears back to working.
 *
 * Not a vitest test (it drives a real interactive TUI with real timers); run via
 * scripts/live-opencode-blocked-probe.sh which esbuild-bundles it against the
 * real source, so it exercises production code, not a reimplementation.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as pty from 'node-pty';
import { ScreenScanBlockedDetector, stripAnsi } from '../src/main/screen-scan-blocked-detector.js';
import { OutputActivityMonitor } from '../src/main/output-activity.js';
import { AgentStatusTracker } from '../src/main/agent-status.js';
import { OpenCodeProvider } from '../src/main/harness/opencode-provider.js';

const SID = 'live-probe';
const provider = new OpenCodeProvider();
const tracker = new AgentStatusTracker();

const transitions: Array<{ t: number; state: string }> = [];
const start = Date.now();
tracker.on('status', (_id: string, state: string) => {
  transitions.push({ t: Date.now() - start, state });
  console.log(`  [${Date.now() - start}ms] STATUS → ${state}`);
});

const activity = new OutputActivityMonitor({
  sink: tracker,
  idleAfterMs: () => 1500,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout)
});
const scan = new ScreenScanBlockedDetector({
  sink: tracker,
  detect: (_id, text) => provider.detectBlockedPrompt('opencode', text),
  settleAfterMs: () => 1500,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout)
});

// A throwaway workspace so the prompt targets a real, writable path. Force
// OpenCode to ASK before running bash/edits (schema: `permission.bash: "ask"`,
// grounded in the binary) — otherwise it auto-approves and never blocks.
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-probe-'));
fs.writeFileSync(path.join(workdir, 'AGENTS.md'), '# probe workspace\n');
fs.writeFileSync(
  path.join(workdir, 'opencode.json'),
  JSON.stringify(
    { $schema: 'https://opencode.ai/config.json', permission: { bash: 'ask', edit: 'ask' } },
    null,
    2
  )
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const bin = process.env.ZCC_OPENCODE_BIN || 'opencode';
  console.log(`spawning: ${bin} in ${workdir}`);
  const term = pty.spawn(bin, [], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: workdir,
    env: { ...process.env } as Record<string, string>
  });

  let bytes = 0;
  const rawLog = fs.createWriteStream('/tmp/oc-probe-stream.txt');
  term.onData((data) => {
    bytes += data.length;
    rawLog.write(stripAnsi(data));
    // The exact two production hooks from index.ts's pty `data` handler for a
    // non-OSC agent (caps.isAgent && !caps.emitsOscStatus).
    activity.observe(SID, data);
    scan.observe(SID, data);
  });

  let exited = false;
  term.onExit(() => {
    exited = true;
  });

  // Let the TUI boot.
  await sleep(4000);
  if (exited) throw new Error('opencode exited during boot');
  console.log(`booted (${bytes} bytes). Sending a request that needs a shell permission...`);

  // Ask the agent to run a shell command — this forces the permission prompt.
  term.write('run the shell command: echo hello-from-probe > out.txt\r');

  // Wait for the model turn to reach the permission prompt and settle silent.
  // Poll the fused state up to 60s.
  const deadline = Date.now() + 60_000;
  let sawBlocked = false;
  while (Date.now() < deadline) {
    if (tracker.get(SID) === 'blocked') {
      sawBlocked = true;
      break;
    }
    await sleep(500);
  }

  const stateAtPrompt = tracker.get(SID);
  console.log(`\nfused state after request: ${stateAtPrompt} (blocked seen: ${sawBlocked})`);

  let cleared = false;
  if (sawBlocked) {
    // Answer the prompt (enter selects the default "Allow once") and confirm the
    // blocked overlay auto-clears as output resumes.
    console.log('answering prompt (enter = allow once)...');
    term.write('\r');
    const clearDeadline = Date.now() + 20_000;
    while (Date.now() < clearDeadline) {
      const s = tracker.get(SID);
      if (s === 'working' || s === 'idle') {
        cleared = true;
        break;
      }
      await sleep(500);
    }
    console.log(`fused state after answering: ${tracker.get(SID)} (cleared: ${cleared})`);
  }

  term.write('\x03'); // ctrl-c
  await sleep(300);
  try {
    term.kill();
  } catch {
    /* already gone */
  }
  try {
    fs.rmSync(workdir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  console.log('\n=== transition log ===');
  for (const tr of transitions) console.log(`  ${tr.t}ms  ${tr.state}`);

  const pass = sawBlocked && cleared;
  console.log(`\n=== RESULT: ${pass ? 'PASS ✅' : 'FAIL ❌'} ===`);
  console.log(`  blocked surfaced at prompt: ${sawBlocked ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  auto-cleared on resume:     ${cleared ? 'YES ✅' : 'NO ❌'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('probe error:', e);
  process.exit(2);
});
