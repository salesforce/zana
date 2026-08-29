/**
 * Navigate from anywhere (store actions, shortcuts, IPC). The router registers
 * its `navigate` while the shell is mounted; without a router (unit tests)
 * callers fall back to writing destination state directly.
 */

export interface AppNavigateOptions {
  replace?: boolean;
}

type NavigateImpl = (to: string, options?: AppNavigateOptions) => void;

let navigateImpl: NavigateImpl | null = null;
let lastPath: string | null = null;

export function registerAppNavigate(fn: NavigateImpl | null): void {
  navigateImpl = fn;
  if (!fn) lastPath = null;
}

export function getLastAppNavigatePath(): string | null {
  return lastPath;
}

/**
 * Push or replace the destination path. Returns true when a router consumed
 * the call; false when the caller should apply the decoded route itself.
 */
export function appNavigate(to: string, options?: AppNavigateOptions): boolean {
  if (!navigateImpl) return false;
  lastPath = to;
  navigateImpl(to, options);
  return true;
}

export function hasAppNavigate(): boolean {
  return navigateImpl !== null;
}
