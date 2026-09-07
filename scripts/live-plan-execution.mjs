#!/usr/bin/env node
/**
 * Live durable-plan probe against the running product server.
 *
 * Spawns one thread per provider with a 3-step checklist about the Codex
 * steer `bridge→runtime.current.ndjson` recording (locate → count → first
 * method). Polls GET /api/v1/threads/:id/plan until all three tasks complete.
 *
 * Re-run anytime the app is up (same idea as replaying a bridge recording):
 *   node scripts/live-plan-execution.mjs
 *   node scripts/live-plan-execution.mjs --providers claude-code
 *   node scripts/live-plan-execution.mjs --watch <threadId>
 *
 * Not part of `npm test` — spends real model turns. Requires a running app
 * (default http://127.0.0.1:8780, `pnpm dev:prod`). Threads are left open.
 *
 * Honor-system: this asserts ZCC *recorded* harness checklist statuses, not
 * that the shell work happened.
 */
import { realpathSync } from 'node:fs';
import { cwd } from 'node:process';

const RECORDING =
  'packages/provider-bridge-protocol/recordings/codex/steer/bridge→runtime.current.ndjson';

const CHECKLIST_PROMPT = `Use your session task-checklist tools immediately and keep them in sync as you work:
- Claude Code: TodoWrite, or TaskCreate then TaskUpdate
- Cursor ACP: updateTodos / plan
- OpenCode: todos / plan

Create exactly three checklist items, then execute them in order. Do not edit files. Do not git commit. Do not skip the checklist.

Items (use these titles):
1. locate recording — mark in_progress, run \`test -f ${RECORDING} && echo found\`, then mark completed
2. count lines — mark in_progress, run \`wc -l ${RECORDING}\`, then mark completed
3. first method — mark in_progress, print the JSON-RPC method from the first NDJSON line's \`line\` field (python3 or jq is fine), then mark completed

Call the checklist tool first with all three pending. After each step, update statuses so only the current item is in_progress. Stop when all three are completed. Reply with one line: locate count method done.`;

const DEFAULT_PROVIDERS = [
  { id: 'claude-code', label: 'Claude Code', model: 'claude-opus-4-7[1m]' },
  { id: 'acp-cursor', label: 'Cursor' },
  { id: 'acp-opencode', label: 'OpenCode' }
];

const args = parseArgs(process.argv.slice(2));
const base = (args.server ?? `http://127.0.0.1:${process.env.ZCC_SERVER_PORT || '8780'}`).replace(
  /\/$/,
  ''
);
const timeoutMs = Number(args['timeout-ms'] ?? 240_000);
const pollMs = Number(args['poll-ms'] ?? 2_000);
const permissionMode = args['permission-mode'] ?? 'full';
const jsonOut = Boolean(args.json);

