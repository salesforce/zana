/**
 * microVM authorization builder — the Rule-1 seam for the `microvm` execution
 * environment, the trust twin of the `create()` argv/env assembly. Every
 * value that widens the microVM's blast radius — the OCI image ref, the RW bind
 * mount source, cpu/memory ceilings, published ports — is AUTHORIZED here, in
 * main, from trusted inputs only. A renderer- or agent-supplied hint can only
 * SELECT among already-authorized options; it can never define one.
 *
 * WHY A PURE BUILDER
 * ------------------
 * The environment adapter (`microvm-environment.ts`) owns the async SDK calls
 * and can't be unit-tested without the native addon. This module is a PURE
 * function of its inputs (+ injectable probes) so the security-critical
 * decisions — image allowlist, mount-source realpath confinement + sensitive-
 * root blocklist, resource clamps — get deterministic test coverage with no VM.
 *
 * The three new trust decisions microsandbox introduces over Seatbelt (design
 * §"Security model") all live here:
 *   1. [Rule 1] Image ref is resolved from a closed allowlist + digest-pinned
 *      built-ins — never renderer/agent free-text.
 *   2. [Rule 2] Mount SOURCE is realpath-confined to a registered project root
 *      and rejected if it is (or contains) a sensitive root (~/.ssh, ~/.aws, …).
 *   3. [Rule 1] Published host ports are chosen by main (safe high port, bound
 *      to 127.0.0.1), never taken as an arbitrary agent-requested port.
 */

import { realpathSync } from 'node:fs';
import { isWithin } from '../extensions/path-util.js';
import { sensitiveRoots as defaultSensitiveRoots } from '../extensions/permission-broker.js';

/** A registry image reference plus, for a built-in profile, its pinned digest. */
export interface AuthorizedImage {
  /** The image reference to pull, e.g. `docker.io/library/alpine:3.20`. */
  ref: string;
  /** SHA-256 digest a built-in profile is pinned to (supply-chain integrity). */
  digest?: string;
}

/** A realpath-confined RW (or RO) bind mount handed to `.volume(guest, b => b.bind(host))`. */
export interface AuthorizedMount {
  /** Canonical host path (already realpath'd + confined). */
  hostPath: string;
  /** Guest mount point. */
  guestPath: string;
  /** Mount read-only (agent can read but not write the host tree). */
  readonly: boolean;
}

/** The fully-authorized microVM config the environment adapter feeds to the SDK builder. */
export interface AuthorizedMicroVmConfig {
  image: AuthorizedImage;
  /** The workspace bind mount (agent's cwd → guest workdir). */
  workspaceMount: AuthorizedMount;
  /** Guest working directory (== workspaceMount.guestPath). */
  workdir: string;
  cpus: number;
  memoryMib: number;
}

/** Inputs to the authorization pass. All trusted (assembled in main). */
export interface MicroVmBuildRequest {
  /**
   * Requested image key or ref — an ADVISORY hint (from a launcher field /
   * persona / project setting). Resolved against the allowlist; an unlisted or
   * absent value falls back to the default built-in image.
   */
  image?: string;
  /** The agent's canonical (already cwd-confined) workspace root — the bind source. */
  cwd: string;
  /** Requested cpu count (advisory; clamped to [MIN,MAX]). */
  cpus?: number;
  /** Requested memory MiB (advisory; clamped to [MIN,MAX]). */
  memoryMib?: number;
  /** Mount the workspace read-only (a read-only agent). Default false (RW). */
  readonlyWorkspace?: boolean;
}

/** Injectable policy so tests don't depend on the real HOME / registry allowlist. */
export interface MicroVmPolicy {
  /**
   * The closed image allowlist: key → authorized image. The KEY is what a
   * launcher/persona references; the VALUE carries the concrete ref + digest.
   * A ref not present as a value here (and not a key) is rejected. NO `"*"`.
   */
  imageAllowlist?: Record<string, AuthorizedImage>;
  /** Which allowlist key is the default when the request names none/unknown. */
  defaultImageKey?: string;
  /** Registered project roots the mount source must resolve within (Rule 2). */
  projectRoots?: () => string[];
  /** Sensitive roots to reject as (or containing) a mount source. */
  sensitiveRoots?: () => string[];
  /** Test seam for realpath (defaults to the real fs). */
  realpath?: (p: string) => string;
  cpuRange?: { min: number; max: number };
  memRange?: { min: number; max: number };
}

/**
 * The shipped default image allowlist. Closed set, registries pinned to
 * docker.io library images. Digests are placeholders until the go-live pass
 * pins real SHA-256s (design §5 / P0-5 "digest pinning"); the ref alone is
 * still authorized, the digest just adds supply-chain integrity when present.
 *
 * NOTE: no `"*"` entry — an arbitrary registry image is opt-in via an explicit
 * `AppConfig` allowlist entry, never a default (design §5).
 */
export const DEFAULT_IMAGE_ALLOWLIST: Record<string, AuthorizedImage> = {
  alpine: { ref: 'docker.io/library/alpine:3.20' },
  ubuntu: { ref: 'docker.io/library/ubuntu:24.04' },
  node: { ref: 'docker.io/library/node:22-bookworm-slim' },
  python: { ref: 'docker.io/library/python:3.12-slim' }
};

export const DEFAULT_IMAGE_KEY = 'alpine';

