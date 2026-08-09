#!/usr/bin/env node

/**
 * Interactive terminal simulator for the ZCC Stream Deck — lets a human drive
 * the full app (hub → menu → every view → every action) with NO physical deck
 * and NO dependency on the live app socket.
 *
 * It stands up an in-process demo control plane on a temp Unix socket (the same
 * wire protocol the real app speaks) seeded with canned agents / projects /
 * schedules, points `createDeckApp` at that temp data dir, and renders to a
 * `TerminalDeck`. Every keypress runs the REAL navigation and action code; the
 * mutating ops (reply / spawn / sched toggle) are logged so you can see them
 * fire.
 *
 *   node dist/bin/zcc-deck-sim.js
 *
 * Type "col row" (e.g. `0 0`) + Enter to press a tile; `q` to quit.
 */

import { createInterface } from 'node:readline';

import { createDeckApp } from '../app.js';
import { TerminalDeck } from '../deck/terminal-device.js';
import { XL, type Geometry } from '../deck/device.js';
import { startDemoPlane } from '../lib/demo-plane.js';

/**
 * Parse an optional `--geom CxR` flag (e.g. `--geom 5x3`) so you can preview
 * how the layouts fold on a smaller deck without hardware. Defaults to XL.
 */
function parseGeom(argv: string[]): Geometry {
  const i = argv.indexOf('--geom');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  const m = raw?.match(/^(\d+)x(\d+)$/i);
  if (!m) return XL;
  return { cols: Number(m[1]), rows: Number(m[2]) };
}

function banner(): void {
  process.stdout.write(
    [
      '',
      'Demo data loaded: 3 agents (1 blocked), 3 projects, 2 schedules.',
      'Try: 0 0 (ZCC hub) → 0 0 (Agents) → tile → 0 1 (Approve).',
      'Actions print below the grid. Ctrl+C or "q" to quit.',
      ''
    ].join('\n')
  );
}

async function main(): Promise<void> {
  const geom = parseGeom(process.argv.slice(2));
  const plane = await startDemoPlane();
  const deck = new TerminalDeck(geom);

  const log: string[] = [];
  const app = createDeckApp(deck, {
    dataDir: plane.dataDir,
    pollIntervalMs: 1_500,
    onResult: (r) => {
      const line = r.ok
        ? `✓ ${r.intent.kind} ${JSON.stringify(r.intent).slice(0, 80)}`
        : `✗ ${r.intent.kind} failed: ${r.code ?? ''} ${r.message ?? ''}`;
      log.push(line);
      if (log.length > 6) log.shift();
      deck.paint();
      process.stdout.write('\nactions:\n' + log.map((l) => '  ' + l).join('\n') + '\n\n> ');
    }
  });

  await app.start();
  banner();
  process.stdout.write('> ');

  const rl = createInterface({ input: process.stdin });
  const cleanup = async () => {
    rl.close();
    await app.stop();
    await plane.close();
    process.stdout.write('\nBye.\n');
    process.exitCode = 0;
  };

  rl.on('line', (raw) => {
    const line = raw.trim().toLowerCase();
    if (line === 'q' || line === 'quit' || line === 'exit') {
      void cleanup();
      return;
    }
    const m = line.match(/^(\d)\D+(\d)$/);
    if (!m) {
      process.stdout.write('  (type "col row" like "0 0", or q)\n> ');
      return;
    }
    deck.pressCoord(Number(m[1]), Number(m[2]));
    // Give async open handlers a beat to fetch+render before reprompting.
    setTimeout(() => process.stdout.write('> '), 120);
  });
  rl.on('SIGINT', () => void cleanup());
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
