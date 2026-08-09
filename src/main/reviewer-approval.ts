/**
 * Reviewer approval micro-call — the "Approve for me" tier's brain.
 *
 * The fail-CLOSED inverse of the Overseer cascade: it may DOWNGRADE an "ask the
 * human" broker decision to an auto-approve, and ONLY for a narrow eligible set
 * the deterministic broker already considers grantable. It can never upgrade a
 * deterministic DENY. Any uncertainty (< REVIEWER_MIN_CONFIDENCE), off-shape
 * reply, or error resolves to 'ask' (the human decides).
 *
 * DI + never-throws, mirroring feed-noise-classifier.ts / inbox-summary.ts. The
 * verdict cache is read SYNCHRONOUSLY by the broker gate (can() is sync); a miss
 * schedules a background consult so a repeat of the same request can approve.
 */
import type { LlmRunResult } from '../shared/types.js';

export interface ReviewerRequest {
  moduleId: string;
  /** ExtensionPermission token, e.g. 'exec' | 'fs:read' | 'net'. */
  permission: string;
  /** Host-built one-line summary of the request; the model sees this, not raw agent text. */
  summary: string;
}

/** Never 'deny' — deny stays deterministic in the broker. */
export type ReviewerVerdict = 'approve' | 'ask';

export interface ReviewerDeps {
  /** Run the reviewer prompt; NEVER throws (resolve ok:false on failure). */
  runReview: (req: ReviewerRequest, dedupeKey: string) => Promise<LlmRunResult>;
}

export const REVIEWER_MIN_CONFIDENCE = 0.8;

/**
 * Parse the strict {decision,confidence} reply. Tolerant of surrounding prose
 * (extract first {...}); everything off-shape / low-confidence / non-approve →
 * 'ask'. Pure; exported for tests. The untrusted tool payload cannot flip this:
 * only a well-formed high-confidence "approve" yields approve.
 */
export function parseReviewerVerdict(text: string): ReviewerVerdict {
  if (!text || !text.trim()) return 'ask';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return 'ask';
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return 'ask';
  }
  if (!obj || typeof obj !== 'object') return 'ask';
  const raw = obj as Record<string, unknown>;
  if (raw.decision !== 'approve') return 'ask';
  if (typeof raw.confidence !== 'number' || Number.isNaN(raw.confidence)) return 'ask';
  return raw.confidence >= REVIEWER_MIN_CONFIDENCE ? 'approve' : 'ask';
}

interface CacheEntry { verdict: ReviewerVerdict; ts: number }

export class ReviewerApprovalService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Set<string>();
  constructor(
    private readonly deps: ReviewerDeps,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = 300_000,
    private readonly maxEntries = 200
  ) {}

  /**
   * Synchronous cache read for the broker gate. A fresh 'approve' hit returns
   * 'approve'; anything else (miss, expired, cached 'ask') returns 'ask' AND, on
   * a miss, schedules a background consult so the NEXT identical request can
   * approve. Never blocks.
   */
  peek(key: string, req: ReviewerRequest): ReviewerVerdict {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.ts < this.ttlMs) return hit.verdict;
    if (hit) this.cache.delete(key); // expired
    // Warm in the background (fire-and-forget; consult never throws).
    if (!this.inflight.has(key)) void this.consult(key, req);
    return 'ask';
  }

  /** Async warm. Never throws → 'ask' on any failure. Writes the cache; evicts on cap/TTL. */
  async consult(key: string, req: ReviewerRequest): Promise<ReviewerVerdict> {
    if (this.inflight.has(key)) return 'ask';
    this.inflight.add(key);
    let verdict: ReviewerVerdict = 'ask';
    try {
      const result = await this.deps.runReview(req, `approve-reviewer:${key}`);
      if (result.ok && result.text.trim()) verdict = parseReviewerVerdict(result.text);
    } catch {
      verdict = 'ask';
    } finally {
      this.inflight.delete(key);
    }
    this.set(key, verdict);
    return verdict;
  }

  private set(key: string, verdict: ReviewerVerdict): void {
    // Bounded: drop the oldest insertion when over cap (Map preserves insert order).
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { verdict, ts: this.now() });
  }
}
