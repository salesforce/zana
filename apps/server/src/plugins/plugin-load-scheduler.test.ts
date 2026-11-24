import { describe, expect, it } from 'vitest';
import { loadPluginsConcurrently, PLUGIN_STARTUP_CONCURRENCY } from './plugin-load-scheduler.js';

interface Gate { promise: Promise<void>; open(): void }
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}
const node = (id: string, requires: string[] = []) => ({ id, requires });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('loadPluginsConcurrently', () => {
  it('starts independent plugins together up to the cap', async () => {
    const gates = new Map<string, Gate>();
    const started: string[] = [];
    const done = loadPluginsConcurrently(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)), {
      concurrency: 3,
      load: async (n) => { started.push(n.id); gates.set(n.id, gate()); await gates.get(n.id)!.promise; }
    });
    await tick();
    expect(started).toEqual(['a', 'b', 'c']);
    gates.get('a')!.open();
    await tick();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    for (const id of ['b', 'c', 'd']) gates.get(id)!.open();
    await tick();
    for (const id of ['e', 'f']) gates.get(id)!.open();
    await done;
    expect(started).toHaveLength(6);
  });

  it('defaults to the exported cap', async () => {
    let running = 0;
    let peak = 0;
    await loadPluginsConcurrently(Array.from({ length: 10 }, (_, i) => node(`p${i}`)), {
      load: async () => { running += 1; peak = Math.max(peak, running); await tick(); running -= 1; }
    });
    expect(peak).toBe(PLUGIN_STARTUP_CONCURRENCY);
  });

  it('starts a plugin only after the plugins it requires have loaded', async () => {
    const events: string[] = [];
    const gates = new Map<string, Gate>();
    const done = loadPluginsConcurrently(
      [node('consumer', ['provider', 'missing', 'consumer']), node('provider'), node('other')],
      {
        load: async (n) => {
          events.push(`start ${n.id}`);
          gates.set(n.id, gate());
          await gates.get(n.id)!.promise;
          events.push(`end ${n.id}`);
        }
      }
    );
    await tick();
    expect(events).toEqual(['start provider', 'start other']);
    gates.get('provider')!.open();
    await tick();
    expect(events).toContain('start consumer');
    expect(events.indexOf('start consumer')).toBeGreaterThan(events.indexOf('end provider'));
    gates.get('other')!.open();
    gates.get('consumer')!.open();
    await done;
  });

  it('lets running plugins finish, starts nothing new and rethrows the first failure', async () => {
    const started: string[] = [];
    const slow = gate();
    const result = loadPluginsConcurrently([node('bad'), node('slow'), node('later', ['bad'])], {
      load: async (n) => {
        started.push(n.id);
        if (n.id === 'bad') throw new Error('boom');
        await slow.promise;
      }
    }).catch((error: Error) => error.message);
    await tick();
    slow.open();
    expect(await result).toBe('boom');
    expect(started).toEqual(['bad', 'slow']);
  });

  it('stops scheduling when shouldContinue turns false', async () => {
    const started: string[] = [];
    let keepGoing = true;
    await loadPluginsConcurrently([node('a'), node('b', ['a'])], {
      shouldContinue: () => keepGoing,
      load: async (n) => { started.push(n.id); keepGoing = false; }
    });
    expect(started).toEqual(['a']);
  });

  it('treats a synchronous throw like a rejection and waits for running loads before rethrowing', async () => {
    const slow = gate();
    let slowDone = false;
    let settled = false;
    const result = loadPluginsConcurrently([node('slow'), node('bad')], {
      load: (n) => {
        if (n.id === 'bad') throw new Error('sync boom');
        return slow.promise.then(() => { slowDone = true; });
      }
    }).then(() => 'ok', (error: Error) => { settled = true; return error.message; });
    await tick();
    expect(settled).toBe(false);
    slow.open();
    expect(await result).toBe('sync boom');
    expect(slowDone).toBe(true);
  });

  it('reports later load errors through onError and rethrows only the first', async () => {
    const reported: string[] = [];
    const slow = gate();
    const result = loadPluginsConcurrently([node('first'), node('second')], {
      onError: (error, n) => reported.push(`${n.id}: ${(error as Error).message}`),
      load: async (n) => {
        if (n.id === 'first') throw new Error('one');
        await slow.promise;
        throw new Error('two');
      }
    }).catch((error: Error) => error.message);
    await tick();
    slow.open();
    expect(await result).toBe('one');
    expect(reported).toEqual(['second: two']);
  });

  it('fails instead of returning when plugins are left waiting on each other', async () => {
    const started: string[] = [];
    await expect(loadPluginsConcurrently([node('free'), node('a', ['b']), node('b', ['a'])], {
      load: async (n) => { started.push(n.id); }
    })).rejects.toThrow('plugin load order is stuck waiting on: a, b');
    expect(started).toEqual(['free']);
  });
});
