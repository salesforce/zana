import { afterEach, describe, expect, it, vi } from 'vitest';
import mobileConfig from '../../app.config';
import type { ConfigContext } from 'expo/config';

const base = {
  config: {
    name: 'Zana',
    slug: 'zana-mobile',
    ios: { bundleIdentifier: 'ai.zana.mobile' },
    android: { package: 'ai.zana.mobile' },
    extra: { existing: true, eas: { existing: true } }
  }
} as ConfigContext;

afterEach(() => vi.unstubAllEnvs());
function clearBuildEnv() {
  for (const name of ['EXPO_PUBLIC_EAS_PROJECT_ID', 'EXPO_OWNER', 'GOOGLE_SERVICES_JSON'])
    vi.stubEnv(name, '');
}

describe('native release configuration', () => {
  it('keeps local builds independent of release accounts', () => {
    clearBuildEnv();
    expect(mobileConfig(base)).toEqual(base.config);
    expect(mobileConfig({ config: {} } as ConfigContext)).toEqual({
      name: 'Zana',
      slug: 'zana-mobile'
    });
  });
  it('wires EAS identity and Android Firebase config without replacing native settings', () => {
    clearBuildEnv();
    const projectId = 'aabbccdd-1111-2222-3333-0123456789ab';
    vi.stubEnv('EXPO_PUBLIC_EAS_PROJECT_ID', ` ${projectId} `);
    vi.stubEnv('EXPO_OWNER', ' zana-team ');
    vi.stubEnv('GOOGLE_SERVICES_JSON', '/tmp/build/google-services.json');
    vi.stubEnv('EXPO_TOKEN', 'never-include-this-in-the-app');
    const result = mobileConfig(base);
    expect(result).toMatchObject({
      owner: 'zana-team',
      ios: base.config.ios,
      android: { package: 'ai.zana.mobile', googleServicesFile: '/tmp/build/google-services.json' },
      extra: { existing: true, eas: { existing: true, projectId } }
    });
    expect(JSON.stringify(result)).not.toContain('never-include-this-in-the-app');
    expect(base.config.android).not.toHaveProperty('googleServicesFile');
    expect(mobileConfig({ config: {} } as ConfigContext).extra?.eas.projectId).toBe(projectId);
  });
  it('rejects a mistaken project slug with an actionable message', () => {
    clearBuildEnv();
    vi.stubEnv('EXPO_PUBLIC_EAS_PROJECT_ID', '@someone/zana-mobile');
    expect(() => mobileConfig(base)).toThrow('must be the UUID');
  });
});
