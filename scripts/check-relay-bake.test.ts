import { describe, expect, it } from 'vitest';
import { isReleaseBuild, relayBakeWarning } from './relay-bake';

const URL = 'https://relay.example.com';

describe('relay bake check', () => {
  it('warns, without failing, for a release build with an origin and no token', () => {
    expect(relayBakeWarning({ releaseBuild: true, appUrl: URL, relayToken: '' })).toMatch(
      /ZCC_APP_URL without ZCC_RELAY_TOKEN.*SSH tunnel/
    );
    expect(relayBakeWarning({ releaseBuild: true, appUrl: URL, relayToken: '   ' })).not.toBeNull();
  });

  it('is quiet for a release build with both origin and token', () => {
    expect(relayBakeWarning({ releaseBuild: true, appUrl: URL, relayToken: 'tok' })).toBeNull();
  });

  it('is quiet for a release build with neither', () => {
    expect(relayBakeWarning({ releaseBuild: true, appUrl: '', relayToken: '' })).toBeNull();
  });

  it('is quiet for a release build with a token and no origin', () => {
    expect(relayBakeWarning({ releaseBuild: true, appUrl: '', relayToken: 'tok' })).toBeNull();
  });

  it('is quiet for non-release builds with an origin and no token', () => {
    expect(relayBakeWarning({ releaseBuild: false, appUrl: URL, relayToken: '' })).toBeNull();
  });

  it('detects release builds only from ZCC_RELEASE_BUILD=1', () => {
    expect(isReleaseBuild({ ZCC_RELEASE_BUILD: '1' })).toBe(true);
    expect(isReleaseBuild({ ZCC_RELEASE_BUILD: ' 1 ' })).toBe(true);
    expect(isReleaseBuild({ ZCC_RELEASE_BUILD: '0' })).toBe(false);
    expect(isReleaseBuild({ CI: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(isReleaseBuild({})).toBe(false);
  });
});
