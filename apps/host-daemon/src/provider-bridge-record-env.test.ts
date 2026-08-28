import { afterEach, describe, expect, it } from 'vitest';
import {
  PROVIDER_BRIDGE_RECORD_DIR_ENV,
  resetProviderBridgeRecordDirEnvSync,
  syncProviderBridgeRecordDirEnv
} from './provider-bridge-record-env.js';

afterEach(() => {
  resetProviderBridgeRecordDirEnvSync();
});

describe('syncProviderBridgeRecordDirEnv', () => {
  it('sets the data-dir default when Settings is on and the boot env is empty', () => {
    const env: NodeJS.ProcessEnv = {};
    syncProviderBridgeRecordDirEnv({
      enabled: true,
      dataDir: '/tmp/zcc-data',
      env
    });
    expect(env[PROVIDER_BRIDGE_RECORD_DIR_ENV]).toBe(
      '/tmp/zcc-data/provider-recordings/raw'
    );
  });

  it('clears a settings-applied dir when the toggle turns off', () => {
    const env: NodeJS.ProcessEnv = {};
    syncProviderBridgeRecordDirEnv({
      enabled: true,
      dataDir: '/tmp/zcc-data',
      env
    });
    syncProviderBridgeRecordDirEnv({
      enabled: false,
      dataDir: '/tmp/zcc-data',
      env
    });
    expect(env[PROVIDER_BRIDGE_RECORD_DIR_ENV]).toBeUndefined();
  });

  it('leaves a boot-exported directory alone even when Settings is off', () => {
    const env: NodeJS.ProcessEnv = {
      [PROVIDER_BRIDGE_RECORD_DIR_ENV]: '/tmp/from-shell'
    };
    syncProviderBridgeRecordDirEnv({
      enabled: false,
      dataDir: '/tmp/zcc-data',
      env
    });
    expect(env[PROVIDER_BRIDGE_RECORD_DIR_ENV]).toBe('/tmp/from-shell');
    syncProviderBridgeRecordDirEnv({
      enabled: true,
      dataDir: '/tmp/zcc-data',
      env
    });
    expect(env[PROVIDER_BRIDGE_RECORD_DIR_ENV]).toBe('/tmp/from-shell');
  });
});
