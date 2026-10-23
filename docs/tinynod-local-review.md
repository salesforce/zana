# Optional local TinyNod review (authorized internal developers)

TinyNod is an optional, local-only AI review of your committed changes, run automatically by `git push`. It is for authorized internal developers only. It is advisory: findings print and never change the push's exit code, and public CI never runs it (CI has no TinyNod job). No desktop app, Postgres, or Electron is required.

Contents: [Quick start](#quick-start) · [Set up TinyNod](#set-up-tinynod) · [Opt in and out](#opt-in-and-out) · [Read the results](#read-the-results) · [Have an AI fix the findings](#have-an-ai-fix-the-findings) · [Troubleshooting](#troubleshooting) · [Agents](#agents) · [Data policy](#data-policy)

## Quick start

```bash
# 1. Install TinyNod (see "Install" below), then confirm: tinynod --version  (2.5.0 or newer)
# 2. Store a gateway key and a full model id (see the DevBar/AI Suite or manual path below)
# 3. Opt in for this clone and all its worktrees
git config --local zana.tinynod.enabled true
# 4. Push as usual; the review runs alongside Zana's own verification
git push
```

You will see one line at the end of pre-push, for example `pre-push: tinynod review (advisory) clean: no findings`.

## Set up TinyNod

TinyNod is the standalone CLI flavor of CodeNod. The CodeNod homepage, which has the current install instructions and releases, is <https://git.soma.salesforce.com/cc-oms/pr-reviewer> (see its "tinynod (standalone CLI)" section).

### Install

Pick one (all documented on the CodeNod homepage):

- **macOS `.pkg`**: download `Tinynod-<version>-arm64.pkg` (Apple Silicon) or `-x64.pkg` (Intel) from the [latest release](https://git.soma.salesforce.com/cc-oms/pr-reviewer/releases) and run it. It installs `/usr/local/bin/tinynod`.
- **npm (Node 20+)**: `npm install -g @cc-oms/tinynod`
- **curl installer (macOS/Linux)**: `bash <(curl -sSL https://pages.git.soma.salesforce.com/cc-oms/pr-reviewer/install-tinynod.sh)` installs `~/.local/bin/tinynod`; make sure that directory is on your `PATH`.

Check it: `command -v tinynod && tinynod --version`. The minimum supported version is **2.5.0** (tested: 2.5.0). Older versions are skipped by the automatic review. Do not run `tinynod hooks install` and do not change global `core.hooksPath`: Zana owns `.githooks`.

### Configure credentials

TinyNod needs two things in `~/.tinynod/config.json`: a gateway **API key** and a **full model id**. Secrets stay outside the Zana tree; never paste a secret into chat or commit it.

**Step 1, if the CodeNod desktop app is installed and running:** import its settings first.

```bash
tinynod config import --from-app
```

This pulls repo settings, review instructions, suppression rules, and model/mode, so you do not re-enter them. The CodeNod export carries **no API key**, so it does not complete credential setup: do step 2 afterwards. Import first, then set the key and model, so your explicit values are the last write. Skip this step if CodeNod is not running.

**Step 2:** store a key and a full model id (Path A or B).

#### Path A: you have DevBar / AI Suite

Your Claude settings (`~/.claude/settings.json`) use an `apiKeyHelper` (`devbar auth claude`) rather than a plain token. TinyNod 2.5.0 does not run an `apiKeyHelper`, and `config import --from-claude` copies a key only from a raw `env.ANTHROPIC_AUTH_TOKEN`, so the import stores no key. Mint one yourself and store it:

```bash
tinynod config set ai.apiKey "$('/Applications/devbar.app/Contents/MacOS/devbar' auth claude)"
tinynod config set ai.model claude-opus-5-5
tinynod config show        # redacted; confirm a key is present and the model is a full id
```

Notes:

- The minted token can be short-lived. If reviews start reporting auth errors, run the first command again.
- If you ever run `tinynod config import --from-claude`, re-check `ai.model` afterwards: it can overwrite it with an alias such as `opus`, which the gateway rejects (see [Troubleshooting](#troubleshooting)).

#### Path B: no DevBar / AI Suite

Use whichever applies:

- **Interactive**: `tinynod config init` (the `API key:` prompt is clear text; run it privately).
- **Direct**: `tinynod config set ai.apiKey <key>` and `tinynod config set ai.model <full-model-id>`.
- **From Claude settings**: if your `~/.claude/settings.json` has a raw `env.ANTHROPIC_AUTH_TOKEN`, `tinynod config import --from-claude` copies it. Then check `ai.model` (see above).

Get a gateway key and the list of allowed model ids from your team's AI gateway onboarding (the same access CodeNod uses). `tinynod models` lists models the gateway offers.

An existing `ai.apiKey` is kept over an imported one, so a stale key needs an explicit `config set`.

#### Verify before you push

```bash
tinynod config show                    # key present? model is a full id?
git fetch origin
tinynod review --base origin/main      # manual run; add --format json for JSON
```

A manual review covers the **committed** HEAD of the current checkout against its merge-base with the base. Uncommitted and untracked changes are never included.

Optional: `tinynod config set defaults.baseBranch origin/main` and `tinynod config set defaults.failOnSeverity <level>`. (`defaults.severityThreshold` is stored but not read by the engine; it is not a filter.)

## Opt in and out

The review is **off by default**. It runs only when you opt in and a `tinynod` 2.5.0+ is on `PATH`; otherwise only TinyNod is skipped and Zana's checks still run.

| Goal | Command |
| :--- | :--- |
| Opt in, this clone and all its worktrees | `git config --local zana.tinynod.enabled true` |
| Opt in, every Zana clone | `git config --global zana.tinynod.enabled true` |
| Opt out | `git config --local zana.tinynod.enabled false` (or `--unset zana.tinynod.enabled`) |
| One push on / off | `ZANA_TINYNOD_REVIEW=1 git push` / `ZANA_TINYNOD_REVIEW=0 git push` (`true`/`false` also work) |
| Skip TinyNod for one push | `TINYNOD_SKIP_HOOK=1 git push` (`1` or `true`) |

- Precedence: `TINYNOD_SKIP_HOOK` > `ZANA_TINYNOD_REVIEW` > git config. An invalid git value means off plus a warning.
- Worktrees of one clone share a single `.git/config`, so `--local` applies to all of them.
- Opt-in is read from your original checkout, not from the isolated snapshot that verification runs in.
- `TINYNOD_SKIP_HOOK` skips TinyNod only; Zana verification still runs. It is separate from any broader pre-hook skip permission, which is not a TinyNod bypass.
- Review is also skipped, with a logged reason, for protected refs, multi-ref pushes, unverified remotes, and docs-only pushes.

## Read the results

The review runs in the background while Zana verification runs, with a 300 s budget, and prints one summary line when it finishes. It is **advisory**: the push proceeds regardless.

| Status | Meaning | What to do |
| :--- | :--- | :--- |
| `clean` | Review ran, no findings. | Nothing. |
| `findings` | Findings printed, each with severity, file, and line. | Fix them or decide they are acceptable. |
| `partial` | Only part of the diff was reviewed (too large). | Treat as incomplete; review the rest manually. |
| `no_changes` | Nothing to review against the base. | Nothing. |
| `warning` | The review did **not** produce a result (never a clean review). Reasons: `spawn_error`, `too_large`, `timeout`, `unparseable`, `review_error`, `unknown_shape`. | Read the message; see [Troubleshooting](#troubleshooting). Re-run manually if useful. |

Exit codes are never used to classify results; the parsed JSON is. To reproduce a review by hand with the same base the hook used:

```bash
tinynod review --base <base-sha> --format json | jq '.comments'
```

The hook prints the exact command for a timeout. Reviews are saved locally under `~/.tinynod/history/` (0600); Zana keeps the newest 50 of its own reviews (plus a ledger at `<git-common-dir>/zana-tinynod-history.json`) and never touches other history. A `<git-common-dir>/zana-tinynod-review.lock` directory prevents concurrent reviews in one clone; a stale lock from a dead process is reclaimed automatically.

## Have an AI fix the findings

Ask your coding agent to do the read-summarize-fix loop. Example prompt (paste into Claude Code, Zana, or similar in the checkout you pushed from):

```text
Run `git fetch origin && tinynod review --base origin/main --format json` and read the result.
Summarize the findings grouped by severity (file:line, one line each, say whether you think
each is a real bug or a false positive and why). Then fix the real ones with minimal changes,
add or update tests, run `pnpm typecheck` and the relevant tests, and show me the diff.
Do not commit or push. Do not use TINYNOD_SKIP_HOOK, and do not edit the TinyNod config.
List anything you judged a false positive so I can decide.
```

Tips:

- Re-run `tinynod review` after the fixes; it only covers **committed** changes, so commit (or amend) first, then re-run.
- An agent should report honestly: a skipped, failed, or timed-out review is a warning, never "reviewed by TinyNod". See [Agents](#agents).
- To reuse a review the hook already ran, point the agent at the newest `*-review.json` / `*-comments.json` under `~/.tinynod/history/`.

## Troubleshooting

| Symptom | Cause and fix |
| :--- | :--- |
| `no AI API key configured` | No `ai.apiKey` in the config TinyNod is reading. Set one (Path A/B above). Also check `TINYNOD_HOME`: if set, config lives in `$TINYNOD_HOME/config.json`, otherwise `~/.tinynod/config.json`; make sure the `git push` environment sees the same value as your shell. `--from-app` and, for DevBar/AI Suite users, `--from-claude` store no key. |
| `Access denied. You may need additional permissions or VPN` | Most often a wrong model, not the network. `ai.model` set to an alias such as `opus` is rejected by the gateway: run `tinynod config set ai.model claude-opus-5-5` (or another full id from `tinynod models`). If the model is fine, check VPN and that your key is current. |
| Auth/401 errors after previously working | A minted token expired. DevBar/AI Suite: re-run the `config set ai.apiKey "$(devbar auth claude)"` command. |
| `tinynod` not found / `spawn_error` | Not on `PATH` for the hook. `command -v tinynod`; for the curl install, add `~/.local/bin` to `PATH` (in a shell startup file, since git hooks use your login environment). |
| Review skipped: version | `tinynod --version` is below 2.5.0. Upgrade. |
| `timeout` | Over the 300 s budget. Run the printed `tinynod review --base <sha> --format json` manually. |
| `too_large` / `partial` | Diff exceeded output or size caps. Push smaller changes or review manually in pieces. |
| `unparseable` / `unknown_shape` | TinyNod printed something other than the expected JSON (often a log line or an error). Run the same command by hand and read the output. |
| No review line at all | You are not opted in, `TINYNOD_SKIP_HOOK` is set, or the push shape (protected ref, multi-ref, unverified remote) was skipped. The hook logs the reason. Check `git config --get zana.tinynod.enabled`. |
| Reviewing a private-remote clone | The review runs in an isolated snapshot; Zana maps the snapshot's origin back to your real `origin` so TinyNod identifies the right repo. If findings reference the wrong repo, check `git remote get-url origin`. |

Handy checks: `command -v tinynod`, `tinynod --version`, `tinynod config show` (redacted), `tinynod models`. The gateway endpoint is overridden only via the `SALESFORCE_CLAUDE_ENDPOINT` environment variable, not the config file; the default is already the internal gateway.

Try it with no key and no cost: `TINYNOD_HOME=$(mktemp -d) tinynod config set ai.mode mock` then run the hook with that `TINYNOD_HOME` exported. Mock mode returns canned `MOCK:` findings and is for testing the plumbing only.

## Agents

See the TinyNod section in [`AGENTS.md`](../AGENTS.md). In short: report the skip/review reason, base, head, and which Zana checks ran; never claim a review happened when it was skipped; never use `TINYNOD_SKIP_HOOK` to hide findings.

## Data policy

Local review sends the outgoing diff to the AI gateway; public CI performs no such transfer.

When enabled, pre-push runs `tinynod review`, which sends HTTPS requests to the internal Salesforce model gateway (default) or the endpoint in `SALESFORCE_CLAUDE_ENDPOINT`. Each request contains a fixed system prompt, the line-annotated diff of the pushed commit against its merge-base (no whole-file contents), each changed file's path and line counts, the absolute path of the review checkout, the branch name, base ref and merge-base SHA, and review instructions or suppression rules from your local TinyNod config; `.md` diffs are repeated as requirements context. Your API key is sent as a bearer token. No commit messages, author names or emails, hostname, GitHub, GUS, code-search, or telemetry calls. Results are written locally under `~/.tinynod/history/` (0600). Public CI never runs this review.
