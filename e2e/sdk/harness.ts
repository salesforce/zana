/**
 * Fake agent-harness binaries for deterministic e2e specs.
 *
 * Generalizes the inline `STUB` shell script that used to live in
 * `agent-status-hydrate.spec.ts`. A spec points a launch profile's binary config
 * key (`claudeBinary` / `cursorBinary` / `codexBinary` / `piBinary`) at one of
 * these stubs so the app spawns a REAL pty running a controlled sequence — no
 * network, no real CLI, no flakiness.
 *
 * How agent state is driven: main's `AgentStatusTracker.classifyOscTitle`
 * (src/main/agent-status.ts) classifies ANY profile's OSC-2 title — a leading
 * braille glyph (U+2800–U+28FF) or `✻` (U+273B) → `working`, a leading `✳`
 * (U+2733) → `idle`,
 * anything else → no change. So:
 *   - profile 'claude'  emits those OSC titles (drives working/idle lanes),
 *   - profile 'generic' emits plain stdout (codex/pi/cursor shape — the tracker
 *     leaves OSC state untouched; they surface via activity heuristics instead).
 *
 * The octal escapes below are interpreted by the shell's `printf`, NOT by JS —
 * they must be the byte-exact sequence `extractLastOscTitle` parses. This is the
 * load-bearing detail; a wrong byte yields a title the classifier ignores.
 */
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type HarnessProfile = 'claude' | 'generic';

export type HarnessSequence =
  /** Braille spinner (working) then block forever. The classic "hold working" stub. */
  | 'working-hold'
  /** Work briefly, then settle to ✳ idle and hold — drives a working→idle transition. */
  | 'work-then-idle'
  /** Work briefly, then clean exit(code) — drives the onExit lifecycle. */
  | 'work-then-exit'
  /** Exercise live notify + Stop lifecycle callbacks, then hold at the prompt. */
  | 'lifecycle-flow'
  /** Generic agent: plain stdout, no OSC title, hold forever. */
  | 'plain-hold'
  /** Generic agent: plain stdout, then exit(code). */
  | 'plain-exit';

export interface FakeAgentOptions {
  /** 'claude' → OSC titles; 'generic' → plain stdout. Defaults from `sequence`. */
  profile?: HarnessProfile;
  /** A named canned sequence. Ignored when `script` is provided. */
  sequence?: HarnessSequence;
  /** Fully custom shell body (sans shebang) — overrides the preset. */
  script?: string;
  /** Exit code for the *-exit sequences (default 0). */
  exitCode?: number;
  /** Idle title text after the working phase (work-then-idle, claude). */
  idleTitle?: string;
  /** Working title text (claude sequences). */
  workingTitle?: string;
}

export interface FakeAgentBinary {
  /** Absolute path to the executable stub — point a `*Binary` config key here. */
  path: string;
  /** The tmp dir holding it (call `cleanup()` or rm this in a spec's finally). */
  dir: string;
  /** Remove the tmp dir (best-effort). */
  cleanup(): void;
}

/**
 * Hold-forever stub for Cursor/Codex/Pi/OpenCode CLI Agent launches.
 * Answers `--version` immediately with a calver at/above every family's reviewed
 * floor (Cursor 2026.01.23, OpenCode 1.18.0, Codex 0.140.0, Pi 0.52.12).
 * OpenCode Edits injects `--agent build --auto`; launch-time preflight
 * (`discoverRoleTargets`) must see `build` as a directly-launchable primary or
 * the spawn is blocked (`role target unavailable`). Answer `agent list` /
 * `debug agent` the same way the catalog fixture does, then hold.
 * Other catalog probes (`--list-models`, `app-server`, `acp`) exit 0 so
 * `refreshCatalog` / ACP `list_models` do not hang, then `cat`.
 * Do not use {@link makeFakeOpenCodeBinary} here — that fixture exits 64 on spawn.
 */
export function makeFakeGenericHoldBinary(version = '2026.09.02'): FakeAgentBinary {
  return makeFakeAgentBinary({
    profile: 'generic',
    script: [
      `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi`,
      'if [ "$1" = "agent" ] && [ "$2" = "list" ]; then',
      '  echo "build (primary)"',
      '  echo "plan (primary)"',
      '  exit 0',
      'fi',
      'if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then',
      '  echo "{\\"name\\":\\"$3\\",\\"permission\\":{\\"read\\":true},\\"tools\\":{\\"bash\\":true}}"',
      '  exit 0',
      'fi',
      'if [ "$1" = "--list-models" ] || [ "$1" = "app-server" ] || [ "$1" = "agent" ] || [ "$1" = "acp" ]; then exit 0; fi',
      'echo "generic agent running"',
      'cat'
    ].join('\n')
  });
}

