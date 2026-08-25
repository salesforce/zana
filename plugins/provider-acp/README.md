# ACP providers

First-party plugin for ACP (Agent Client Protocol) agent providers — phase 4
of `plans/agent-provider-plugin-surface.md`.

Today this plugin registers the `acp-cursor` (Cursor) and `acp-opencode`
(OpenCode) provider declarations. The rest of the ACP surface — Grok, Hermes
Agent, OMP, and the `customAcpAgents` server config — stays composed
server-side transitionally. This plugin is destined to own the Cursor and
OpenCode profiles, the remaining known-agents list, and the `customAcpAgents`
config (which then finally gets a settings UI).
