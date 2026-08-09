import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Isolation finding A: the untrusted extension child must NOT inherit the host's
 * full environment. `spawn-child.ts` imports `electron` (utilityProcess /
 * MessageChannelMain), neither of which exists in vitest, so we mock the module
 * and capture the options passed to `utilityProcess.fork`.
 */

const forkSpy = vi.fn();

vi.mock('electron', () => {
  class FakeChild {
    once() {}
    on() {}
    postMessage() {}
    kill() {}
  }
  class FakePort {
    start() {}
    on() {}
    postMessage() {}
    close() {}
  }
  return {
    utilityProcess: {
      fork: (...args: unknown[]) => {
        forkSpy(...args);
        return new FakeChild();
      }
    },
    MessageChannelMain: class {
      port1 = new FakePort();
      port2 = new FakePort();
    }
  };
});

async function importSpawn() {
  return await import('../spawn-child.js');
}

describe('spawn-child env isolation (finding A)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    forkSpy.mockClear();
  });
  afterEach(() => {
    // restore env keys we tampered with
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    Object.assign(process.env, saved);
  });

  describe('buildChildEnv', () => {
    it('includes PATH/HOME but excludes a sentinel secret', async () => {
      const { buildChildEnv } = await importSpawn();
      const env = buildChildEnv({
        PATH: '/usr/bin',
        HOME: '/home/me',
        SF_ACCESS_TOKEN: 'super-secret',
        AWS_SECRET_ACCESS_KEY: 'also-secret',
        GITHUB_TOKEN: 'ghp_xxx'
      });
      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/me');
      expect(env.SF_ACCESS_TOKEN).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
    });

    it('copies only allowlisted keys that are actually set (no empty placeholders)', async () => {
      const { buildChildEnv } = await importSpawn();
      const env = buildChildEnv({ PATH: '/bin' });
      expect(Object.keys(env)).toEqual(['PATH']);
    });

    it('forwards Electron bootstrap vars only when present', async () => {
      const { buildChildEnv } = await importSpawn();
      const withElectron = buildChildEnv({
        PATH: '/bin',
        ELECTRON_RUN_AS_NODE: '1'
      });
      expect(withElectron.ELECTRON_RUN_AS_NODE).toBe('1');
      const without = buildChildEnv({ PATH: '/bin' });
      expect('ELECTRON_RUN_AS_NODE' in without).toBe(false);
    });

    it('returns a fresh object, never the live process.env', async () => {
      const { buildChildEnv } = await importSpawn();
      const env = buildChildEnv();
      expect(env).not.toBe(process.env);
    });
  });

  describe('spawnUtilityChild forwards the trimmed env to fork', () => {
    it('passes an env that includes PATH and excludes a sentinel secret', async () => {
      process.env.PATH = process.env.PATH || '/usr/bin';
      process.env.ZCC_SENTINEL_SECRET = 'do-not-leak';

      const { spawnUtilityChild } = await importSpawn();
      spawnUtilityChild('/x/ext/main.js', 'acme.ext');

      expect(forkSpy).toHaveBeenCalledTimes(1);
      const opts = forkSpy.mock.calls[0][2] as { env?: Record<string, string> };
      expect(opts.env).toBeDefined();
      expect(opts.env!.PATH).toBeTruthy();
      expect(opts.env!.ZCC_SENTINEL_SECRET).toBeUndefined();
    });
  });
});