/**
 * Deterministic OpenCode catalog for Electron tests. Exercises `agent list` and
 * `debug agent` without reading a developer's OpenCode configuration.
 */
export function makeFakeOpenCodeBinary(): FakeAgentBinary {
  return makeFakeAgentBinary({
    profile: 'generic',
    script: [
      'if [ "$1" = "--version" ]; then echo "1.18.10"; exit 0; fi',
      'if [ "$1" = "agent" ] && [ "$2" = "list" ]; then',
      '  echo "build (primary)"',
      '  echo "plan (primary)"',
      '  echo "hidden-system (primary)"',
      '  echo "worker (subagent)"',
      '  exit 0',
      'fi',
      'if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then',
      '  if [ "$3" = "hidden-system" ]; then',
      '    echo "{\\"name\\":\\"hidden-system\\",\\"hidden\\":true,\\"permission\\":{\\"read\\":true}}"',
      '  else',
      '    echo "{\\"name\\":\\"$3\\",\\"permission\\":{\\"read\\":true},\\"tools\\":{\\"bash\\":true}}"',
      '  fi',
      '  exit 0',
      'fi',
      'echo "unexpected fake OpenCode invocation: $*" >&2',
      'exit 64'
    ].join('\n')
  });
}

/** OpenCode fixture whose catalog changes only after its marker file appears. */
export function makeRefreshableFakeOpenCodeBinary(): FakeAgentBinary & {
  refreshMarker: string;
  catalogCalls: string;
} {
  const binary = makeFakeAgentBinary({
    profile: 'generic',
    script: [
      'ROOT=$(dirname "$0")',
      'if [ "$1" = "--version" ]; then echo "1.18.10"; exit 0; fi',
      'if [ "$1" = "agent" ] && [ "$2" = "list" ]; then',
      '  printf "%s\\n" "$*" >> "$ROOT/catalog-calls"',
      '  echo "build (primary)"',
      '  if [ -f "$ROOT/refresh-marker" ]; then echo "review (primary)"; else echo "plan (primary)"; fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then',
      '  echo "{\\"name\\":\\"$3\\",\\"permission\\":{\\"read\\":true}}"',
      '  exit 0',
      'fi',
      'exit 64'
    ].join('\n')
  });
  return {
    ...binary,
    refreshMarker: join(binary.dir, 'refresh-marker'),
    catalogCalls: join(binary.dir, 'catalog-calls')
  };
}

// U+2809 ⠉ braille "working" spinner glyph, as shell printf octal bytes.
const BRAILLE_WORKING = '\\342\\240\\211';
// U+2733 ✳ idle/done marker, as shell printf octal bytes.
const IDLE_MARK = '\\342\\234\\263';

/** Emit an OSC-2 title (`ESC ] 2 ; <title> BEL`) via printf, byte-exact. */
function oscTitle(title: string): string {
  return `printf '\\033]2;${title}\\007'`;
}

const HOLD = 'cat';

