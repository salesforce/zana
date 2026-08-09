/**
 * Tests for @zana-ai/zcc-extension-sdk/testing utilities.
 */

import { describe, it, expect } from 'vitest';
import { createMockHost, createMockMainContext, flushMicrotasks } from '../testing.js';

describe('createMockHost', () => {
  it('returns a usable ModuleHost with default values', () => {
    const host = createMockHost();

    expect(host.moduleId).toBe('mock-module');
    expect(host.getActiveProject()).toBeNull();
    expect(host.getScopedProjectId()).toBeNull();
    expect(host.listProjects()).toEqual([]);
    expect(host.listPersonas()).toEqual([]);
  });

  it('storage set/get roundtrips', async () => {
    const host = createMockHost();

    await host.storage.set('key1', 'value1');
    await host.storage.set('key2', 42);

    expect(await host.storage.get('key1')).toBe('value1');
    expect(await host.storage.get('key2')).toBe(42);
    expect(await host.storage.get('missing')).toBeUndefined();
  });

  it('cache set/get roundtrips', () => {
    const host = createMockHost();

    host.cache.set('cached', { data: 'test' });
    expect(host.cache.get('cached')).toEqual({ data: 'test' });

    host.cache.delete('cached');
    expect(host.cache.get('cached')).toBeUndefined();
  });

  it('overrides win over defaults', () => {
    const host = createMockHost({
      moduleId: 'custom-id',
      listProjects: () => [
        { id: 'p1', name: 'Project 1', path: '/path/one' },
        { id: 'p2', name: 'Project 2', path: '/path/two' }
      ],
      getActiveProject: () => ({ id: 'p1', name: 'Project 1', path: '/path/one' })
    });

    expect(host.moduleId).toBe('custom-id');
    expect(host.listProjects()).toHaveLength(2);
    expect(host.getActiveProject()?.id).toBe('p1');
  });

  it('on() returns a callable unsubscribe function', () => {
    const host = createMockHost();
    const calls: any[] = [];

    const off = host.on('project:changed', (payload) => {
      calls.push(payload);
    });

    expect(typeof off).toBe('function');
    off(); // Unsubscribe (no-op in mock, but callable)
  });

  it('call() resolves undefined by default', async () => {
    const host = createMockHost();
    const result = await host.call('someCapability', 'arg1', 'arg2');
    expect(result).toBeUndefined();
  });

  it('call() can be overridden', async () => {
    const host = createMockHost({
      call: async (capability: string, ...args: unknown[]) => {
        if (capability === 'getData') {
          return ['item1', 'item2'];
        }
        return null;
      }
    });

    const data = await host.call<string[]>('getData');
    expect(data).toEqual(['item1', 'item2']);

    const other = await host.call('other');
    expect(other).toBeNull();
  });

  it('launchSession resolves mock session id', async () => {
    const host = createMockHost();
    const result = await host.launchSession({ projectId: 'p1' });
    expect(result).toEqual({ id: 'mock-session' });
  });

  it('pushInbox resolves mock entry id', async () => {
    const host = createMockHost();
    const result = await host.pushInbox({ comments: 'Test' });
    expect(result).toEqual({ id: 'mock-inbox-entry' });
  });

  it('replyToSession and writeToSession resolve true', async () => {
    const host = createMockHost();
    expect(await host.replyToSession('sid', 'text')).toBe(true);
    expect(await host.writeToSession('sid', 'data')).toBe(true);
  });

  it('ensureQuickAgent resolves default quick-agent project', async () => {
    const host = createMockHost();
    const result = await host.ensureQuickAgent();
    expect(result).toEqual({
      id: 'quick-agent',
      name: 'Quick Agent',
      path: '~/.zcc-workspace'
    });
  });

  it('relaunchSelf resolves false (no restart in mock)', async () => {
    const host = createMockHost();
    expect(await host.relaunchSelf()).toBe(false);
  });

  it('subscribe returns unsubscribe function', () => {
    const host = createMockHost();
    const off = host.subscribe('sub-id', () => {}, () => {});
    expect(typeof off).toBe('function');
    off(); // Callable
  });

  it('register collects disposables into __disposables a test can drain (W1-6)', () => {
    const host = createMockHost();
    const ran: string[] = [];
    host.register(() => ran.push('a'));
    host.register(() => ran.push('b'));

    const disposables = (host as unknown as { __disposables: Array<() => void> }).__disposables;
    expect(disposables).toHaveLength(2);
    // Nothing runs until the test drains them (simulating unmount/teardown).
    expect(ran).toEqual([]);
    for (const d of disposables) d();
    expect(ran).toEqual(['a', 'b']);
  });
});

