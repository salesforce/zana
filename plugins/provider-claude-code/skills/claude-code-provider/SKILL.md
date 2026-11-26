---
name: claude-code-provider
description: "Configure or troubleshoot ZCC-specific Claude Code provider settings and session behavior."
---

# Claude Code provider

Read and change declared settings in Plugins → Claude Code provider → Settings.
Use `zcc thread show <id> --json` to inspect a thread and `zcc guide threads` for
the CLI operations available in this build.

- `sandboxEnabled` defaults to `true`. Zana supplies Claude Code's Bash sandbox
  in Accept Edits and Approve for me modes. Turning it off removes Zana's sandbox
  override and uses Claude Code's own command approvals and sandbox settings;
  it does not force Claude's own sandbox off or select Full Access. Changes
  restart the Claude process on the next turn, preserving the conversation.
- `idleQueryReleaseEnabled` defaults to `false`. When enabled, the native process
  closes after 30 seconds of quiescence while the ZCC thread remains resumable.
  Changes apply on the next start, resume, or turn.
- `chromeEnabled` defaults to `false`. It starts Claude Code with `--chrome` for
  Claude in Chrome tools. The host needs the extension and a claude.ai login.
  A change restarts the thread's Claude process before its next turn, preserving
  context.
- Structured plan, message editing, and compaction are supported through the
  thread’s supported controls. Unlisted model IDs are accepted by the
  provider; verify actual availability on the target host.

Inspect the thread and provider state after a change; do not restart unrelated
threads or change settings merely to answer a question.