function presetBody(opts: FakeAgentOptions): string {
  const profile = opts.profile ?? 'claude';
  const seq = opts.sequence ?? (profile === 'claude' ? 'working-hold' : 'plain-hold');
  const working = opts.workingTitle ?? 'Cooking';
  const idle = opts.idleTitle ?? 'ready';
  const code = opts.exitCode ?? 0;

  // Report a Claude version at the reviewed evidence floor so model-target
  // preflight (Haiku, etc.) does not block e2e launches as "CLI version below
  // reviewed floor (installed 1.0.0, requires >= 2.1.220)".
  const versionIntercept = 'if [ "$1" = "--version" ]; then echo "2.1.220 (Claude Code)"; exit 0; fi\n';

  switch (seq) {
    case 'working-hold':
      return `${versionIntercept}${oscTitle(`${BRAILLE_WORKING} ${working}`)}\n${HOLD}`;
    case 'work-then-idle':
      return [
        versionIntercept,
        oscTitle(`${BRAILLE_WORKING} ${working}`),
        'sleep 1',
        oscTitle(`${IDLE_MARK} ${idle}`),
        HOLD
      ].join('\n');
    case 'work-then-exit':
      return [versionIntercept, oscTitle(`${BRAILLE_WORKING} ${working}`), 'sleep 1', `exit ${code}`].join('\n');
    case 'lifecycle-flow':
      return [
        versionIntercept,
        // Fail loudly if the launcher's callback wiring regresses. The test then
        // calls the same local HTTP routes Claude's configured hooks use.
        '[ -n "$ZCC_HOOK_URL" ] && [ -n "$ZCC_NOTIFY_URL" ] || exit 90',
        oscTitle(`✻ ${working}`),
        'sleep 1',
        'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/blocked" >/dev/null',
        'sleep 1',
        'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/unblocked" >/dev/null',
        'sleep 1',
        'curl -s -m 5 -X POST "$ZCC_HOOK_URL" >/dev/null',
        HOLD
      ].join('\n');
    case 'plain-hold':
      return `${versionIntercept}echo "generic agent running"\n${HOLD}`;
    case 'plain-exit':
      return `${versionIntercept}echo "generic agent running"\nsleep 1\nexit ${code}`;
    default:
      return `${versionIntercept}${HOLD}`;
  }
}

/**
 * A `node`-shebang stub that DRIVES a durable Job Team to COMPLETED by speaking
 * the execution MCP protocol — no real model, no network beyond the app's own
 * loopback MCP endpoint.
 *
 * ONE binary serves all three cohort slots (1 orchestrator + N workers): each
 * spawned process self-identifies its role by parsing its own launch prompt
 * (delivered as a spawn-arg), because role / executionId reach the agent ONLY
 * via that prompt text — never via env or a readback tool. The orchestrator
 * prompt matches `coordinator of Team`; a worker prompt matches
 * `worker standby`; the executionId is the backtick-delimited `` execution `<id>` ``.
 *
 * Transport (per the MCP server's stateless streamable-http config): a single
 * plain-JSON POST per tool call to `ZCC_MCP_URL` (which already embeds
 * projectId/sessionId/sessionCredential). The `Accept` header MUST contain BOTH
 * `application/json` and `text/event-stream` or the transport answers 406. No
 * `initialize` handshake and no session header are needed in stateless mode. The
 * real tool payload is JSON-stringified inside `result.content[0].text`.
 *
 * DAG it runs (the workflow-testing probe): two disjoint root units `home` /
 * `about` (parallel), a read-only `navigation-label` that raises a durable
 * human question with two choices, and `assemble` (depends on the question)
 * that writes `result.txt`. Engine-cascade dispatch model: the orchestrator
 * registers the plan then calls `execution.work.dispatch_ready` EXACTLY ONCE —
 * the engine CLAIMs each ready unit to a free worker slot and PUSHES the task
 * to that worker's session (stdin), then re-dispatches newly-ready units on
 * every completion edge. Workers do NOT poll/self-claim; each reacts to the
 * injected `assigned work unit \`<id>\`` message, does the work, and calls
 * `execution.work.complete`. Because a unit may land on any free worker, the
 * `navigation-label` worker completes with the chosen label as its unit
 * `result`; the engine then INHERITS that result into the `assemble` worker's
 * injected assignment text ("Upstream results …"), so whichever worker gets
 * `assemble` reads the label straight out of its own task push — no side file,
 * no re-asking the human. The test answers the question out-of-band via
 * `executionBoard.respond`.
 */
