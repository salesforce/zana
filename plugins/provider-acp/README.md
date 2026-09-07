# ACP providers

First-party plugin for ACP (Agent Client Protocol) agent providers — phase 4
of `plans/agent-provider-plugin-surface.md`.

Today this plugin registers `acp-cursor` (Cursor), `acp-opencode` (OpenCode),
`acp-omp`, `acp-grok`, and `acp-hermes-agent`. Custom ACP agents are configured
from the plugin's `customAgents` JSON setting (not a global `customAcpAgents`
key in `~/.zcc/config.json`).

**Provider posture:** ACP is the default generic path for third-party agents.
Native Claude Code (`provider-claude-code`) and Codex (`provider-codex`)
plugins stay in-tree as optional first-party bridges — they are not replaced
by ACP-only, and they are not required for ACP agents. Do not port BB Connect,
tunnel, or mobile-bridge; ZCC remote access is website relay pairing
(`website/relay`) plus enrolled host daemons (Settings → Machines).
