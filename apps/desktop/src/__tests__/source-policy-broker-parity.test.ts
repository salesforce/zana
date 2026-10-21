import { afterEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { SENSITIVE_HOME_PATHS, SENSITIVE_HOME_PATHS_OUTSIDE_BROKER, resolveSourcePolicy, sourcePathRefusal } from '@zana-ai/zcc-server/services/execution/source-policy';
import { sensitiveRoots } from '../extensions/permission-broker.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('source policy and permission broker', () => {
  it('refuses, as a Squad source, every root the broker never lets a plugin write', async () => {
    vi.stubEnv('ZCC_DATA_DIR', '');
    const policy = await resolveSourcePolicy(realpath, { home: homedir() });
    for (const root of sensitiveRoots()) {
      expect(sourcePathRefusal(join(root, 'secret-file'), policy), root).toBe('sensitive');
    }
  });

  it('documents every protected entry the broker does not list, in one constant', async () => {
    const brokerRoots = sensitiveRoots().map((root) => root.toLowerCase());
    const home = await realpath(homedir());
    for (const entry of SENSITIVE_HOME_PATHS) {
      const inBroker = brokerRoots.includes(join(home, entry).toLowerCase()) || brokerRoots.includes(join(homedir(), entry).toLowerCase());
      expect(SENSITIVE_HOME_PATHS_OUTSIDE_BROKER.includes(entry), entry).toBe(!inBroker);
    }
    for (const entry of SENSITIVE_HOME_PATHS_OUTSIDE_BROKER) expect(SENSITIVE_HOME_PATHS).toContain(entry);
  });
});
