import { ControlError } from './errors.js';
import { preflight, type HarnessVerifyRow } from './harness.js';
import type { Zcc } from './client.js';

export function liveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZCC_LIVE_CONTROL === '1';
}

export type PreflightSkip = { skip: true; reason: string };

export async function preflightOrSkip(
  zcc: Zcc,
  opts: { surface: 'thread' | 'cli-agent'; providerId?: string; profile?: string }
): Promise<HarnessVerifyRow | PreflightSkip> {
  try {
    return await preflight(zcc.http, opts);
  } catch (error) {
    if (error instanceof ControlError && error.code === 'PREFLIGHT') {
      return { skip: true, reason: error.message };
    }
    throw error;
  }
}

export function isSkip(value: { skip?: unknown } | object): value is PreflightSkip {
  return 'skip' in value && (value as { skip?: unknown }).skip === true;
}
