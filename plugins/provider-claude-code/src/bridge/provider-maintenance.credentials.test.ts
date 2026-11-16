import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk';

const fixture = vi.hoisted(() => ({ account: {} as AccountInfo, usage: vi.fn(), probe: vi.fn(), resolve: vi.fn(), settings: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ resolveSettings: fixture.settings }));
vi.mock('./initialization-probe.js', () => ({ withInitializedClaude: fixture.probe }));
vi.mock('@zana-ai/zcc-plugin-sdk/provider-bridge', async (original) => ({
  ...(await original<typeof import('@zana-ai/zcc-plugin-sdk/provider-bridge')>()),
  experimental_resolveExecutablePath: fixture.resolve,
  experimental_readCliVersion: () => Promise.resolve('2.1.0'),
}));
import { getClaudeProviderHealth, getClaudeProviderUsage } from './provider-maintenance.js';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) vi.stubEnv(key, undefined);
  fixture.settings.mockResolvedValue({ effective: {} });
  fixture.resolve.mockResolvedValue('/fixture/claude');
  fixture.account = { apiProvider: 'firstParty', tokenSource: 'none', apiKeySource: 'none' };
  fixture.probe.mockImplementation((read) => read({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: fixture.usage }, { account: fixture.account }));
  fixture.usage.mockResolvedValue({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 12, resets_at: null } } });
});
afterEach(() => vi.unstubAllEnvs());

describe('effective Claude credentials', () => {
  it.each(['gateway', 'bedrock', 'vertex', 'foundry'] as const)('keeps %s accounts ready without OAuth files or public usage requests', async (apiProvider) => {
    fixture.account = { apiProvider };
    expect(await getClaudeProviderHealth()).toMatchObject({ supported: true, health: { status: 'ready', loginCommand: null } });
    expect(await getClaudeProviderUsage()).toMatchObject({ supported: true, usage: { status: 'error', message: expect.stringContaining('unavailable') } });
    expect(fixture.usage).not.toHaveBeenCalled();
  });
  it.each([{ apiKeySource: 'apiKeyHelper' }, { apiKeySource: 'environment' }, { tokenSource: 'oauth' }])('recognizes native credential sources %j', async (source) => {
    fixture.account = { apiProvider: 'firstParty', ...source };
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'ready' } });
  });
  it('reports missing credentials, and treats absent SDK metadata as unknown', async () => {
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'unauthenticated', loginCommand: 'claude auth login' } });
    expect(await getClaudeProviderUsage()).toMatchObject({ usage: { status: 'unauthenticated' } });
    fixture.account = {};
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'unknown' } });
  });
  it.each([{ apiKeyHelper: 'fixture-helper' }, { env: { ANTHROPIC_BASE_URL: 'https://gateway.example' } }])('never offers public OAuth when managed settings exist but native credentials are unavailable: %j', async (effective) => {
    fixture.settings.mockResolvedValue({ effective });
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'unknown', loginCommand: null } });
    expect(await getClaudeProviderUsage()).toMatchObject({ usage: { status: 'error', message: expect.stringContaining('unavailable') } });
    expect(fixture.usage).not.toHaveBeenCalled();
  });
  it('preserves environment-based gateway authentication even when the CLI cannot recognize credentials', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://gateway.example');
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'unknown', loginCommand: null } });
  });
  it('gets subscription usage through the initialized CLI with transcript scanning disabled', async () => {
    fixture.account = { tokenSource: 'oauth', email: 'test@example.com', subscriptionType: 'pro' };
    expect(await getClaudeProviderUsage()).toMatchObject({ usage: { status: 'ok', accountEmail: 'test@example.com', planLabel: 'Pro', windows: [{ usedPercent: 12 }] } });
    expect(fixture.usage).toHaveBeenCalledWith({ skipBehaviors: true });
  });
  it('does not misclassify unavailable subscription limits as an authentication failure', async () => {
    fixture.account = { apiKeySource: 'apiKeyHelper' };
    fixture.usage.mockResolvedValue({ rate_limits_available: false, rate_limits: null });
    expect(await getClaudeProviderUsage()).toMatchObject({ usage: { status: 'error', message: expect.stringContaining('unavailable') } });
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'ready' } });
    expect(fixture.usage).not.toHaveBeenCalled();
  });
  it('keeps OAuth readiness independent from an unavailable native subscription meter', async () => {
    fixture.account = { tokenSource: 'oauth' };
    fixture.usage.mockResolvedValue({ rate_limits_available: false, rate_limits: null });
    expect(await getClaudeProviderUsage()).toMatchObject({ usage: { status: 'error', message: expect.stringContaining('unavailable') } });
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'ready' } });
  });
  it('handles missing executables and redacts probe failures', async () => {
    fixture.resolve.mockResolvedValue(null);
    expect(await getClaudeProviderHealth()).toMatchObject({ health: { status: 'not_installed' } });
    expect(await getClaudeProviderUsage()).toMatchObject({ usage: { status: 'not_installed' } });
    expect(fixture.probe).not.toHaveBeenCalled();
    fixture.resolve.mockResolvedValue('/fixture/claude');
    fixture.probe.mockRejectedValue(new Error('secret-token-value'));
    const health = await getClaudeProviderHealth(), usage = await getClaudeProviderUsage();
    expect(health).toMatchObject({ health: { status: 'unknown' } });
    expect(usage).toMatchObject({ usage: { status: 'error' } });
    expect(JSON.stringify([health, usage])).not.toContain('secret-token-value');
  });
});
