#!/usr/bin/env node

/**
 * Entry point for the zcc-deck daemon: opens the physical Stream Deck, wires it
 * to the running app's control plane, and renders the live agent kanban until
 * Ctrl+C. Never calls process.exit mid-logic — sets exitCode and lets handlers
 * unwind, mirroring the @zcc/cli bin discipline.
 *
 * The official Elgato Stream Deck app must be fully quit first — only one
 * process can hold the device's HID connection.
 */

import { createDeckApp } from '../app.js';
import { openDeck } from '../deck/elgato-device.js';
import { isAppRunning, resolveDataDir } from '../lib/control-client.js';

async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  if (!isAppRunning(dataDir)) {
    process.stderr.write(
      'Zana Command Center is not running (no control socket at ' +
        dataDir +
        '). Open the app and retry.\n'
    );
    process.exitCode = 1;
    return;
  }

  const device = await openDeck();
  const app = createDeckApp(device, {
    dataDir,
    onResult: (r) => {
      if (!r.ok) {
        process.stderr.write(`action ${r.intent.kind} failed: ${r.code ?? ''} ${r.message ?? ''}\n`);
      }
    }
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    process.stderr.write('\nShutting down…\n');
    void app.stop().finally(() => {
      process.exitCode = 0;
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.start();
  process.stdout.write('zcc-deck running. Press Ctrl+C to quit.\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
