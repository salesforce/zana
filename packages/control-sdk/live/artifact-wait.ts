/** An idle repaint is not proof that a native CLI completed its requested write. */
export async function waitForArtifact(args: {
  exists: () => boolean;
  refresh: () => Promise<{ status: string }>;
  sleep: (ms: number) => Promise<void>;
  nowMs: () => number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = args.nowMs() + args.timeoutMs;
  while (args.nowMs() < deadline) {
    if (args.exists()) return;
    const row = await args.refresh();
    if (args.exists()) return;
    if (row.status === 'exited') throw new Error('CLI agent exited before creating the requested artifact');
    await args.sleep(250);
  }
  throw new Error('CLI agent did not create the requested artifact before the deadline');
}
