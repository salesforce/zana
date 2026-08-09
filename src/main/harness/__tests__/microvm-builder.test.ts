import { describe, it, expect } from 'vitest';
import {
  authorizeMount,
  buildMicroVmConfig,
  resolveAuthorizedImage,
  MicroVmAuthorizationError,
  DEFAULT_IMAGE_ALLOWLIST,
  GUEST_WORKSPACE,
  DEFAULT_CPU_RANGE,
  DEFAULT_MEM_RANGE,
  type MicroVmPolicy
} from '../microvm-builder.js';

/**
 * The microVM authorization builder is the Rule-1/Rule-2 trust seam: image from
 * a CLOSED allowlist, mount SOURCE realpath-confined + sensitive-root-blocked,
 * resources clamped. These tests pin every denial deterministically with no VM.
 */

// A fake fs where realpath is identity (paths are already "canonical" in tests),
// so confinement logic is exercised without touching the real disk.
const idRealpath = (p: string) => p;

function policy(over: Partial<MicroVmPolicy> = {}): MicroVmPolicy {
  return {
    realpath: idRealpath,
    sensitiveRoots: () => ['/home/u/.ssh', '/home/u/.aws'],
    ...over
  };
}

describe('resolveAuthorizedImage', () => {
  it('resolves an allowlist KEY to its authorized ref', () => {
    expect(resolveAuthorizedImage('node', policy()).ref).toBe(DEFAULT_IMAGE_ALLOWLIST.node.ref);
  });

  it('resolves a concrete allowlisted REF', () => {
    const ref = DEFAULT_IMAGE_ALLOWLIST.alpine.ref;
    expect(resolveAuthorizedImage(ref, policy()).ref).toBe(ref);
  });

  it('falls back to the default image when none requested', () => {
    expect(resolveAuthorizedImage(undefined, policy()).ref).toBe(DEFAULT_IMAGE_ALLOWLIST.alpine.ref);
    expect(resolveAuthorizedImage('   ', policy()).ref).toBe(DEFAULT_IMAGE_ALLOWLIST.alpine.ref);
  });

  it('REJECTS an unlisted image (no silent downgrade to default)', () => {
    expect(() => resolveAuthorizedImage('evil.com/backdoor:latest', policy())).toThrow(
      MicroVmAuthorizationError
    );
    try {
      resolveAuthorizedImage('evil.com/backdoor:latest', policy());
    } catch (e) {
      expect((e as MicroVmAuthorizationError).code).toBe('IMAGE_DENIED');
    }
  });

  it('honors a custom allowlist + default key', () => {
    const p = policy({
      imageAllowlist: { only: { ref: 'reg/only:1' } },
      defaultImageKey: 'only'
    });
    expect(resolveAuthorizedImage(undefined, p).ref).toBe('reg/only:1');
    expect(() => resolveAuthorizedImage('node', p)).toThrow(MicroVmAuthorizationError);
  });
});

describe('authorizeMount', () => {
  it('confines to a project root and returns the guest workspace mount', () => {
    const m = authorizeMount('/proj/a/sub', policy({ projectRoots: () => ['/proj/a'] }), {
      readonly: false
    });
    expect(m).toEqual({ hostPath: '/proj/a/sub', guestPath: GUEST_WORKSPACE, readonly: false });
  });

  it('rejects a source outside every project root', () => {
    expect(() =>
      authorizeMount('/elsewhere', policy({ projectRoots: () => ['/proj/a'] }), { readonly: false })
    ).toThrow(MicroVmAuthorizationError);
  });

  it('rejects mounting a sensitive root itself', () => {
    expect(() => authorizeMount('/home/u/.ssh', policy(), { readonly: false })).toThrow(
      /sensitive root/
    );
  });

  it('rejects a source WITHIN a sensitive root', () => {
    expect(() => authorizeMount('/home/u/.ssh/keys', policy(), { readonly: false })).toThrow(
      /sensitive root/
    );
  });

  it('rejects mounting HOME because it CONTAINS a sensitive root', () => {
    // /home/u contains /home/u/.ssh — blocked by the "contains" arm.
    expect(() => authorizeMount('/home/u', policy(), { readonly: false })).toThrow(/sensitive root/);
  });

  it('applies the sensitive-root blocklist even with no project roots injected', () => {
    // No projectRoots → confinement is a no-op, but the blocklist still fires.
    expect(() => authorizeMount('/home/u/.aws', policy(), { readonly: false })).toThrow(
      MicroVmAuthorizationError
    );
    // A benign path passes when no roots are injected.
    expect(authorizeMount('/tmp/work', policy(), { readonly: true }).readonly).toBe(true);
  });

  it('rejects a non-existent source (realpath throws)', () => {
    const p = policy({
      realpath: () => {
        throw new Error('ENOENT');
      }
    });
    expect(() => authorizeMount('/gone', p, { readonly: false })).toThrow(/does not exist/);
  });
});

describe('buildMicroVmConfig', () => {
  it('clamps cpu and memory into range', () => {
    const cfg = buildMicroVmConfig(
      { cwd: '/proj/a', cpus: 999, memoryMib: 1 },
      policy({ projectRoots: () => ['/proj/a'] })
    );
    expect(cfg.cpus).toBe(DEFAULT_CPU_RANGE.max);
    expect(cfg.memoryMib).toBe(DEFAULT_MEM_RANGE.min);
  });

  it('uses defaults for absent resource hints and default image', () => {
    const cfg = buildMicroVmConfig({ cwd: '/proj/a' }, policy({ projectRoots: () => ['/proj/a'] }));
    expect(cfg.image.ref).toBe(DEFAULT_IMAGE_ALLOWLIST.alpine.ref);
    expect(cfg.workdir).toBe(GUEST_WORKSPACE);
    expect(cfg.cpus).toBeGreaterThanOrEqual(DEFAULT_CPU_RANGE.min);
    expect(cfg.memoryMib).toBeGreaterThanOrEqual(DEFAULT_MEM_RANGE.min);
  });

  it('propagates a denied image as a thrown authorization error', () => {
    expect(() =>
      buildMicroVmConfig(
        { cwd: '/proj/a', image: 'nope/x:1' },
        policy({ projectRoots: () => ['/proj/a'] })
      )
    ).toThrow(MicroVmAuthorizationError);
  });
});
