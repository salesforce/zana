/**
 * Host approvals for actions a user starts from a plugin's own button, where
 * no thread exists to carry a confirmation card. The app asks the host, the
 * host draws the sheet and signs what the user approved, and the plugin's
 * server rebuilds the same binding from its own sources and consumes the token
 * with `zcc.ui.experimental_consumeApproval` before acting.
 */

/** What one approval covers. Every field is signed; rebuild it server-side, never trust the app's copy. */
export interface PluginApprovalBinding {
  /** Plugin-defined lowercase id, such as "agent.activate". */
  action: string;
  /** Stable id of what changes, such as an org id. */
  target: string;
  /** How the sheet names the target, such as "agentaidev (sandbox)". */
  targetLabel: string;
  /** What the action applies to, such as "Help_Agent v3". */
  subject: string;
  /** The content revision approved, such as a source SHA. */
  revision?: string;
  /** When set, the user must type exactly this to approve (an org alias for production). */
  confirmText?: string;
}

/** The sheet the host draws. Only `binding` is signed; the other fields explain it. */
export interface PluginApprovalRequest {
  binding: PluginApprovalBinding;
  /** At most 120 characters. */
  title: string;
  /** At most 600 characters. */
  summary?: string;
  /** At most 8 lines of 240 characters. */
  details?: string[];
  /** The approve button's label, at most 40 characters. Defaults to "Approve". */
  confirmLabel?: string;
  /** `danger` draws a red approve button. */
  tone?: 'default' | 'danger';
}

/**
 * `unavailable`: no desktop host can draw the sheet (web, mobile, headless).
 * `busy`: another approval sheet is open on this window. `invalid`: the request
 * failed validation or names a plugin that is not running.
 */
export type PluginApprovalResult =
  | { approved: true; token: string; expiresAt: number }
  | { approved: false; reason: 'cancelled' | 'unavailable' | 'busy' | 'invalid' };
