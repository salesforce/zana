import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: vi.fn(), resolve: vi.fn(), init: vi.fn(), close: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: fixture.query }));
vi.mock('./session-options.js', () => ({ resolveClaudeCodeExecutable: fixture.resolve }));
import { withInitializedClaude } from './initialization-probe.js';
beforeEach(() => {
  vi.clearAllMocks();
  fixture.resolve.mockReturnValue('/custom/claude');
  fixture.init.mockResolvedValue({ account: { apiProvider: 'gateway' } });
  fixture.query.mockImplementation(() => ({ initializationResult: fixture.init, close: fixture.close }));
});
afterEach(() => vi.useRealTimers());
describe('Claude initialization-only probe', () => {
  it('preserves gateway env, custom config and executable, and all native settings sources without a model turn', async () => {
    const env = { ANTHROPIC_BASE_URL: 'https://gateway.example', ANTHROPIC_AUTH_TOKEN: 'fixture-token', CLAUDE_CONFIG_DIR: '/custom/config', LLM_GATEWAY_EXPRESS_API_KEY: 'fixture-key' };
    const before = { ...env };
    const result = await withInitializedClaude(async (_session, init) => init.account, { env, cwd: '/fixture/project' });
    expect(result).toEqual({ apiProvider: 'gateway' });
    expect(env).toEqual(before);
    expect(fixture.resolve).toHaveBeenCalledWith({ env });
    const { prompt, options } = fixture.query.mock.calls[0][0];
    expect(options).toEqual({ env, cwd: '/fixture/project', persistSession: false, settingSources: ['user', 'project', 'local'], pathToClaudeCodeExecutable: '/custom/claude' });
    expect(options.env).toBe(env);
    expect(typeof prompt).not.toBe('string');
    expect(await prompt.next()).toEqual({ done: true, value: undefined });
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it('waits without emitting prompt messages, then closes the generator on completion', async () => {
    let resolve!: (value: unknown) => void;
    fixture.init.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const probe = withInitializedClaude(async () => 'ok');
    const next = fixture.query.mock.calls[0][0].prompt.next();
    resolve({ account: {} });
    expect(await probe).toBe('ok');
    expect(await next).toEqual({ done: true, value: undefined });
  });
  it('closes the native session on read failures and deadlines', async () => {
    await expect(withInitializedClaude(async () => { throw new Error('read failed'); })).rejects.toThrow('read failed');
    vi.useFakeTimers();
    fixture.init.mockImplementation(() => new Promise(() => {}));
    const pending = expect(withInitializedClaude(async () => null, { timeoutMs: 50 })).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(fixture.close).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up synchronous start failures and allows native executable discovery', async () => {
    fixture.resolve.mockReturnValue(undefined);
    await withInitializedClaude(async () => null);
    expect(fixture.query.mock.calls[0][0].options).not.toHaveProperty('pathToClaudeCodeExecutable');
    fixture.query.mockImplementation(() => { throw new Error('spawn failed'); });
    await expect(withInitializedClaude(async () => null)).rejects.toThrow('spawn failed');
  });
});
