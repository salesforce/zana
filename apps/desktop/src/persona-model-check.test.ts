import { describe, expect, it, vi } from 'vitest';
import { unknownLegacyPersonaModel, unknownPersonaModelMessage, warnUnknownPersonaModels } from './persona-model-check.js';

const provider = (over: Record<string, unknown> = {}, models: Array<{ id: string }> | null = [{ id: 'm1' }]) => ({
  adapter: { descriptor: { label: 'Fake', targets: models ? { models } : undefined } },
  ...over
}) as never;

describe('unknownLegacyPersonaModel', () => {
  it('flags a model absent from the static catalog', () => {
    expect(unknownLegacyPersonaModel(provider(), { model: 'bogus' })).toBe('bogus');
  });
  it('accepts a listed model', () => {
    expect(unknownLegacyPersonaModel(provider(), { model: ' m1 ' })).toBeUndefined();
  });
  it.each([[undefined], [''], ['  '], ['default']])('ignores persona model %j', (model) => {
    expect(unknownLegacyPersonaModel(provider(), { model })).toBeUndefined();
  });
  it('ignores a missing persona', () => {
    expect(unknownLegacyPersonaModel(provider(), undefined)).toBeUndefined();
  });
  it('never flags a provider that accepts unlisted targets', () => {
    expect(unknownLegacyPersonaModel(provider({ acceptsUnlistedModelTargets: true }), { model: 'bogus' })).toBeUndefined();
  });
  it('cannot answer for a live-probed provider', () => {
    expect(unknownLegacyPersonaModel(provider({ discoverModelTargets: async () => [] }), { model: 'bogus' })).toBeUndefined();
  });
  it('cannot answer when the catalog is empty or absent', () => {
    expect(unknownLegacyPersonaModel(provider({}, []), { model: 'bogus' })).toBeUndefined();
    expect(unknownLegacyPersonaModel(provider({}, null), { model: 'bogus' })).toBeUndefined();
  });
  it('words the notice without paths', () => {
    expect(unknownPersonaModelMessage('P', 'x', 'Fake')).toContain('model "x"');
  });
});

describe('warnUnknownPersonaModels', () => {
  const project = { id: 'p1', name: 'Proj' };
  const base = () => ({
    slots: [{ personaId: 'a' }, { personaId: 'a' }, { personaId: 'ghost' }],
    personas: [{ id: 'a', name: 'Alpha', model: 'bogus' }],
    providerFor: () => provider() as never,
    project,
    notify: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn()
  });

  it('notifies once per persona with a stable dedupe key and skips unresolved personas', () => {
    const deps = base();
    warnUnknownPersonaModels(deps);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify.mock.calls[0][0]).toMatchObject({ projectId: 'p1', dedupeKey: 'persona-unknown-model:p1:a:bogus' });
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it('stays silent when the catalog cannot answer', () => {
    const deps = { ...base(), providerFor: () => provider({ acceptsUnlistedModelTargets: true }) as never };
    warnUnknownPersonaModels(deps);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('contains a provider lookup throw and a notify rejection', async () => {
    const throwing = { ...base(), providerFor: () => { throw new Error('boom'); } };
    expect(() => warnUnknownPersonaModels(throwing)).not.toThrow();
    expect(throwing.onError).toHaveBeenCalledWith('persona model check', expect.any(Error));
    const rejecting = { ...base(), notify: vi.fn().mockRejectedValue(new Error('inbox')) };
    warnUnknownPersonaModels(rejecting);
    await Promise.resolve(); await Promise.resolve();
    expect(rejecting.onError).toHaveBeenCalledWith('persona model warning inbox', expect.any(Error));
  });
});
