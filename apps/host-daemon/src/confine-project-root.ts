import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';

/** Stable refusal for a project root that does not resolve inside a registered project. */
export class ProjectRootConfinementError extends Error {
  constructor(readonly code: 'root-outside-project' | 'root-unavailable', message: string) {
    super(message);
    this.name = 'ProjectRootConfinementError';
  }
}

/**
 * A root named by the server is trusted only after its realpath matches, or
 * nests inside, the realpath of a project this machine registered. Returns the
 * resolved path; the caller hands that, never the requested spelling, onward.
 */
export async function confineRegisteredProjectRoot(requestedRoot: string, registeredRoots: readonly string[]): Promise<string> {
  if (!isAbsolute(requestedRoot)) {
    throw new ProjectRootConfinementError('root-unavailable', 'project root must be absolute');
  }
  let real: string;
  try {
    real = await realpath(requestedRoot);
  } catch {
    throw new ProjectRootConfinementError('root-unavailable', 'project root is unavailable on this host');
  }
  for (const root of registeredRoots) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      continue; // a registered folder that vanished authorizes nothing
    }
    if (isWithin(real, realRoot)) return real;
  }
  throw new ProjectRootConfinementError('root-outside-project', 'root-outside-project');
}
