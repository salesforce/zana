# `@zana-ai/zcc-control`

Node client for live-driving a running Zana Command Center over loopback product
HTTP. Handbook: [`docs/control-sdk.md`](../../docs/control-sdk.md).

```ts
import { Zcc } from '@zana-ai/zcc-control';

const zcc = await Zcc.connect();
const project = await zcc.projects.ensureLiveSandbox();
const thread = await zcc.threads.spawn({
  projectId: project.id,
  prompt: 'reply with PONG and stop'
});
await thread.wait({ until: 'idle', onInteraction: 'fail' });
await zcc.cleanup();
```

Attach (`Zcc.connect`) probes `:8780` then `:8781`, or set `ZCC_SERVER_URL`.
`Zcc.launch({ isolated: true })` is threads-only. Operator CLI uses the same
`spawnThread` / `launchCliAgent` helpers with `tagged: false`.

```bash
pnpm live:smoke
pnpm live:matrix
pnpm live:cli-scenarios
pnpm live:mode-reasoning
pnpm live:browser
pnpm live:memory
```

Run live scripts from a host shell (`unset ZCC_SESSION_ID`). Not Playwright,
not plugin-sdk. `live:browser` attaches to Electron and drives desktop-browser
product HTTP (`create` / acquire / loopback CDP / capture / release /
`importCookies` into the tagged thread's automation partition).
`live:memory` attaches and drives the Memory plugin CLI, then a Claude Code
thread that quotes an injected catalog summary.
