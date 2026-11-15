import { describe, expect, it } from 'vitest';
import { providerReadinessResultSchema, providerSignInRequestSchema } from './provider-readiness.js';
describe('public provider readiness contract', () => {
  it('projects only display metadata and accepts older health providers without local login commands', () => {
    expect(providerReadinessResultSchema.parse({ supported: true, health: { status: 'ready', loginCommand: null, accessToken: 'fixture-secret', env: { KEY: 'fixture-secret' } }, credentials: 'fixture-secret' })).toEqual({ supported: true, health: { status: 'ready', loginCommand: null } });
    expect(providerReadinessResultSchema.parse({ supported: false, secret: 'fixture-secret' })).toEqual({ supported: false });
  });
  it('bounds status and command metadata and fails on invalid states', () => {
    for (const health of [{ status: 'invented', loginCommand: null }, { status: 'ready', loginCommand: '' }, { status: 'unknown', loginCommand: null, statusMessage: 'x'.repeat(2049) }]) expect(providerReadinessResultSchema.safeParse({ supported: true, health }).success).toBe(false);
    expect(providerReadinessResultSchema.parse({ supported: true, health: { status: 'expired', loginCommand: 'fixture --device', localLoginCommand: 'fixture' } })).toMatchObject({ health: { localLoginCommand: 'fixture' } });
  });
  it('requires an explicit machine and rejects renderer supplied launch data', () => {
    expect(providerSignInRequestSchema.parse({ hostId: 'host', localBrowser: true })).toEqual({ hostId: 'host', localBrowser: true });
    for (const body of [{}, { hostId: '' }, { hostId: 'host', command: 'unsafe' }, { hostId: 'host', cwd: '/arbitrary' }, { hostId: 'host', env: {} }]) expect(providerSignInRequestSchema.safeParse(body).success).toBe(false);
  });
});
