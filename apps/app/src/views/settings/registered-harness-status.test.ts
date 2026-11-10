import { describe, expect, it } from 'vitest';
import { registeredHarnessStatus as status } from './registered-harness-status.js';

const base = { connected: true, checking: false };
const entry = { models: [], selectedOnlyModels: [], modelLoadError: null };
describe('registered harness status', () => {
  it('does not infer runtime readiness from a plugin registration', () => {
    expect(status(base).label).toBe('Models not loaded yet');
    expect(status({ ...base, entry }).label).toContain('No models returned');
  });
  it('retains unavailable plugin declarations and their recovery reason', () => {
    expect(status({ ...base, available: false, unavailableReason: 'Bridge failed' })).toEqual({ tone: 'warn', label: 'Bridge failed' });
    expect(status({ ...base, available: false }).label).toContain('Open its details');
  });
  it('uses machine connectivity before cached model availability', () => {
    expect(status({ ...base, connected: false, entry: { ...entry, models: [{}] as never } }).label).toContain('disconnected');
  });
  it('distinguishes installation, sign-in, unknown failure and stale model results', () => {
    expect(status({ ...base, installed: false }).label).toContain('not installed');
    expect(status({ ...base, entry: { ...entry, modelLoadError: 'auth_required' } }).label).toBe('Sign in to load models');
    expect(status({ ...base, entry: { ...entry, modelLoadError: 'failed', modelLoadErrorDetail: 'Bridge crashed' } }).label).toBe('Bridge crashed');
    expect(status({ ...base, entry: { ...entry, models: [{}] as never, modelLoadError: 'timeout' } }).label).toContain('Previously loaded models');
  });
  it('does not present roster failures or provisional models as verified availability', () => {
    expect(status({ ...base, rosterError: 'Offline' })).toEqual({ tone: 'warn', label: 'Could not check provider availability: Offline' });
    expect(status({ ...base, provisional: true, entry: { ...entry, models: [{}] as never } })).toEqual({ tone: 'muted', label: 'Previously loaded models · checking availability…' });
  });
  it('describes successful catalogue evidence without claiming authentication', () => {
    expect(status({ ...base, entry: { ...entry, models: [{}] as never } })).toEqual({ tone: 'ok', label: '1 model available' });
    expect(status({ ...base, checking: true, entry: { ...entry, models: [{}, {}] as never } }).label).toBe('2 models available · refreshing…');
    expect(status({ ...base, checking: true }).label).toBe('Checking model availability…');
  });
});
