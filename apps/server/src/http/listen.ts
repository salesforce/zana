import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startProductServer } from './product-server.js';
import { consumePeerBootKey } from '../services/peers/protected-key.js';
import { attachProductPluginService } from './product-plugins.js';
import { DEFAULT_DEV_APP_PORT, serverPortFromEnv } from './ports.js';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';
import { standaloneModernTeamLaunchSource } from '../services/agents/modern-team-launch-config.js';
import { isSquadMemberThread, resolveSquadMember } from '../services/threads/squad-member-runtime.js';
import { createTeamOpsViaControl } from './team-ops-via-control.js';
import { createCliAgentOpsViaControl, retainProductServerCredential } from './cli-agent-ops.js';
import { holdThreadProviderStartup } from '../services/threads/thread-provider-catalog.js';

const port = serverPortFromEnv();
const dataDir = resolveZccDataDir();
const appUrl = process.env.ZCC_DESKTOP_APP_URL ?? process.env.ELECTRON_RENDERER_URL;
const devAppPortRaw = process.env.ZCC_DEV_APP_PORT;
const devAppPort = devAppPortRaw && /^\d+$/.test(devAppPortRaw)
  ? Number(devAppPortRaw)
  : DEFAULT_DEV_APP_PORT;
const uiSendSecret = process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;
retainProductServerCredential(uiSendSecret);
// Plugin workers and other server children must never inherit the UI signing key.
delete process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;

mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const enrollToken = process.env.ZCC_HOST_ENROLL_TOKEN && process.env.ZCC_HOST_ENROLL_TOKEN.length >= 16
  ? process.env.ZCC_HOST_ENROLL_TOKEN
  : randomBytes(32).toString('hex');
writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

const peerKeyProvider = consumePeerBootKey();
const peerKey = await peerKeyProvider.getKey().catch((error: unknown) => {
  console.warn(`[zcc] peer key unavailable: ${error instanceof Error ? error.message : String(error)}`);
  return null;
});
const peerKeyPresent = peerKey !== null;
peerKey?.fill(0);
process.stdout.write(`zcc-server peer key: ${peerKeyPresent ? 'present' : 'absent (peer links and invitations unavailable)'}\n`);

// A host daemon can connect once the server listens, before plugins start.
const releaseProviderStartup = holdThreadProviderStartup();
const host = await startProductServer({
  host: '127.0.0.1',
  port,
  dataDir,
  enrollToken,
  uiSendSecret,
  peerKeyProvider,
  origins: {
    serverPort: port,
    devAppPort,
    appUrl
  }
});
host.ctx.teamOps = createTeamOpsViaControl(dataDir);
host.ctx.cliAgentOps = createCliAgentOpsViaControl(dataDir);
await attachProductPluginService(host.ctx, {
  hostAgentToolSource: standaloneModernTeamLaunchSource(
    dataDir,
    () => host.ctx.config.getConfig(),
    process.env.ZCC_E2E_HOME ? join(process.env.ZCC_E2E_HOME, 'electron-user-data') : undefined,
    (threadId, projectId) => resolveSquadMember(host.ctx, threadId, projectId),
    (threadId) => isSquadMemberThread(host.ctx, threadId)
  )
}).finally(releaseProviderStartup);

process.stdout.write(`zcc-server listening on ${host.url}\n`);

const shutdown = () => {
  void host.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
