// Global test setup — runs once per test worker (vitest forks pool, isolate),
// before any test file.
//
// SCRUB INHERITED GIT_* REPO-CONTEXT VARS. When `npm test` runs under this
// repo's pre-push hook, git exports GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE /
// GIT_COMMON_DIR / GIT_PREFIX into the environment of the hook (and therefore
// into these workers). Those vars OVERRIDE an explicit `cwd`, so any test — or
// any production code under test (src/main/git.ts spawns git inheriting
// process.env) — that runs `git init` / `git commit` against a temp repo would
// instead operate on the OUTER repo, landing a stray tree-deleting "init"
// commit on whatever branch is being pushed. This actually happened (see the
// git-env-leak regression). Scrubbing here is the ONE defense that covers every
// current AND future git-spawning test, so no individual test file has to
// remember the guard. Individual suites still pin a deterministic identity via
// their own cleanGitEnv(); this only removes the dangerous repo-context vars.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}
