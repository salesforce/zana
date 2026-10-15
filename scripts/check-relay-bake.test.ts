import { describe, expect, it } from 'vitest';
import { assertRelayBake, isReleaseBuild } from './relay-bake';

const URL = 'https://relay.example.com';

describe('relay bake guard', () => {
  it('throws for a release build with an origin and no token', () => {
    expect(() => assertRelayBake({ releaseBuild: true, appUrl: URL, relayToken: '' })).toThrow(
      /ZCC_APP_URL without ZCC_RELAY_TOKEN/
    );
    expect(() => assertRelayBake({ releaseBuild: true, appUrl: URL, relayToken: '   ' })).toThrow();
  });

  it('allows a release build with both origin and token', () => {
    expect(() => assertRelayBake({ releaseBuild: true, appUrl: URL, relayToken: 'tok' })).not.toThrow();
  });

  it('allows a release build with neither', () => {
    expect(() => assertRelayBake({ releaseBuild: true, appUrl: '', relayToken: '' })).not.toThrow();
  });

  it('allows a release build with a token and no origin', () => {
    expect(() => assertRelayBake({ releaseBuild: true, appUrl: '', relayToken: 'tok' })).not.toThrow();
  });

  it('allows non-release builds with an origin and no token', () => {
    expect(() => assertRelayBake({ releaseBuild: false, appUrl: URL, relayToken: '' })).not.toThrow();
  });

  it('detects release builds only from ZCC_RELEASE_BUILD=1', () => {
    expect(isReleaseBuild({ ZCC_RELEASE_BUILD: '1' })).toBe(true);
    expect(isReleaseBuild({ ZCC_RELEASE_BUILD: ' 1 ' })).toBe(true);
    expect(isReleaseBuild({ ZCC_RELEASE_BUILD: '0' })).toBe(false);
    expect(isReleaseBuild({ CI: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(isReleaseBuild({})).toBe(false);
  });
});
