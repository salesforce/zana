#!/usr/bin/env node
/** Test helper; canonical TypeScript is bundled by scripts/build-join.mjs. */
import { PROTOCOL_VERSION, runJoinStandalone } from '../dist/join-standalone.mjs';
export { PROTOCOL_VERSION, runJoinStandalone };

if ((process.argv[1] ?? '').endsWith('join-standalone.mjs') && process.argv[2] === 'join') {
  const running = await runJoinStandalone();
  const shutdown = () => {
    void running.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
