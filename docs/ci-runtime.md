# CI runtime and test selection

CI keeps typecheck, every root unit test, package tests, Postgres and the changed-code coverage floor mandatory. A Node-only planning job selects production-boundary work before installing Electron dependencies.

The file-preview matrix runs on Linux, Windows, ARM Mac and Intel Mac when shared startup, native, filesystem, preview/rendering, dependency or distribution code changes. Manual workflow runs force the matrix. The conservative ownership rules are in `scripts/ci-plan.mjs`; update their tests when adding a new preview dependency. Unrelated documentation, website and plugin feature changes do not need four desktop builds. The final required check accepts a skipped job only when successful planning explicitly said it was unnecessary.

The three affected-boundary Linux shards consume one same-run production build. The archive includes `out`, generated plugins and resources, CLI and plugin SDK distributions, and host-daemon distributions. It excludes dependency directories. Each runner installs its own dependencies and uses `test:e2e:only`, which validates build completeness and creates its own private runtime/native snapshot. No test shares a mutable app, home or installed SQLite addon. Cross-platform builds remain native to their OS and architecture.

Electron downloads and the existing ABI-specific SQLite cache are cached separately by OS, architecture, Node version, lockfile and binding implementation. Installed native package directories are never cached by this action. The binding loader still probes cached binaries before using them.

`scripts/ci-test-durations.json` records successful test durations from Actions run 40960457130. Longest-first packing spreads slow files across shards. Root unit projects are balanced separately, preserving Vitest's parallel-then-serial execution and normal sorting. Small or new root files use 500ms plus a 500ms per-file overhead; unknown Electron specs use 60 seconds. Whole Electron specs stay together. Empty shards do not build or provision runners.

Refresh timing estimates from successful hosted runs when workloads change substantially; do not record timeout/retry durations as normal test cost. The initial timing replay reduced the serial test workload spread from 19–152 seconds to 93–99 seconds. This is a replay of test durations, not a hosted wall-clock benchmark: imports, instrumentation, startup and artifact transfer still contribute.

Focused verification:

```sh
pnpm exec vitest run scripts/ci-verification.test.ts scripts/ci-plan.test.ts scripts/ci-shards.test.ts scripts/vitest-project-sets.test.ts scripts/release-workflow.test.ts
pnpm test:e2e -- e2e/mobile-plugin-audit.spec.ts e2e/thread-file-preview-ambiguity.spec.ts
pnpm verify:fast
```
