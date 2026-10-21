# Native runtime and Electron test isolation

SQLite failures were caused by two runtimes replacing the same `better_sqlite3.node`:
an Electron test restored Node's ABI while another Electron app was starting.
Independent builds also emptied `out/renderer`, and Playwright runs cleared each
other's traces. None of those operations should be part of a running test's lifecycle.

## What owns each resource

| Resource | Owner and lifetime |
| --- | --- |
| SQLite ABI cache | Dependency version + platform + architecture + ABI; verified in a fresh target-runtime child before atomic publication |
| Native compilation | Unique temporary source copy, removed on success or failure; never the installed package |
| Installed default SQLite binary | Node tooling; only Node preparation repairs a legacy incompatible default |
| Product connections | `createSqliteDatabase` selects their runtime's cache through the documented `nativeBinding` option; packaged apps fall back to their packaged addon |
| Production build | `pnpm build`; build/dev preparation and snapshot copying share an interprocess lock |
| Dev output | `out-dev/`, separate from production builds; Electron dev explicitly launches that entry |
| Electron E2E app | Private `zcc-electron-test-*` directory, with copied output/resources/plugins/CLI/native packages; removed at teardown |
| Playwright results | `e2e/.artifacts/runs/<run-id>`; retain 20 completed runs and never prune active runs |
| Test settings | Per-test temporary home; bootstrap sets Electron's home before loading application code |
| Claude in deterministic tests | `claudeBinary` defaults to a failing local fixture and the test PATH intercepts bare `claude` (including automatic `doctor` health checks); explicit fake binary paths and `seedClaudeAuth` live tests retain their overrides |

The lock uses heartbeat updates and stale-lock recovery. Failed builds leave an
incomplete marker; `test:e2e:only` refuses them with a specific rebuild instruction.
Copying uses filesystem clone support where available and ordinary copies elsewhere.
Ordinary JavaScript dependencies remain shared; dependency installation itself must
not be run concurrently with tests that depend on the changing dependency tree.

## Commands

```sh
pnpm test:e2e -- e2e/runtime-isolation.spec.ts   # private build and test
pnpm test:e2e:only -- e2e/smoke.spec.ts         # private snapshot of out/
pnpm rebuild:electron                          # warm/verify cache, no ABI flip
pnpm test                                     # Node tests remain usable
```

Direct `playwright test` runs the same global setup. The wrapper invokes the
installed Playwright CLI with the current Node executable, without an extra
package-manager process or a destructive “restore ABI” finally block.

## Pre-push verification

Pre-push runs from a detached snapshot of pushed commit. Inert prose changes
skip checks. Feature branches reuse installed dependencies when dependency inputs
are unchanged, then typecheck and run related tests for source and unit-test
changes concurrently (broad changed-test selection only for runner configuration
changes). Every source-text guard test still runs. A force-push (rebase or
squash) is measured against `origin/main`'s merge base like a new branch. A tree
that already passed locally (same tree hash, same base) is not re-verified;
stamps live in `.git/pre-push-verified`. Protected refs and unsafe push shapes
run `full`. CI remains merge authority and always runs full unit and affected
E2E suites.

The snapshot is a cached clone when one is free. Each repository keeps up to two
per Node ABI, platform, and architecture under the user cache directory
(`~/Library/Caches/zana-pre-push` on macOS), each held under an exclusive lock.
A cached clone keeps only its `node_modules`, so its native builds never touch the
main checkout. Git hooks never run in any snapshot: every snapshot Git command
points `core.hooksPath` at an empty temporary directory from the command line,
which outranks `.git/hooks` and any repository config. Before verifying, the hook
requires the clone's `.git` to be its own directory, removes every local config
key a clone does not write itself (worktree redirects, filters, includes,
fsmonitor) and `.git/info`, requires no replacement refs, rewrites
every tracked file from the pushed commit (dropping the index first, so an edit
that kept a file's size and mtime cannot survive), removes everything else
untracked or ignored, and requires HEAD to match, no index entry to hide changes,
and a clean status. Any failure discards that clone and uses a fresh one, as does
finding that a racing push took the clone's lock. Kept `node_modules` are trusted only while the lockfile, workspace
file, `.npmrc`, and every `package.json` match the last successful install in that
clone; otherwise they are removed first. A failed install retries once from empty
`node_modules`, and a second failure fails the push. Set
`ZANA_PREPUSH_FRESH_SNAPSHOT=1` to always use a fresh clone,
`ZANA_PREPUSH_CACHE_DIR` to move the cache, and `ZANA_PREPUSH_TIMING=1` to log
each phase's duration.

For SSH connection backstop, add this to SSH config used by
`github.com-work-public`:

```sshconfig
Host github.com-work-public
  ServerAliveInterval 30
```

## Regression checks

- `scripts/sqlite-preparation.test.ts`: concurrent real Node/Electron probes,
  unchanged installed-addon checksum, corrupt cache recovery, private compilation,
  no publication after failed verification, cleanup after failure.
- `scripts/sqlite-probes.test.ts`: compiler/loader/timeout failures and bounded probes.
- `scripts/electron-build-workspace.test.ts`: serialized preparation, failed-build
  detection, independent runtime copies surviving source-output deletion, cleanup.
- `scripts/e2e-artifacts.test.ts`: completed-run retention preserves active traces.
- `scripts/e2e-app-config.test.ts` and `e2e/credential-isolation.spec.ts`: isolated test homes never discover a real Claude CLI for background micro-calls; explicit fake and live-test configuration is preserved.
- `packages/db/src/native-binding.test.ts`: runtime/dependency selection and real SQL.
- `e2e/runtime-isolation.spec.ts`: built Electron opens Library, reloads, and reads
  its document while both native preparation commands run; test home and installed
  binary checksum remain unchanged.

The implementation uses [better-sqlite3's nativeBinding option](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#new-databasepath-options)
and [proper-lockfile's heartbeat lock](https://github.com/moxystudio/node-proper-lockfile).

## Verification on 2026-09-20

- Focused product tests: 106 passed, including plugin database migrations, runtime
  storage and Library reads. Isolation suite: 36 passed; 97.15% statements and
  91.42% branches across the native preparation, runtime workspace and runner code.
- Production build and root TypeScript check passed. Generated main JavaScript is
  now syntax-checked after every production build; this caught and prevented a
  CommonJS shim/name collision that TypeScript alone did not detect.
- Two concurrent Playwright invocations passed (built-Electron smoke and Library
  reload during native preparation), with distinct app and result directories.
  The Library regression also passed through direct Playwright invocation.
- Real cold native compilations for Node ABI 137 and Electron ABI 148 both opened
  a database successfully and left the installed addon's checksum unchanged.
- The development output and explicit Electron launch entry both resolve to
  `out-dev/main`. The remote host join artifact also builds successfully.
- The repository-wide E2E TypeScript check still reports unrelated existing
  errors in older specs; it is not used as evidence of a clean full E2E suite.