const wanted = new Set(
  String(args.providers ?? DEFAULT_PROVIDERS.map((p) => p.id).join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const providers = DEFAULT_PROVIDERS.filter((p) => wanted.has(p.id)).map((p) => ({
  ...p,
  model: p.id === 'claude-code' ? (args['claude-model'] ?? p.model) : args.model ?? p.model
}));

if (providers.length === 0 && !args.watch) fail('no providers selected');

const health = await json('GET', '/api/v1/projects');
if (health.status === 0) {
  fail(`app is not reachable at ${base} (start pnpm dev:prod)`);
}
if (health.status >= 400) {
  fail(`GET /api/v1/projects ${health.status} ${health.text.slice(0, 400)}`);
}

const projectId = args.project ?? args['project-id'] ?? matchProject(health.body.projects ?? []);
if (!projectId) fail('could not resolve project; pass --project <id>');

const runs = args.watch
  ? [{ label: 'watch', providerId: 'watch', threadId: args.watch }]
  : await spawnAll(providers, projectId);

log(`project ${projectId}`);
for (const run of runs) log(`${run.label} thread ${run.threadId}`);

const results = await pollAll(runs);
if (jsonOut) {
  process.stdout.write(`${JSON.stringify({ projectId, results }, null, 2)}\n`);
} else {
  process.stdout.write('\n');
  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    log(
      `${mark} ${result.label} ${result.threadId}  ${result.progress}  ${result.tasks || '(no plan)'}`
    );
    if (result.error) log(`  ${result.error}`);
  }
}

if (results.some((r) => !r.ok)) process.exit(1);

async function spawnAll(list, pid) {
  return Promise.all(
    list.map(async (provider) => {
      const created = await json('POST', '/api/v1/threads', {
        projectId: pid,
        providerId: provider.id,
        permissionMode,
        title: `plan 3-step bridge-runtime (${provider.label})`,
        prompt: CHECKLIST_PROMPT,
        ...(provider.model ? { model: provider.model } : {})
      });
      const threadId = created.body.value?.id ?? created.body.thread?.id;
      if (!threadId || created.body.ok === false) {
        fail(`${provider.label} spawn ${created.status} ${created.text.slice(0, 1500)}`);
      }
      return {
        label: provider.label,
        providerId: provider.id,
        threadId
      };
    })
  );
}

async function pollAll(list) {
  const deadline = Date.now() + timeoutMs;
  const state = new Map(
    list.map((run) => [
      run.threadId,
      {
        ...run,
        ok: false,
        progress: '0/0',
        tasks: '',
        error: null,
        last: '',
        done: false
      }
    ])
  );

  while (Date.now() < deadline) {
    for (const run of list) {
      const row = state.get(run.threadId);
      if (row.done) continue;
      const snap = await snapshot(run.threadId);
      const line = `${snap.threadStatus} ${snap.progress} ${snap.tasks}`;
      if (line !== row.last) {
        row.last = line;
        log(`[${run.label}] ${line}`);
      }
      row.progress = snap.progress;
      row.tasks = snap.tasks;
      if (snap.error) {
        row.error = snap.error;
        row.done = true;
        continue;
      }
      if (snap.completed >= 3 && snap.total >= 3) {
        row.ok = true;
        row.done = true;
        continue;
      }
      if (isQuiet(snap.threadStatus) && snap.total > 0 && snap.completed < 3) {
        row.error = `idle with incomplete plan ${snap.progress}`;
        row.done = true;
      }
    }
    if ([...state.values()].every((row) => row.done)) break;
    await sleep(pollMs);
  }

  for (const row of state.values()) {
    if (!row.done && !row.ok) {
      row.error = `timed out at ${row.progress} ${row.tasks}`;
    }
  }
  return [...state.values()];
}

async function snapshot(threadId) {
  const threadRes = await json('GET', `/api/v1/threads/${threadId}`);
  const thread = threadRes.body.thread ?? {};
  const threadStatus =
    thread.runtime?.displayStatus || thread.status || String(threadRes.status);
  const planRes = await json('GET', `/api/v1/threads/${threadId}/plan`);
  if (planRes.status === 404) {
    return {
      threadStatus,
      completed: 0,
      total: 0,
      progress: '0/0',
      tasks: '(none)',
      error: rejectionError(threadRes.body)
    };
  }
  if (planRes.status >= 400) {
    return {
      threadStatus,
      completed: 0,
      total: 0,
      progress: '0/0',
      tasks: '',
      error: `plan ${planRes.status}`
    };
  }
  const plan = planRes.body.plan ?? planRes.body;
  const tasks = plan.tasks ?? [];
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const total = plan.progress?.total ?? tasks.length;
  return {
    threadStatus,
    completed,
    total,
    progress: `${plan.progress?.completed ?? completed}/${total}`,
    tasks: tasks.map((t) => `${shortText(t.text)}=${t.status}`).join(' | ') || '(none)',
    error: rejectionError(threadRes.body)
  };
}

function matchProject(projects) {
  const wantedPath = args.cwd ?? cwd();
  let resolved = wantedPath;
  try {
    resolved = realpathSync(wantedPath);
  } catch {
    /* keep raw */
  }
  const byPath = projects.find((p) => {
    const path = p.path || p.rootPath || p.cwd || '';
    return path === wantedPath || path === resolved;
  });
  if (byPath) return byPath.id;
  const byName = projects.find((p) => p.name === 'zana-command-center' || p.slug === 'zana-command-center');
  return byName?.id ?? projects[0]?.id;
}

function isQuiet(status) {
  return status === 'idle' || status === 'error' || status === 'stopped';
}

function shortText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').slice(0, 40);
}

function rejectionError(body) {
  return body?.error && body.error !== 'unknown-plan' ? String(body.error) : null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = '1';
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function json(method, path, body) {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed, text };
  } catch (error) {
    return { status: 0, body: { error: String(error) }, text: String(error) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
