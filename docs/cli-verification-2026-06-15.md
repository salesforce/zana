# zcc CLI Verification Report — 2026-06-15

Three-agent fan-out verification of `packages/cli` (`@zcc/cli`) across **correctness/working**, **design quality**, and **security**. Read-only review + empirical run; no code modified.

## Overall verdict

**The CLI is correct, working, and well-designed.** It builds clean, the full test suite passes, the binary behaves to its documented contract, and the security model is sound (untrusted CLI, main authorizes). Ship-worthy as-is. There is **one Major correctness bug** worth fixing before it bites someone, plus a handful of minor polish items.

| Dimension | Verdict |
|---|---|
| Correct & working | ✅ **WORKING** — build clean, 34/34 tests pass, exit-code contract verified |
| Design quality | 🟡 **Acceptable-with-fixes** — clean testable design; 2 Major (one root cause) |
| Security | ✅ **PASS** — no Critical/High; trust boundary correctly placed in main |

## 1. Correct & working (empirical)

- **Build:** `npm run build` (tsc) clean, exit 0, zero errors.
- **Tests:** `vitest run` — **34/34 passed**, 3 files, ~10.7s.
- **Exit-code contract** (0 success · 1 error · 2 bad usage · 3 not-found/ambiguous · 124 wait-timeout) verified by running the binary. Codes 4 (RESOURCE_LIMIT) and 5 (FORBIDDEN_AGENT) are mapped in `exitCodeForControl` but only reachable with a live control plane.
- **File-backed reads** against a synthetic `--data-dir`: projects (v0 array + v1 `{version,projects}`), personas, schedules, inbox JSONL all render; malformed input degrades gracefully (per-line/entry warnings to **stderr**, exit 0, never throws); every `--json` output re-parses as valid JSON.
- **Precedence** flag > env > default and the legacy `~/.cc-center` fallback confirmed; adversarial arg-parsing (value-less `--data-dir`, `--json` positioned anywhere, `--data-dir=` equals-form, `run proj -- ... --wait` literal) handled.

## 2. Design quality

Clean, genuinely testable: pure `runCli` returning `{exitCode, stdout, stderr}`, no mid-logic `process.exit`, honors the "never throw / warnings to stderr" contract. Dispatch coverage matches the help table exactly; exit-code mapping agrees with the documented contract; defensive reads verified.

## 3. Security

**Trust boundary correctly placed in main, not the CLI** — exactly per CLAUDE.md rule 1.

- The **`ZCC_SESSION_ID` agent-caller gate** (the prime suspect) is **enforced in main**: `control-plane.ts` `classifyCaller()` → `authorizeRequest()` refuses any op outside the read-only `AGENT_ALLOWED_OPS` allow-list with `FORBIDDEN_AGENT`. The CLI merely forwards the marker (`control-client.ts:88`) and correctly does **not** gate locally (renderer-side checks are advisory).
- **Control-socket auth** sound: per-boot nonce token, `0600`/`0700`, atomic create, SHA-256 + `timingSafeEqual` constant-time compare, AF_UNIX (closes CSRF/rebinding).
- **`term.create`** is structured IPC, no shell injection; main realpath-confines `cwd` to the project root, allow-lists `profile`, length-caps `prompt` (32KB).
- Documented same-uid limitation (a hostile agent can `unset ZCC_SESSION_ID`) is inherent and acceptable for v1.

---

## Findings (prioritized, for follow-up)

### Major

- **M1 — `--data-dir` / `--json` are stripped from the whole argv before `run`'s `--` sentinel split.** `extractDataDir` (`run-cli.ts:78`) and the `--json` filter (`:92`) scan the entire vector, but the `--` split only happens later in `runCommand` (`:366`). So `zcc run api -- explain the --json output` loses the literal `--json` from the prompt and flips on JSON mode; `zcc run api -- ... --data-dir X` silently repoints the data dir. The existing test `run-command.test.ts:80` actually encodes the buggy behavior. **Fix:** do the global-flag vs `--`-tail split once at the top level; one fix covers both. *(M2 in the design review is the `--json` half of the same root cause.)*

### Minor (non-blocking)

- `inbox show` with no id returns exit **1**, not **2** — lone outlier vs every other missing-arg path (`run-cli.ts:109`).
- `run` usage errors (`--wait`+`--detach`, bad `--timeout`) are masked by `APP_NOT_RUNNING` (exit 1) when the app is down, since validation is gated behind `isAppRunning` (`run-cli.ts:361`).
- Value-less `--data-dir` (e.g. `--data-dir --json`) is silently dropped → falls back to env/default with no error.
- `flagValue` returns `''` for `--profile=`; the `?? 'claude'` default only catches `undefined`, so an empty profile reaches `term.create` (`run-cli.ts:374`).
- `parseDuration` accepts `0s`/`0ms` → `timeoutMs=0` → `--wait` exits 124 immediately without polling once.
- `resolveProject` prefix match is name-only; a unique id/tag *prefix* won't resolve though the doc implies it should (`run-cli.ts:466`).
- **Security (defensive, Medium):** `dataDir` and the token-file `socket` field are not realpath-confined to `$HOME`/a known base. Caller-controls-own-input (bounded by the caller's own FS perms, no cross-user escalation), so not exploitable in the normal model — but worth confining or explicitly documenting `--data-dir` as caller-trusted. Also consider validating the control-plane response shape before casting (`control-client.ts:129`).

### Nits

- `detach` is dead outside the mutual-exclusion check; `runCommand` duplicates the APP_NOT_RUNNING string; unused `ScheduledTask`/`InboxEntry` imports (`run-cli.ts:9`).
- Help wording could clarify the agent gate is a read-only **allow-list**, not a mutating/non-mutating heuristic.
