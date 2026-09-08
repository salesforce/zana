import { describe, expect, it } from 'vitest';
import {
  PluginServiceUnavailableError,
  bindPluginServices,
  createPluginServicesRegistry
} from './plugin-services.js';

describe('plugin services registry', () => {
  it('provides by plugin id and dispatches through a live proxy', () => {
    const registry = createPluginServicesRegistry();
    const sdk = { n: 1, ping: () => 'one' };
    registry.provide('alpha', sdk);
    const handle = registry.use<{ n: number; ping: () => string }>('alpha');
    expect(handle.n).toBe(1);
    expect(handle.ping()).toBe('one');
    expect('ping' in handle).toBe(true);
  });

  it('throws service_unavailable until a provider is registered', () => {
    const registry = createPluginServicesRegistry();
    const handle = registry.use<{ ping: () => string }>('alpha');
    expect(() => handle.ping()).toThrow(PluginServiceUnavailableError);
    try {
      handle.ping();
    } catch (error) {
      expect(error).toMatchObject({ code: 'service_unavailable', serviceId: 'alpha' });
    }
  });

  it('replaces the impl on reload without dropping live proxies', () => {
    const registry = createPluginServicesRegistry();
    const handle = registry.use<{ ping: () => string }>('alpha');
    const unregisterFirst = registry.provide('alpha', { ping: () => 'v1' });
    expect(handle.ping()).toBe('v1');
    registry.provide('alpha', { ping: () => 'v2' });
    unregisterFirst();
    expect(handle.ping()).toBe('v2');
  });

  it('unregisters only the generation that dispose owns', () => {
    const registry = createPluginServicesRegistry();
    const unregister = registry.provide('alpha', { ping: () => 'v1' });
    registry.provide('alpha', { ping: () => 'v2' });
    unregister();
    expect(registry.use<{ ping: () => string }>('alpha').ping()).toBe('v2');
  });

  it('keys provide() to the calling plugin, so another plugin cannot impersonate it', () => {
    const registry = createPluginServicesRegistry();
    const disposeHooks: Array<() => void> = [];
    const alpha = bindPluginServices('alpha', registry, (hook) => disposeHooks.push(hook));
    const beta = bindPluginServices('beta', registry, (hook) => disposeHooks.push(hook));
    beta.provide({ ping: () => 'beta' });
    expect(() => alpha.use<{ ping: () => string }>('alpha').ping()).toThrow(
      PluginServiceUnavailableError
    );
    expect(beta.use<{ ping: () => string }>('beta').ping()).toBe('beta');
  });

  it('unbinds on dispose so later calls fail', () => {
    const registry = createPluginServicesRegistry();
    const disposeHooks: Array<() => void> = [];
    const services = bindPluginServices('alpha', registry, (hook) => disposeHooks.push(hook));
    services.provide({ ping: () => 'ok' });
    expect(registry.has('alpha')).toBe(true);
    for (const hook of disposeHooks) hook();
    expect(registry.has('alpha')).toBe(false);
    expect(() => services.use<{ ping: () => string }>('alpha').ping()).toThrow(
      /unavailable/
    );
  });

  it('exposes has() on the bound API', () => {
    const registry = createPluginServicesRegistry();
    const disposeHooks: Array<() => void> = [];
    const alpha = bindPluginServices('alpha', registry, (hook) => disposeHooks.push(hook));
    const beta = bindPluginServices('beta', registry, (hook) => disposeHooks.push(hook));
    expect(beta.has('alpha')).toBe(false);
    expect(alpha.has('alpha')).toBe(false);
    alpha.provide({ ping: () => 'ok' });
    expect(beta.has('alpha')).toBe(true);
    expect(alpha.has('alpha')).toBe(true);
    expect(beta.has('missing')).toBe(false);
  });

  it('rejects an empty id or non-object provide', () => {
    const registry = createPluginServicesRegistry();
    expect(() => registry.provide('', { ping: () => 'x' })).toThrow(/id is required/);
    expect(() => registry.provide('alpha', null as never)).toThrow(/must be an object/);
    expect(() => registry.use('')).toThrow(/id is required/);
  });
});
