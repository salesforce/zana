Start a thread, pick Codex, and let it write and review code in your repository from ZCC. The plugin drives the Codex CLI on the host machine. It streams the agent's work into the ZCC timeline.

## What you get

- Permission modes `accept-edits`, `auto`, and `full`, plus plan and goal actions in the composer.
- Reasoning levels from Low to Ultra. Ultra adds automatic task delegation.
- A service tier picker with two tiers.
- Checkpoint forks, manual compaction, thread rename, and thread archive.
- Codex skills from your home directory and project, listed next to ZCC skills.
- Health, usage, and install status on each host, with an install or update action.
- A Codex AI service for inference and voice that other ZCC features can use.

## Settings

- `Codex memory`: let Codex recall and create memories from ZCC threads.
- `Disable provider subagents`: stop native subagents so the agent delegates through ZCC.

## Hooks and trust

ZCC wires its lifecycle hooks into each Codex session as config overrides in Codex's
session-flags layer — no change is written to your `~/.codex/config.toml`. Codex discovers
hooks from every config layer (your user config, the project `.codex`, this session layer,
and any managed/enterprise layers) and runs them together; ZCC's hooks are added alongside
yours, never in place of them.

Because a session-injected hook is untrusted by Codex until its content hash is trusted,
ZCC currently launches Codex with `--dangerously-bypass-hook-trust` so its own hooks run.
Be aware this flag is global for that launch: it also skips Codex's trust prompt for any
enabled hook in your user or project config during a ZCC-launched session. If you keep
untrusted hooks in those files, they will run in ZCC Codex sessions. Scoped trust — where
ZCC trusts only its own hooks and this bypass flag is removed — is planned.

## Requirements

- Install the Codex CLI (`codex`) on the host machine, version 0.136.0 or newer. The plugin can run the npm install for you.
- Sign in with `codex login` on that machine. A ChatGPT account or an OpenAI API key both work.
- Usage limits show only for ChatGPT accounts.
