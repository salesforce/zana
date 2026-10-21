import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process so no real `claude` binary is ever spawned. The mock
// exposes a `spawn` spy and a factory-controlled `lastChild` we drive from tests.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

// Imported AFTER the mock is registered so the provider binds to the fake spawn.
const { ClaudeCliProvider } = await import('./claude-cli-provider.js');

/**
 * A fake spawned child: EventEmitter-backed for 'error'/'close', with stdout /
 * stderr stream stubs exposing `.on`, and a `kill` spy. Test code triggers the
 * lifecycle events synchronously.
 */
function makeFakeChild() {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const kill = vi.fn();
  const child = {
    stdout,
    stderr,
    kill,
    on: (event: string, cb: (...a: unknown[]) => void) => {
      emitter.on(event, cb);
      return child;
    },
    // Helpers for the test to drive the child.
    emitStdout: (s: string) => stdout.emit('data', Buffer.from(s, 'utf8')),
    emitError: (e: Error) => emitter.emit('error', e),
    emitClose: (code: number) => emitter.emit('close', code)
  };
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClaudeCliProvider abort handling', () => {
  it('kills the spawned process when the signal aborts', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const provider = new ClaudeCliProvider('claude');
    const controller = new AbortController();
    const p = provider.run({ system: 's', user: 'u', signal: controller.signal });

    // Process was spawned; now abort.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    controller.abort();

    const result = await p;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/abort/i);
  });

  it('does not spawn a process when the signal is already aborted', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const provider = new ClaudeCliProvider('claude');
    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const result = await provider.run({ system: 's', user: 'u', signal: controller.signal });

    expect(spawnMock).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/abort/i);
  });
});

describe('ClaudeCliProvider CLI success', () => {
  it('leaves usage undefined on a successful CLI run', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const provider = new ClaudeCliProvider('claude');
    const p = provider.run({ system: 's', user: 'u' });

    child.emitStdout('a clean label');
    child.emitClose(0);

    const result = await p;
    expect(result.ok).toBe(true);
    expect(result.text).toBe('a clean label');
    expect(result.usage).toBeUndefined();
  });
});

it('disables tools, ambient MCP servers, hooks and persistence for conversation inference', async () => {
  const child = makeFakeChild(); spawnMock.mockReturnValue(child);
  const pending = new ClaudeCliProvider('/configured/claude').run({ system: 'classify', user: '--user-input', disableTools: true });
  expect(spawnMock).toHaveBeenCalledWith('/configured/claude', expect.arrayContaining(['--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings', '{"disableAllHooks":true}', '--no-session-persistence']), expect.objectContaining({ shell: false }));
  expect(spawnMock.mock.calls[0][1].slice(-2)).toEqual(['--', '--user-input']);
  child.emitStdout('answer'); child.emitClose(0); await expect(pending).resolves.toMatchObject({ ok: true, text: 'answer' });
});

describe('ClaudeCliProvider binary resolution', () => {
  const run = async (provider: InstanceType<typeof ClaudeCliProvider>) => {
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    const p = provider.run({ system: 's', user: 'u' });
    child.emitClose(0);
    await p;
  };

  it('calls a getter on every run and spawns its current value', async () => {
    let bin = '/one';
    const getter = vi.fn(() => bin);
    const provider = new ClaudeCliProvider(getter);
    await run(provider);
    bin = '/two';
    await run(provider);
    expect(getter).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][0]).toBe('/one');
    expect(spawnMock.mock.calls[1][0]).toBe('/two');
  });

  it('still accepts a plain string', async () => {
    await run(new ClaudeCliProvider('/plain'));
    expect(spawnMock.mock.calls[0][0]).toBe('/plain');
  });

  it('returns ok:false instead of throwing when the getter throws', async () => {
    const provider = new ClaudeCliProvider(() => { throw new Error('config unreadable'); });
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result).toMatchObject({ ok: false, error: 'config unreadable' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('falls back to claude for an empty getter value', async () => {
    await run(new ClaudeCliProvider(() => '  '));
    expect(spawnMock.mock.calls[0][0]).toBe('claude');
  });
});
