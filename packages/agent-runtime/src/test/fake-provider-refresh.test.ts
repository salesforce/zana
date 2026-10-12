import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('fake provider refresh stream', () => {
  it('emits progress with immediate-delivery child boundaries, then settles the parent', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fake-provider-script.ts', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    const reader = createInterface({ input: child.stdout });
    const messages: any[] = [];
    let resolve!: () => void;
    const completed = new Promise<void>(next => { resolve = next; });
    reader.on('line', line => {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.params?.deltas?.some((delta: any) => delta.kind === 'turn.boundary' && delta.providerTurnId === 'turn-1')) resolve();
    });
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: {
        threadId: 'refresh-test', input: [{ type: 'text', text: 'stream_refresh:200' }]
      } }) + '\n');
      await completed;
      const deltas = messages.flatMap(message => message.params?.deltas ?? []);
      expect(deltas.filter(delta => delta.kind === 'turn.boundary' && delta.providerTurnId !== 'turn-1')).toHaveLength(4);
      expect(deltas.filter(delta => delta.item?.text?.startsWith('Refresh progress')).map(delta => delta.item.text))
        .toEqual(['Refresh progress 1', 'Refresh progress 2', 'Refresh progress 3', 'Refresh progress 4']);
      expect(deltas.at(-1)).toMatchObject({ kind: 'turn.boundary', providerTurnId: 'turn-1', status: 'completed' });
    } finally {
      reader.close();
      child.kill();
    }
  });

  it('keeps a long stream running until a stream_refresh:finish steer ends it', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fake-provider-script.ts', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    const reader = createInterface({ input: child.stdout });
    const deltas: any[] = [];
    const ticks = () => deltas.filter(delta => delta.item?.text?.startsWith('Refresh progress')).length;
    const waiters: Array<{ until: () => boolean; resolve: () => void }> = [];
    const waitFor = (until: () => boolean) => new Promise<void>(resolve => { waiters.push({ until, resolve }); });
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
    reader.on('line', line => {
      deltas.push(...(JSON.parse(line).params?.deltas ?? []));
      for (const waiter of waiters.filter(waiter => waiter.until())) waiter.resolve();
    });
    const steer = (id: number, text: string) =>
      send({ jsonrpc: '2.0', id, method: 'turn/steer', params: { threadId: 'refresh-finish', input: [{ type: 'text', text }] } });
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: {
        threadId: 'refresh-finish', input: [{ type: 'text', text: 'stream_refresh:60000' }]
      } });
      await waitFor(() => ticks() >= 3);
      // An ordinary steer leaves the stream running.
      steer(2, 'keep going');
      const afterSteer = ticks();
      await waitFor(() => ticks() >= afterSteer + 3);
      steer(3, 'stream_refresh:finish');
      await waitFor(() => deltas.some(delta => delta.kind === 'turn.boundary' && delta.providerTurnId === 'turn-1'));
      expect(ticks()).toBeGreaterThanOrEqual(6);
      expect(ticks()).toBeLessThan(200);
      expect(deltas.some(delta => delta.item?.text === 'Refresh stream complete')).toBe(true);
      expect(deltas.at(-1)).toMatchObject({ kind: 'turn.boundary', providerTurnId: 'turn-1', status: 'completed' });
    } finally {
      reader.close();
      child.kill();
    }
  });
});
