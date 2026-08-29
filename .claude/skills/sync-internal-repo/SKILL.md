---
name: sync-internal-repo
description: Mirror github.com/salesforce/zana onto the Salesforce-internal git.soma clone, keeping that clone's README.md. Use when the user wants to sync with the original/internal repo, git.soma, chatbots/zana-command-center, or the legacy remote.
disable-model-invocation: true
---

# Sync internal repo

Push this public tree to **https://git.soma.salesforce.com/chatbots/zana-command-center**, except `README.md` (the internal “do not develop here” banner).

GitHub.com/salesforce/zana is the product source. git.soma is a copy.

## Do this

1. Confirm Salesforce VPN (or other git.soma access). This checkout already has remote `legacy` pointing at that URL.
2. Do **not** invent a merge or copy files by hand. Run the script from the repo root.
3. Default source is `origin/main` (or `HEAD` if that ref is missing). To mirror the current commit: `SOURCE_REF=HEAD`.
4. Dry-run first unless the user asked to push immediately:

```bash
DRY_RUN=1 bash scripts/sync-internal-mirror.sh
```

5. If that looks right, push:

```bash
bash scripts/sync-internal-mirror.sh
```

The script uses a temp index (`GIT_INDEX_FILE`); it does not dirty the working tree.

## Env (optional)

| Variable | Meaning |
| --- | --- |
| `SOURCE_REF` | Commit-ish to copy |
| `INTERNAL_URL` | Defaults to the git.soma URL above |
| `INTERNAL_REMOTE` | Tracking name, default `legacy` |
| `INTERNAL_BRANCH` | Default `main` |
| `SOMA_GIT_TOKEN` | PAT for HTTPS if `gh`/netrc is not enough |
| `DRY_RUN=1` or `PUSH=0` | Build the commit, do not push |

## Afterward

Tell the user the source SHA, whether git.soma was already in sync, or the new internal commit SHA that was pushed. If fetch/push fails, it is almost always VPN or git.soma credentials — do not fall back to rewriting README or force-pushing.