describe('createMockMainContext', () => {
  it('returns a usable MainModuleContext', () => {
    const ctx = createMockMainContext();

    expect(ctx.storage).toBeDefined();
    expect(ctx.log).toBeDefined();

    // fs capability is present by default as a real stub object
    expect(ctx.fs).toBeDefined();
    expect(ctx.fs!.readFile).toBeDefined();
    expect(ctx.fs!.rm).toBeDefined();

    // Other brokered caps omitted by default
    expect(ctx.exec).toBeUndefined();
    expect(ctx.fetch).toBeUndefined();
    expect(ctx.mcp).toBeUndefined();
  });

  it('storage set/get roundtrips', () => {
    const ctx = createMockMainContext();

    ctx.storage.set('key1', 'value1');
    ctx.storage.set('key2', [1, 2, 3]);

    expect(ctx.storage.get('key1')).toBe('value1');
    expect(ctx.storage.get('key2')).toEqual([1, 2, 3]);
    expect(ctx.storage.get('missing')).toBeUndefined();
  });

  it('overrides win over defaults', async () => {
    const ctx = createMockMainContext({
      exec: async (req) => ({
        stdout: `Executed ${req.bin}`,
        stderr: '',
        code: 0,
        signal: null
      }),
      log: (msg) => {
        // Custom log could push to array for testing
      }
    });

    expect(ctx.exec).toBeDefined();
    const result = await ctx.exec!({ bin: 'git', args: ['status'] });
    expect(result.stdout).toBe('Executed git');
    expect(result.code).toBe(0);
  });

  it('can override fs capability', async () => {
    const ctx = createMockMainContext({
      fs: {
        readFile: async (path: string) => `Contents of ${path}`,
        writeFile: async () => {},
        rm: async () => {},
        readdir: async () => ['file1.txt', 'file2.txt'],
        stat: async (path: string) => ({
          size: 1024,
          mtimeMs: Date.now(),
          isFile: path.endsWith('.txt'),
          isDirectory: !path.endsWith('.txt')
        }),
        exists: async (path: string) => true
      }
    });

    expect(ctx.fs).toBeDefined();
    const content = await ctx.fs!.readFile('/test/path');
    expect(content).toBe('Contents of /test/path');

    const files = await ctx.fs!.readdir('/dir');
    expect(files).toEqual(['file1.txt', 'file2.txt']);

    const stats = await ctx.fs!.stat('/test/file.txt');
    expect(stats.size).toBe(1024);
    expect(stats.isFile).toBe(true);
    expect(stats.isDirectory).toBe(false);

    const exists = await ctx.fs!.exists('/test/path');
    expect(exists).toBe(true);

    // rm is callable and awaitable via override
    await ctx.fs!.rm!('/test/file-to-delete.txt');
  });

  it('can override fetch capability', async () => {
    const ctx = createMockMainContext({
      fetch: async (url: string) => ({
        status: 200,
        ok: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url })
      })
    });

    expect(ctx.fetch).toBeDefined();
    const response = await ctx.fetch!('https://example.com');
    expect(response.ok).toBe(true);
    expect(response.body).toContain('example.com');
  });

  it('can override mcp capability', async () => {
    const ctx = createMockMainContext({
      mcp: async (serverId: string, tool: string, args?: any) => {
        return { serverId, tool, result: 'mock-result' };
      }
    });

    expect(ctx.mcp).toBeDefined();
    const result = await ctx.mcp!('test-server', 'test-tool', { arg: 'value' });
    expect(result).toEqual({
      serverId: 'test-server',
      tool: 'test-tool',
      result: 'mock-result'
    });
  });

  it('log is no-op by default', () => {
    const ctx = createMockMainContext();
    expect(() => {
      ctx.log('test message');
      ctx.log('error message', new Error('test'));
    }).not.toThrow();
  });

  it('register collects disposables into __disposables a test can drain (W1-6)', () => {
    const ctx = createMockMainContext();
    const ran: string[] = [];
    ctx.register(() => ran.push('x'));
    ctx.register(() => ran.push('y'));

    const disposables = (ctx as unknown as { __disposables: Array<() => void> }).__disposables;
    expect(disposables).toHaveLength(2);
    expect(ran).toEqual([]);
    for (const d of disposables) d();
    expect(ran).toEqual(['x', 'y']);
  });
});

describe('flushMicrotasks', () => {
  it('resolves after one tick', async () => {
    let resolved = false;
    Promise.resolve().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    await flushMicrotasks();
    expect(resolved).toBe(true);
  });

  it('allows async operations to complete', async () => {
    const results: number[] = [];

    Promise.resolve().then(() => results.push(1));
    setTimeout(() => results.push(2), 0);
    Promise.resolve().then(() => results.push(3));

    expect(results).toEqual([]);

    await flushMicrotasks();

    // Microtasks (Promises) run before setTimeout
    expect(results).toContain(1);
    expect(results).toContain(3);
  });
});
