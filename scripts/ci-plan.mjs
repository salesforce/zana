import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundarySpecs } from './ci-boundaries.mjs';
import { balancedShards, testDurations } from './ci-shards.mjs';

/** Include shared startup, filesystem and rendering dependencies, not just the spec. */
export function previewAffected(paths) {
  return paths.some(path => /^(apps\/(desktop|host-daemon)\/|apps\/server\/src\/(http\/|plugins\/|services\/(projects|threads|hosts)\/|[^/]+\.[cm]?[jt]s$)|packages\/|apps\/app\/src\/(App\.|main\.|store\.|thread-store\.|styles\/|lib\/|hooks\/|plugins\/|components\/thread\/|views\/(thread|project))|e2e\/fixtures\/|e2e\/thread-file-preview|scripts\/.*(build|electron|ensure|ci-)|\.github\/(workflows|actions)\/|package\.json$|pnpm-(lock\.yaml|workspace\.yaml)$|electron\.|playwright\.config)/.test(path)
    || /(?:preview|markdown|filesystem|file-url|file-path|path-confinement)/i.test(path));
}

export function planVerification(paths, forcePreview = false) {
  const specs = boundarySpecs(paths);
  const shards = balancedShards(specs, 3, path => path, path => testDurations.e2e[path] ?? 60_000);
  const active = shards.flatMap((files, index) => files.length ? [index + 1] : []);
  return { preview: forcePreview || previewAffected(paths), e2e: specs.length > 0, e2e_matrix: active.length ? active : [1] };
}

export function runPlan(env, io = { execute: execFileSync, append: appendFileSync, log: console.log }) {
  const base = !env.CI_BASE_SHA || /^0+$/.test(env.CI_BASE_SHA) ? 'HEAD^' : env.CI_BASE_SHA;
  const paths = io.execute('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
  const plan = planVerification(paths, env.CI_FORCE_PREVIEW === 'true');
  io.log(JSON.stringify(plan));
  for (const [key, value] of Object.entries(plan)) io.append(env.GITHUB_OUTPUT, `${key}=${JSON.stringify(value)}\n`);
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runPlan(process.env);
