/**
 * Pure navigation/popup policy for the in-app browser view. Kept free of any
 * `electron` import so it can be unit tested under vitest's node environment.
 */

export function isAllowedBrowserUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

export interface WindowOpenDecision {
  openTabUrl: string | null;
}

export function resolveWindowOpenAction(url: string): WindowOpenDecision {
  return { openTabUrl: isAllowedBrowserUrl(url) ? url : null };
}

export interface PopupRateDecision {
  allowed: boolean;
  timestamps: number[];
}

export interface EvaluatePopupRateArgs {
  timestamps: readonly number[];
  now: number;
  windowMs: number;
  maxInWindow: number;
}

export function evaluatePopupRate({
  timestamps,
  now,
  windowMs,
  maxInWindow
}: EvaluatePopupRateArgs): PopupRateDecision {
  const recent = timestamps.filter((stamp) => now - stamp < windowMs);
  if (recent.length >= maxInWindow) {
    return { allowed: false, timestamps: recent };
  }
  return { allowed: true, timestamps: [...recent, now] };
}

export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === 'clipboard-sanitized-write';
}