export function makeJobTeamCoordinatorBinary(): FakeAgentBinary {
  const script = String.raw`#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

// The launcher probes --version before a real spawn; answer and exit.
if (process.argv.includes('--version')) { console.log('2.1.220 (fake)'); process.exit(0); }

const MCP_URL = process.env.ZCC_MCP_URL || '';
const PROMPT = process.argv.slice(2).join('\n');
const CWD = process.cwd();
// executionId arrives backtick-delimited (execution <bt>id<bt>). Build the
// regex from a fromCharCode backtick so NO literal backtick appears in this
// source — a literal one would need string concatenation, which terminates the
// enclosing String.raw tag and cooks every subsequent \n into a real newline
// (an unterminated-string SyntaxError across the whole stub).
const BT = String.fromCharCode(96);
// ESC + BEL for OSC title sequences. String.raw keeps \x1b literal, so build the
// real control bytes from char codes. Zana's AgentStatusTracker classifies the
// FIRST glyph of an OSC 0/2 title: a spinner (✻) => working, ✳ => idle. The
// worker emits these so the host's idle-gated injector sees a real busy/idle edge.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const execMatch = PROMPT.match(new RegExp('execution ' + BT + '([^' + BT + ']+)' + BT));
const EXECUTION_ID = execMatch ? execMatch[1] : null;
const IS_ORCHESTRATOR = /coordinator of Team/.test(PROMPT);
const IS_WORKER = /worker standby/.test(PROMPT);
const IS_OWNER = /E2E start Job Team/.test(PROMPT);

const ROLE = IS_ORCHESTRATOR ? 'ORCH' : IS_WORKER ? 'WORK' : IS_OWNER ? 'OWNR' : 'UNKN';
// Progress goes to stderr (Playwright captures it on failure) and a per-process
// log in the project cwd. Each line carries role + pid so the 3-process cohort
// interleaves legibly.
function log() {
  const line = ROLE + ':' + process.pid + ' ' + Array.from(arguments).join(' ') + '\n';
  try { fs.appendFileSync(path.join(CWD, '.fake-coordinator.log'), line); } catch (e) { /* best-effort */ }
  try { process.stderr.write(line); } catch (e) { /* best-effort */ }
}

let nextId = 1;
// Per-worker capture of each assignment's full pushed text, keyed by unit id, so
// doUnit can parse the engine-injected 'Upstream results' section (populated by
// the worker's stdin handler).
const assignText = Object.create(null);
// Delivery-nudge signal. A real worker does NOT poll execution.delivery.pull; it
// pulls ONLY after the host's ExecutionDeliveryDrainService injects a
// '[execution] You have N pending ...' nudge. The worker's stdin handler detects
// that nudge and resolves a waiter, so handleNavigationLabel below is fully
// nudge-driven — proving the drain re-announces a re-PENDING delivery after a
// transient ack(false) (attempt-keyed). Polling would mask that fix.
let pendingDeliveryNudge = false;
let deliveryNudgeWaiter = null;
function signalDeliveryNudge() {
  pendingDeliveryNudge = true;
  if (deliveryNudgeWaiter) { const w = deliveryNudgeWaiter; deliveryNudgeWaiter = null; w(); }
}
function waitDeliveryNudge(timeoutMs) {
  if (pendingDeliveryNudge) { pendingDeliveryNudge = false; return Promise.resolve(true); }
  return new Promise(function (resolve) {
    const t = setTimeout(function () { deliveryNudgeWaiter = null; resolve(false); }, timeoutMs);
    deliveryNudgeWaiter = function () { clearTimeout(t); pendingDeliveryNudge = false; resolve(true); };
  });
}
async function mcp(name, args) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: name, arguments: args || {} } })
  });
  const json = await res.json();
  if (json.error) throw new Error(name + ' rpc: ' + JSON.stringify(json.error));
  const result = json.result || {};
  const text = result.content && result.content[0] && result.content[0].text;
  if (result.isError) throw new Error(name + ' tool: ' + text);
  return text ? JSON.parse(text) : null;
}
async function tryMcp(name, args) {
  try { return { ok: true, value: await mcp(name, args) }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function hold() { process.stdin.resume(); return new Promise(function () {}); }

// A cohort agent is NOT the control owner, so execution.status ("not found for
// caller") is off-limits. The bound read is execution.snapshot, which projects
// the same fields (state, stateVersion, workUnits, blockers, finalSummary) onto
// its .execution envelope for a bound orchestrator OR worker.
async function status() {
  const snap = await mcp('execution.snapshot', { executionId: EXECUTION_ID, after: 0 });
  return snap && snap.execution ? snap.execution : null;
}

const PLAN = [
  { id: 'home', title: 'Write Home', task: 'Create home.txt containing HOME: ready', dependencies: [], files: ['home.txt'], verification: ['home.txt present'] },
  { id: 'about', title: 'Write About', task: 'Create about.txt containing ABOUT: ready', dependencies: [], files: ['about.txt'], verification: ['about.txt present'] },
  { id: 'navigation-label', title: 'Ask Navigation Label', task: 'Raise a durable human question with two label choices', dependencies: ['home', 'about'], readOnly: true, verification: ['durable question answered'] },
  { id: 'assemble', title: 'Assemble Result', task: 'Write result.txt from both worker outputs and the chosen label', dependencies: ['navigation-label'], files: ['result.txt'], verification: ['cat result.txt'] }
];

async function owner() {
  log('owner start');
  const started = await mcp('execution.start', {
    version: 1,
    teamId: 'e2e-job-team',
    launchRequestId: 'e2e-cli-agent-job-' + process.pid,
    jobTitle: 'CLI Agent durable job',
    summary: 'Full Job Team route started by a CLI Agent owner.',
    workUnits: PLAN,
    slots: [
      { initialTask: 'Coordinate the durable execution.' },
      { initialTask: 'Run assigned work from the durable execution.' },
      { initialTask: 'Run assigned work from the durable execution.' }
    ]
  });
  log('owner execution started', started && started.id);
  await hold();
}

async function orchestrator() {
  log('orchestrator start', EXECUTION_ID);
  // Plan-readiness pre-step: if the snapshot already carries a structured DAG,
  // dispatch straight away; otherwise register PLAN first. Zana never depends
  // on an external producer pre-structuring the plan — this is the generic
  // guarantee.
  for (let i = 0; i < 60; i++) {
    const exec = await status().catch(function () { return null; });
    if (exec && exec.workUnits && exec.workUnits.length) { log('plan present'); break; }
    const r = await tryMcp('execution.plan.register', { executionId: EXECUTION_ID, workUnits: PLAN });
    if (r.ok) { log('plan registered'); break; }
    log('register retry', r.error); await sleep(500);
  }
  // Hand scheduling to the engine ONCE. It claims every ready unit to a free
  // worker slot, pushes the task, and re-dispatches on each completion edge —
  // no per-unit assign/agent_send relay from the coordinator.
  for (let i = 0; i < 60; i++) {
    const d = await tryMcp('execution.work.dispatch_ready', { executionId: EXECUTION_ID });
    if (d.ok) { log('dispatch_ready ok'); break; }
    log('dispatch retry', d.error); await sleep(500);
  }
  // Deliberately do NOT call execution.complete. This models a real orchestrator
  // (e.g. an external skill-driven coordinator) that dispatches the DAG but never
  // finalizes — the observed stall. The engine's auto-finalize safety net must
  // transition the execution to COMPLETED once the terminal unit completes.
  for (let i = 0; i < 900; i++) {
    const exec = await status().catch(function () { return null; });
    if (exec && exec.state === 'COMPLETED') { log('engine auto-finalized', exec.finalSummary || ''); break; }
    await sleep(500);
  }
  await hold();
}

async function handleNavigationLabel() {
  const blockerId = 'blk-navigation-label';
  const r = await tryMcp('execution.work.block', {
    executionId: EXECUTION_ID, workUnitId: 'navigation-label', blockerId: blockerId,
    question: 'Which label should result.txt use?', options: ['About', 'About Atlas']
  });
  log('block', r.ok ? 'ok' : r.error);
  // Blocking ends this turn: go idle so the host's delivery drain sees a RESTFUL
  // worker and nudges it. We pull ONLY after a nudge (never poll) — modelling a
  // real prompt-obeying worker.
  //
  // Regression: report ONE transient delivery failure (delivered:false) before
  // accepting the answer. That reverts the delivery to PENDING (attempt bumped).
  // A non-polling worker then depends on the drain RE-announcing that re-PENDING
  // delivery on its next restful edge; without the attempt-keyed drain fix the
  // answer is stranded and the run never completes. (The old fake POLLED here,
  // which masked the missing re-nudge; see execution-delivery-drain.test.)
  setIdle();
  let failedOnce = false;
  for (let i = 0; i < 60; i++) {
    const got = await waitDeliveryNudge(15000);
    if (!got) { log('no delivery nudge'); continue; }
    setWorking();
    // A real worker's turn latency far exceeds the engine's early retry backoff
    // (attempt N: min(300s, 2^(N-1)s)); dwell so the re-PENDING delivery's
    // nextAttemptAt has elapsed before we pull, else pull returns nothing.
    await sleep(1200);
    const d = await tryMcp('execution.delivery.pull', {});
    if (!(d.ok && d.value && d.value.blockerId === blockerId)) { setIdle(); continue; }
    const delivery = d.value;
    if (!failedOnce) {
      failedOnce = true;
      await tryMcp('execution.delivery.ack', { deliveryId: delivery.id, leaseId: delivery.leaseId, delivered: false, error: 'transient apply failure (test)' });
      log('answer transient-fail');
      setIdle(); // rest again; the drain MUST re-announce the re-PENDING delivery
      continue;
    }
    const text = (delivery.payload && delivery.payload.text) || '';
    await tryMcp('execution.delivery.ack', { deliveryId: delivery.id, leaseId: delivery.leaseId, delivered: true });
    log('answer', text);
    return text;
  }
  throw new Error(
    'handleNavigationLabel: exhausted 60 delivery-nudge attempts (15s wait each) without a valid ' +
      'delivery for blockerId=' + blockerId + ' on executionId=' + EXECUTION_ID +
      ' (question="Which label should result.txt use?"). No real answer was ever delivered — this ' +
      'indicates the delivery/nudge path regressed; failing loudly instead of returning a fallback label.'
  );
}

// Execute ONE engine-assigned unit (the engine already CLAIMed it to this
// worker's slot, so no self-claim — just do the work and complete).
async function doUnit(unitId) {
  log('assigned', unitId);
  try {
    if (unitId === 'home') {
      fs.writeFileSync(path.join(CWD, 'home.txt'), 'HOME: ready\n');
      await mcp('execution.work.complete', { executionId: EXECUTION_ID, workUnitId: 'home', result: 'HOME: ready' });
    } else if (unitId === 'about') {
      fs.writeFileSync(path.join(CWD, 'about.txt'), 'ABOUT: ready\n');
      await mcp('execution.work.complete', { executionId: EXECUTION_ID, workUnitId: 'about', result: 'ABOUT: ready' });
    } else if (unitId === 'navigation-label') {
      const chosenLabel = await handleNavigationLabel();
      // Complete with the chosen label as the unit result. The engine inherits
      // this into the 'assemble' worker's assignment text — NO side file.
      await mcp('execution.work.complete', { executionId: EXECUTION_ID, workUnitId: 'navigation-label', result: chosenLabel });
    } else if (unitId === 'assemble') {
      // Inherit the chosen label from the engine-injected 'Upstream results'
      // section of THIS unit's assignment push (dependencyResultsSection). If the
      // result never propagated, the label stays empty and result.txt is missing
      // it — the assertion then fails loudly instead of a silent side-file fallback.
      let chosenLabel = '';
      const upstream = (assignText['assemble'] || '').match(new RegExp(BT + 'navigation-label' + BT + '[^:]*:[ ]*([^\n]+)'));
      if (upstream) chosenLabel = upstream[1].trim();
      log('assemble inherited label', JSON.stringify(chosenLabel));
      const home = fs.readFileSync(path.join(CWD, 'home.txt'), 'utf8').trim();
      const about = fs.readFileSync(path.join(CWD, 'about.txt'), 'utf8').trim();
      fs.writeFileSync(path.join(CWD, 'result.txt'), home + '\n' + about + '\nLABEL: ' + chosenLabel + '\n');
      await mcp('execution.work.complete', { executionId: EXECUTION_ID, workUnitId: 'assemble', result: 'assembled' });
    } else {
      log('unknown unit', unitId);
      return;
    }
    log('completed', unitId);
  } catch (e) {
    log('unit error', unitId, String((e && e.message) || e));
    // Do not swallow: a failed unit (e.g. handleNavigationLabel's exhausted-
    // attempts throw) must fail the process loudly, not silently stall with
    // the unit never completed and the run limping toward a timeout.
    throw e;
  }
}

function setWorking() { try { process.stdout.write(ESC + ']2;' + '✻ working' + BEL); } catch (e) { /* best-effort */ } }
function setIdle() { try { process.stdout.write(ESC + ']2;' + '✳ idle' + BEL); } catch (e) { /* best-effort */ } }

async function worker() {
  log('worker start', EXECUTION_ID);
  // Engine-cascade model: the engine claims a unit to this slot and PUSHES the
  // task text on stdin. React to each 'assigned work unit <bt>id<bt>' message;
  // never poll or self-claim. Serialize via a queue so a same-slot worker that
  // gets several units over time runs them one at a time.
  const ASSIGN_RE = new RegExp('assigned work unit ' + BT + '([^' + BT + ']+)' + BT);
  const seen = Object.create(null);
  const queue = [];
  let draining = false;
  // Idle-gate regression: while this worker is mid-turn it DROPS incoming stdin,
  // modelling a real Claude TUI that buffers a mid-turn paste into oblivion and
  // wedges. The engine's cascadeDispatch fires synchronously INSIDE the still-in-
  // flight execution.work.complete call, so a raw (non-idle-gated) reply() would
  // push the next unit's task while this worker is busy -> lost -> the run stalls
  // and the E2E times out. With the host's IdleGatedInjector, the push is held
  // until the worker emits its ✳ idle title (below), so stdin only arrives when
  // busy === false. This makes the fix load-bearing for the test to pass.
  let busy = false;
  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const id = queue.shift();
      busy = true; setWorking();
      // Working dwell BEFORE completing: the host's AgentStatusTracker debounces
      // OSC transitions by 250ms and IdleGatedInjector reads that committed state.
      // A real turn lasts far longer, but this fake finishes a unit in <250ms, so
      // without a dwell the cascade (which fires inside work.complete) would read
      // a STALE non-working state for a sibling worker and push raw. Dwell past
      // the debounce so 'working' is committed before we complete + cascade.
      await sleep(400);
      await doUnit(id);
      // Post-complete busy window: the turn keeps rendering AFTER work.complete
      // returns. Any assignment delivered in this window is dropped by the stdin
      // handler; only after ✳ idle does the host flush a queued assignment.
      await sleep(700);
      busy = false; setIdle();
    }
    draining = false;
  }
  let buf = '';
  // Sentinel that terminates every pushAssignments() message (see service.ts).
  const END = 'agent_send.';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) {
    const s = String(chunk);
    // Delivery-pull nudge is NOT an assignment and must be observed even while
    // busy (we set the OSC to idle during a blocker wait, but the internal busy
    // flag stays set for the enclosing unit turn). Resolve the waiter so the
    // nudge-driven blocker handler can pull.
    if (s.indexOf('[execution]') !== -1 && s.indexOf('execution.delivery.pull') !== -1) {
      log('delivery nudge'); signalDeliveryNudge();
    }
    if (busy) { log('stdin dropped while busy', JSON.stringify(s.slice(0, 60))); return; }
    buf += s;
    // Enqueue only a COMPLETE assignment message. The host writes the push
    // line-by-line, so waiting for the trailing sentinel before we go busy is
    // what lets doUnit read the whole 'Upstream results' section — otherwise the
    // first line flips busy and every continuation line is dropped. A genuinely
    // mid-turn (raw, non-idle-gated) push still lands while busy and IS dropped.
    let m;
    while ((m = buf.match(ASSIGN_RE)) !== null) {
      const endIdx = buf.indexOf(END, m.index);
      if (endIdx === -1) break; // message still arriving; wait for more chunks
      const end = endIdx + END.length;
      const id = m[1];
      assignText[id] = buf.slice(m.index, end);
      buf = buf.slice(end);
      if (!seen[id]) { seen[id] = true; queue.push(id); }
    }
    void drain();
  });
  process.stdin.resume();
  setIdle(); // announce ready-idle so the kickoff dispatch delivers immediately
  await new Promise(function () {}); // stay alive; work is push-driven
}

(async function () {
  log('boot', 'mcp=' + (MCP_URL ? 'yes' : 'no'), 'exec=' + EXECUTION_ID, 'promptHead=' + JSON.stringify(PROMPT.slice(0, 120)));
  if (!MCP_URL || (!EXECUTION_ID && !IS_OWNER)) { log('missing MCP_URL/EXECUTION_ID', MCP_URL, EXECUTION_ID); await hold(); return; }
  try {
    if (IS_OWNER) await owner();
    else if (IS_ORCHESTRATOR) await orchestrator();
    else if (IS_WORKER) await worker();
    else { log('unknown role; prompt head:', PROMPT.slice(0, 200)); await hold(); }
  } catch (e) { log('fatal', String((e && e.stack) || e)); await hold(); }
})();
`;
  const dir = mkdtempSync(join(tmpdir(), 'zcc-fake-coordinator-'));
  const path = join(dir, 'claude-coordinator.js');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return {
    path,
    dir,
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  };
}

/**
 * Write a chmod +x shell stub into a throwaway tmp dir and return its path.
 * Caller owns cleanup (call `.cleanup()` in a `finally`).
 */
export function makeFakeAgentBinary(opts: FakeAgentOptions = {}): FakeAgentBinary {
  const profile = opts.profile ?? 'claude';
  const body = opts.script ?? presetBody(opts);
  const dir = mkdtempSync(join(tmpdir(), 'zcc-fake-agent-'));
  const path = join(dir, `${profile}-stub.sh`);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return {
    path,
    dir,
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  };
}