/** Clamp defaults — a microVM is "light for a VM", not a fleet host. */
export const DEFAULT_CPU_RANGE = { min: 1, max: 8 };
export const DEFAULT_MEM_RANGE = { min: 256, max: 8192 };
const DEFAULT_CPUS = 2;
const DEFAULT_MEM_MIB = 1024;

/** Guest mount point for the workspace (a stable, conventional path). */
export const GUEST_WORKSPACE = '/workspace';

export class MicroVmAuthorizationError extends Error {
  constructor(
    message: string,
    readonly code: 'IMAGE_DENIED' | 'MOUNT_DENIED'
  ) {
    super(message);
    this.name = 'MicroVmAuthorizationError';
  }
}

function clamp(value: number | undefined, fallback: number, range: { min: number; max: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(range.max, Math.max(range.min, n));
}

/**
 * Resolve the requested image against the closed allowlist (Rule 1). The
 * request value may be either an allowlist KEY (`"node"`) or a concrete
 * authorized REF (`"docker.io/library/node:22-bookworm-slim"`). Anything else
 * — including an arbitrary `evil.com/backdoor:latest` — is REJECTED (never
 * silently downgraded to the default, so a caller asking for a specific image
 * gets an honest denial rather than a surprise different image).
 */
export function resolveAuthorizedImage(
  requested: string | undefined,
  policy: MicroVmPolicy
): AuthorizedImage {
  const allowlist = policy.imageAllowlist ?? DEFAULT_IMAGE_ALLOWLIST;
  const defaultKey = policy.defaultImageKey ?? DEFAULT_IMAGE_KEY;
  const req = requested?.trim();
  if (!req) {
    const def = allowlist[defaultKey];
    if (!def) {
      throw new MicroVmAuthorizationError(
        `default microVM image key "${defaultKey}" is not in the allowlist`,
        'IMAGE_DENIED'
      );
    }
    return def;
  }
  // A bare allowlist key.
  if (allowlist[req]) return allowlist[req];
  // A concrete ref that matches an allowlisted value exactly.
  const byRef = Object.values(allowlist).find((img) => img.ref === req);
  if (byRef) return byRef;
  throw new MicroVmAuthorizationError(
    `image "${req}" is not in the microVM allowlist (closed set — no "*" default)`,
    'IMAGE_DENIED'
  );
}

/**
 * Realpath-confine the mount SOURCE to a registered project root and reject a
 * sensitive root (Rule 2). Mounting `~` is rejected because it CONTAINS
 * `~/.ssh`; a symlink-escape `~/proj/../.ssh` is realpath'd first, then denied.
 * When no project roots are injected (unit tests / a not-yet-wired path), the
 * confinement check is a no-op — matching `PtyManager.assertCwdConfined` — but
 * the sensitive-root blocklist ALWAYS applies (it needs no registry).
 */
export function authorizeMount(
  cwd: string,
  policy: MicroVmPolicy,
  opts: { readonly: boolean; guestPath?: string }
): AuthorizedMount {
  const rp = policy.realpath ?? realpathSync;
  let canonical: string;
  try {
    canonical = rp(cwd);
  } catch {
    throw new MicroVmAuthorizationError(`mount source does not exist: ${cwd}`, 'MOUNT_DENIED');
  }

  // Sensitive-root blocklist (always enforced). Reject if the source IS, is
  // WITHIN, or CONTAINS a sensitive root — the last case blocks mounting `~`
  // (which contains ~/.ssh) or `/` (which contains everything).
  const sensitive = (policy.sensitiveRoots ?? defaultSensitiveRoots)();
  for (const s of sensitive) {
    if (canonical === s || isWithin(canonical, s) || isWithin(s, canonical)) {
      throw new MicroVmAuthorizationError(
        `mount source ${canonical} is or contains a sensitive root (${s})`,
        'MOUNT_DENIED'
      );
    }
  }

  // Project-root confinement (skipped only when no registry is injected).
  const roots = policy.projectRoots?.() ?? null;
  if (roots && roots.length > 0) {
    const ok = roots.some((root) => {
      let canonRoot: string;
      try {
        canonRoot = rp(root);
      } catch {
        return false;
      }
      return canonical === canonRoot || isWithin(canonical, canonRoot);
    });
    if (!ok) {
      throw new MicroVmAuthorizationError(
        `mount source ${canonical} is outside every registered project root`,
        'MOUNT_DENIED'
      );
    }
  }

  return {
    hostPath: canonical,
    guestPath: opts.guestPath ?? GUEST_WORKSPACE,
    readonly: opts.readonly
  };
}

/**
 * Authorize a full microVM launch config from a trusted request (Rule 1). Throws
 * {@link MicroVmAuthorizationError} on a denied image or mount so the caller can
 * fail closed with an honest reason. Resource requests are clamped, never
 * rejected (a too-big ask is a UX papercut, not a security boundary).
 */
export function buildMicroVmConfig(
  req: MicroVmBuildRequest,
  policy: MicroVmPolicy = {}
): AuthorizedMicroVmConfig {
  const image = resolveAuthorizedImage(req.image, policy);
  const workspaceMount = authorizeMount(req.cwd, policy, {
    readonly: !!req.readonlyWorkspace,
    guestPath: GUEST_WORKSPACE
  });
  return {
    image,
    workspaceMount,
    workdir: workspaceMount.guestPath,
    cpus: clamp(req.cpus, DEFAULT_CPUS, policy.cpuRange ?? DEFAULT_CPU_RANGE),
    memoryMib: clamp(req.memoryMib, DEFAULT_MEM_MIB, policy.memRange ?? DEFAULT_MEM_RANGE)
  };
}
