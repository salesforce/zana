import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
// Reuse the workspace build toolchain's declared compiler dependency.
const { transformSync } = createRequire(new URL('../packages/plugin-build/package.json', import.meta.url))('esbuild');

/** Conservative ownership map: changed production seams run their real app tests. */
export function boundarySpecs(paths) {
  const specs = new Set();
  const add = (...names) => names.forEach(name => specs.add(`e2e/${name}.spec.ts`));
  for (const path of paths) {
    // A changed test must verify itself, including CI-only regression repairs.
    if (/^e2e\/[^/]+\.spec\.ts$/.test(path) && existsSync(path)) specs.add(path);
    if (/^(apps\/|packages\/|plugins\/|e2e\/|scripts\/.*(electron|e2e|build)|electron\.vite|package\.json|pnpm-lock)/.test(path)) add('smoke');
    if (/threads|thread-view|agent-runtime|provider-bridge|provider-(acp|codex)|host-hub|control-sdk/.test(path)) add('thread-plan-ux', 'thread-refresh-progress', 'provider-bridge-framing', 'thread-loading');
    if (/conversation-(pruning|output|history-maintenance)/.test(path)) add('thread-history-pruning');
    if (/inbox|feed-categories/.test(path)) add('inbox-read-persistence');
    if (/plugins\/tasks\//.test(path)) add('tasks-bb-parity', 'mobile-tasks');
    if (/terminal|pty|runtime-host-environment/.test(path)) add('terminals', 'terminal-view-navigation');
    if (/monaco|editor|App\.tsx/.test(path)) add('thread-diff-workbench', 'renderer-resource-budget');
    if (/timeline|thread-store|renderer-resource-budget/.test(path)) add('renderer-resource-budget');
    if (/job-team|execution-routing|execution-service/.test(path)) add('job-team-launch-ui', 'cli-agent-job-team-run', 'modern-owner-job-team-run');
    if (/harness\/|(?:^|\/)pty\.ts$/.test(path)) add('job-team-launch-ui', 'cli-agent-job-team-run', 'modern-owner-job-team-run');
    if (/opencode/.test(path)) add('opencode-launch-boundary');
    if (/desktop-browser/.test(path)) add('desktop-browser-broker');
    if (/mobile-relay|mobile\/|mobile-/.test(path)) add('mobile-shell', 'mobile-relay-upload');
    if (/ci-verification|\.github\/workflows\/ci\.yml/.test(path)) add('smoke');
  }
  return [...specs].sort();
}

/** Added line sets from an ordinary zero-context git diff. */
export function changedLines(diff) {
  const files = new Map();
  let path, previous;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { path = undefined; previous = undefined; }
    if (line.startsWith('--- a/')) previous = line.slice(6);
    if (line.startsWith('+++ b/')) { path = line.slice(6); files.set(path, new Set()); }
    if (line === '+++ /dev/null' && previous) { path = previous; files.set(path, new Set()); }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (path && hunk) {
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = 0; n < count; n++) files.get(path).add(Number(hunk[1]) + n);
    }
  }
  return files;
}

function productionFile(path) {
  return /^(apps\/.*\/src\/|packages\/.*\/src\/|plugins\/[^/]+\/|website\/(lib|app)\/|services\/|scripts\/)/.test(path) &&
    /\.(?:[cm]?js|tsx?)$/.test(path) && !/^plugins\/[^/]+\/(app\.js|server\.mjs)$/.test(path) && !/(?:\.test\.|\.spec\.|\/__tests__\/|\/(test|testing|fixtures)\/|\/fake-[^/]+\.[cm]?js$|\.d\.ts$)/.test(path);
}

function hasRuntime(path) {
  const text = readFileSync(path, 'utf8');
  if (!/\.tsx?$/.test(path)) return true;
  const emitted = transformSync(text, { loader: path.endsWith('.tsx') ? 'tsx' : 'ts', format: 'esm', legalComments: 'none' }).code.trim();
  return emitted !== '' && emitted !== 'export {};';
}

export function coverageFailures(changes, coverage, root = process.cwd(), threshold = 80) {
  const failures = [];
  for (const [path, lines] of changes) {
    if (!lines.size || !productionFile(path) || !existsSync(resolve(root, path))) continue;
    const report = coverage[resolve(root, path)];
    if (!report) { if (hasRuntime(resolve(root, path))) failures.push(`${path}: missing coverage`); continue; }
    const touches = loc => loc && [...lines].some(line => line >= loc.start.line && line <= loc.end.line);
    const statements = Object.entries(report.statementMap).filter(([, loc]) => touches(loc)).map(([id]) => report.s[id]);
    const branches = Object.entries(report.branchMap).filter(([, branch]) => touches(branch.loc)).flatMap(([id]) => report.b[id]);
    for (const [kind, counts] of [['statements', statements], ['branches', branches]]) {
      if (!counts.length) continue;
      const covered = counts.filter(count => count > 0).length;
      if (covered * 100 < threshold * counts.length) failures.push(`${path}: changed ${kind} ${covered}/${counts.length} below ${threshold}%`);
    }
  }
  return failures;
}

/** Package suites may cover the same helper. Merge hits by location, never overwrite. */
export function mergeCoverage(reports) {
  const merged = {};
  for (const report of reports) for (const [path, data] of Object.entries(report)) {
    const target = merged[path] ??= { statementMap: {}, s: {}, branchMap: {}, b: {} };
    for (const [id, loc] of Object.entries(data.statementMap)) {
      const key = JSON.stringify(loc);
      target.statementMap[key] = loc;
      target.s[key] = (target.s[key] ?? 0) + data.s[id];
    }
    for (const [id, branch] of Object.entries(data.branchMap)) {
      const key = JSON.stringify(branch);
      target.branchMap[key] = branch;
      const counts = target.b[key] ??= [];
      data.b[id].forEach((count, index) => { counts[index] = (counts[index] ?? 0) + count; });
    }
  }
  return merged;
}

export function runVerification(args, env, io = { execute: execFileSync, read: readFileSync, log: console.log, error: console.error }) {
  const configured = env.CI_BASE_SHA;
  const base = !configured || /^0+$/.test(configured) ? 'HEAD^' : configured;
  // Bundled plugin artifacts can make even a zero-context patch exceed Node's
  // default 1 MiB capture limit. Keep a deliberate cap and fail on overflow.
  const diff = io.execute('git', ['diff', '--no-renames', '--unified=0', base, 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const changes = changedLines(diff);
  if (args.includes('--coverage')) {
    const reports = [];
    for (const file of args.filter(arg => !arg.startsWith('--'))) {
      reports.push(JSON.parse(io.read(file, 'utf8')));
    }
    const failures = coverageFailures(changes, mergeCoverage(reports));
    if (failures.length) { io.error(failures.join('\n')); return 1; }
    io.log('Changed production statements and branches meet the 80% coverage floor.');
  } else {
    const specs = boundarySpecs([...changes.keys()]);
    if (specs.length) io.execute('pnpm', ['test:e2e', '--', ...specs], { stdio: 'inherit' });
    else io.log('No Electron production boundary changed.');
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = runVerification(process.argv.slice(2), process.env);
