#!/usr/bin/env node

/**
 * Hardware demo runner: opens the PHYSICAL Stream Deck and drives it with the
 * in-process demo control plane (canned agents / projects / schedules) instead
 * of a running Zana Command Center. Use this to see the ZCC hub on real
 * hardware when the app's live control socket isn't up.
 *
 *   node dist/bin/zcc-deck-demo.js
 *
 * The official Elgato Stream Deck app must be fully quit first — only one
 * process can hold the device's HID connection. Presses run the REAL navigation
 * and action code; mutating ops are ack'd by the demo plane and logged.
 *
 * For the LIVE app (real agents), use `zcc-deck` instead — it refuses to start
 * without the control socket. This bin never touches it.
 */

import { createDeckApp } from '../app.js';
import { openDeck } from '../deck/elgato-device.js';
import { startDemoPlane } from '../lib/demo-plane.js';

async function main(): Promise<void> {
  const device = await openDeck();
  const geom = device.geometry;
  process.stdout.write(
    `Opened Stream Deck (${geom ? `${geom.cols}×${geom.rows}` : 'unknown'} grid). Loading demo data…\n`
  );

  const plane = await startDemoPlane();
  const app = createDeckApp(device, {
    dataDir: plane.dataDir,
    onResult: (r) => {
      const line = r.ok
        ? `✓ ${r.intent.kind} ${JSON.stringify(r.intent).slice(0, 80)}`
        : `✗ ${r.intent.kind} failed: ${r.code ?? ''} ${r.message ?? ''}`;
      process.stdout.write(line + '\n');
    }
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    process.stderr.write('\nShutting down…\n');
    void app
      .stop()
      .then(() => plane.close())
      .finally(() => {
        process.exitCode = 0;
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.start();
  process.stdout.write(
    'zcc-deck-demo running on hardware. Press the ZCC tile to explore. Ctrl+C to quit.\n'
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
