/**
 * The one place that owns every native tool policy time bound.
 *
 * A call has a decision phase (plugin handlers answer allow, deny or ask) and,
 * when a handler answers `ask`, an approval phase where a human decides. The
 * deciding side (Electron main for PTYs, the server route for Modern threads)
 * bounds the whole exchange with a per-call ceiling. Every transport between the
 * agent and that decider sits above the largest ceiling, so a hung decider
 * still produces the decider's own deny and the transport timeout only ever
 * bounds a hung decider. Every expiry denies.
 */

/** Whole decision phase for one call: all plugin handlers together. */
export const DECISION_PHASE_MAX_MS = 9_000;

/** Approval phase bounds for an `ask` decision. */
export const ASK_APPROVAL_MS = { min: 10_000, max: 120_000, default: 60_000 } as const;

/** Margin the decider keeps beyond its two phases to answer before it gives up. */
export const CEILING_MARGIN_MS = 1_000;

/**
 * Budget of the post (settled) phase. It is observational: relays post it
 * fire-and-forget, so this only bounds the background request and never delays
 * the tool's completion.
 */
export const TOOL_SETTLED_POST_MS = 1_500;

/** Extra room transports keep above the largest ceiling. */
export const BACKSTOP_MARGIN_MS = 4_000;

/** Clamp a plugin-requested approval wait into the host range; absent or invalid is the default. */
export function clampAskApprovalMs(requested: unknown): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return ASK_APPROVAL_MS.default;
  return Math.min(ASK_APPROVAL_MS.max, Math.max(ASK_APPROVAL_MS.min, Math.floor(requested)));
}

/** The decider's per-call ceiling: decision phase, plus approval phase when asked, plus margin. */
export function mainCeilingMs(decisionMs: number, approvalMs?: number): number {
  return decisionMs + (approvalMs ?? 0) + CEILING_MARGIN_MS;
}

/** The largest per-call ceiling any call can reach. */
export const MAX_MAIN_CEILING_MS = mainCeilingMs(DECISION_PHASE_MAX_MS, ASK_APPROVAL_MS.max);

/** Transport timeout (relay curl, hook, bridge await): above every ceiling. */
export const RELAY_BACKSTOP_MS = MAX_MAIN_CEILING_MS + BACKSTOP_MARGIN_MS;

/** Whole seconds for a shell `curl -m`, rounded up so the backstop is never shortened. */
export const RELAY_BACKSTOP_SEC = Math.ceil(RELAY_BACKSTOP_MS / 1_000);

/** Seconds a harness lets a hook command run: past curl's bound so the relay's own deny prints first. */
export const HOOK_TIMEOUT_SEC = RELAY_BACKSTOP_SEC + 6;

/**
 * The approval card an `ask` decision opens. The host renders it, never a
 * plugin: the renderer id contains a colon, which `ui.requestInput` refuses in
 * a plugin-supplied renderer id, so only the host can open this card.
 */
export const TOOL_POLICY_ASK_RENDERER_ID = 'zcc:tool-policy-ask';
export const TOOL_POLICY_ASK_PROMPT_MAX_CHARS = 2_000;
export const TOOL_POLICY_ASK_INPUT_PREVIEW_MAX_CHARS = 600;

export interface ToolPolicyAskCardData {
  kind: 'tool-policy-ask';
  toolName: string;
  prompt: string;
  inputPreview: string;
}

/** The card's data, or null for a payload that is not an ask card. */
export function parseToolPolicyAskCard(data: unknown): ToolPolicyAskCardData | null {
  if (typeof data !== 'object' || data === null) return null;
  const card = data as Record<string, unknown>;
  if (card.kind !== 'tool-policy-ask' || typeof card.toolName !== 'string' || typeof card.prompt !== 'string') return null;
  return {
    kind: 'tool-policy-ask',
    toolName: card.toolName,
    prompt: card.prompt,
    inputPreview: typeof card.inputPreview === 'string' ? card.inputPreview : ''
  };
}

/** The answer a human gives on the card. Anything but an exact allow denies. */
export function isToolPolicyAskAllow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && (value as { decision?: unknown }).decision === 'allow';
}

/** Plain text for the card: control characters removed, trimmed, capped. */
export function sanitizeToolPolicyAskText(text: string, maxChars: number): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned;
}
