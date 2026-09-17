# Agentforce Code for ZCC

Adds Agentforce Code to ACP threads. The matching ZCC native harness adds it to CLI Agents.

Requires ZCC built with the afcode harness and an **ACP-enabled** afcode build. An older release can support the terminal CLI while lacking the `acp` command.

## Local setup

1. From the ZCC checkout, build and install the plugin: `pnpm --filter @zcc-ext/provider-afcode build`, then `zcc plugin install ./plugins/provider-afcode`.
2. In the plugin settings, set **Agentforce Code executable** to your binary or virtual-environment entry point. The default is `afcode` on PATH.
3. In Settings → Agents, set the **afcode binary** to the same executable and enable the harness. Check its installation status.
4. Select **Agentforce Code** when creating a thread or CLI Agent.

For a source checkout, use the absolute path to `afcode/.venv/bin/afcode`. A virtual environment does not need to be activated when both settings point to its entry point.

Authentication stays with afcode: it reads `LLM_GATEWAY_EXPRESS_API_KEY` or `env.ANTHROPIC_AUTH_TOKEN` in `~/.claude/settings.json`. The reviewed afcode version does not execute Claude's `apiKeyHelper`; that setting alone is insufficient. ZCC does not store a second copy. Environment credentials must be available to the executing host process. `LLM_GATEWAY_EXPRESS_URL` and `AFCODE_MODEL` are passed through for ACP when present.

For DevBar sign-in, a local launcher can capture `devbar auth claude`, reject an empty result, set `LLM_GATEWAY_EXPRESS_API_KEY` only in the child environment, then exec the real afcode binary. Point both executable settings at that launcher. Keep credentials out of launcher files and logs. Already-running afcode workers inherit their daemon's old environment: after fixing authentication, stop the affected failed sessions with `afcode agents stop <session-id>`, then restart an idle daemon with `afcode daemon stop`. The next ACP launch starts it with the updated environment.

## Launch behavior

Threads launch `afcode acp`. Model and mode controls come from its ACP handshake; permission requests use ZCC's approval interface. Full Access is handled by that bridge, without passing a startup flag that disables all confirmations inside afcode.

CLI Agents launch `afcode --local` so active work remains in the PTY process. Initial instructions wait for its terminal input-ready sequence; startup banners alone are insufficient while MCP discovery and terminal negotiation are running. Model selection stays in afcode's native configuration or `/model` command because the interactive CLI has no `--model` argument. The unrestricted profile explicitly adds `--auto-approve`.

The resume profile opens `afcode --local --resume`, which presents the native picker. A supplied native session reference is passed directly to `--resume`. Without an exact reference ZCC never chooses the globally newest conversation automatically.

Working/idle for CLI Agents uses the output-activity heuristic, ignoring OSC titles and other control-only TUI frames so an idle prompt that redraws its chrome does not stay **Working**. ACP threads go idle only when `session/prompt` returns a `stopReason` — streamed `session/update` chunks are not enough.

Disabling the plugin removes the ACP provider. The native CLI Agent is controlled separately by the standard harness enable switch. Remote CLI launch is unsupported in this version.

## Current ACP limitations

The reviewed afcode branch still ignores client-supplied MCP servers, limits history replay, and does not emit complete live plan updates. Consequently ZCC host tools supplied through ACP MCP are unavailable, reopened history may be incomplete, and plan progress is limited. This integration does not advertise fork, manual compaction, service tiers or independent reasoning controls.

If thread startup fails, run `<executable> acp --help` to confirm ACP support, then check native authentication. A successful `afcode --version` verifies CLI presence but does not prove ACP compatibility.

When spawning through `zcc thread spawn`, pass `--provider acp-afcode --model acp-default` to use afcode's native default, or a model id from its ACP catalogue. Direct HTTP callers should also include that model on subsequent `/send` requests, as the UI composer does. The generic product API records the literal `default` when a model is omitted; it is not an afcode model id and can break a later resume.

## Validation

Focused tests cover plugin source/artifact parity, launch profiles, executable overrides, session selection, native-only model controls and unsupported remote launch. `e2e/afcode-launch-boundary.spec.ts` uses a deterministic dual CLI/ACP fixture through built Electron. Run it with `node scripts/run-electron-e2e.mjs --build e2e/afcode-launch-boundary.spec.ts`.

Set `ZCC_LIVE_AFCODE=/absolute/path/to/afcode` to include real CLI startup and ACP response tests. They copy native authentication into the isolated test HOME and require one of the credentials above; the ACP test makes one short, no-tools model request. The normal fixture tests make no model requests.
