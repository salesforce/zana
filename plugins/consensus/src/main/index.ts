/**
 * Consensus — main-process side.
 *
 * Stores council/deliberation verdicts in the extension's own persistent KV
 * (`ctx.storage`, namespaced to this extension). Each record captures a
 * decision reached by a multi-voice council: the question, the per-voter
 * stances + rationales, any verbatim dissent, and the final verdict. The
 * renderer reads them via `host.call(...)` and renders the Consensus tab.
 *
 * Why storage for the SETTLED record: `record()` is the write seam an
 * orchestrator calls once a council settles, and a settled verdict is a
 * portable, always-available artifact worth persisting locally. The interesting
 * part is the RE-ANALYSIS record-back channel — see below.
 */
import { defineMainModule } from '@zana-ai/zcc-extension-sdk';

/**
 * Re-analysis record-back channel — now a ZANA ARTIFACT, not a file drop.
 *
 * The "Re-analyse" button spawns a Claude session that convenes a fresh council
 * on the same question and records its settled verdict. That verdict is RICH,
 * verbatim text (per-voter rationales, prose synthesis, the minority report),
 * so it can't be read straight off the zana deliberation record — that record
 * stores only hashes + a coarse verdict enum, no rationale text. So the SPAWNED
 * AGENT still assembles the rich JSON; only the transport changed.
 *
 * Old transport: the agent wrote a JSON FILE into `~/.zana/consensus-inbox` and
 * `ingest()` read it through the brokered `ctx.fs`. That required an `fs:read`
 * grant + a fixed `fsRoots` path. New transport: the agent calls
 * `zana_artifact_create({ type:'decision-record', tags:[REANALYSIS_TAG], … })`,
 * and `ingest()` folds new artifacts in over the brokered `ctx.mcp('zana', …)`
 * capability, then DELETES each consumed artifact (the mcp analogue of removing
 * a processed drop file). Delete-after-ingest is what makes ingest idempotent —
 * a consumed artifact is gone, so there is no "already seen" ledger to keep.
 *
 * Payoff: the extension no longer touches the filesystem at all (no `fs:read`,
 * no `fsRoots`) — the whole re-analysis loop rides the same brokered zana MCP
 * surface the rest of the Zana feature uses.
 */
/** Tag every re-analysis artifact carries, so `ingest` can list exactly these. */
const REANALYSIS_TAG = 'consensus-reanalysis';
/** Bound how many artifacts one ingest folds in (Rule 5); delete keeps the set drained. */
const ARTIFACT_INGEST_CAP = 50;

/** Shape an agent writes into a re-analysis artifact's content. Tolerant — `ingest` validates. */
interface ReanalysisPayload {
  /** The record this re-analysis derives from (for provenance in the note). */
  sourceId?: string;
  projectId?: string;
  question: string;
  verdict: string;
  synthesis?: string;
  votes: ConsensusVote[];
  dissent?: string[];
  settledAt?: string;
  roster?: string;
}

/** One voter's contribution to a council. */
export interface ConsensusVote {
  /** Voter id / profile (e.g. "security-reviewer"). */
  voter: string;
  /** APPROVE | CHANGES (free-form so future stances don't break the schema). */
  stance: string;
  /** The voter's full rationale, verbatim. */
  rationale: string;
}

/** A settled council decision. */
export interface ConsensusRecord {
  id: string;
  /**
   * The project this decision was reached FOR. A council settles against a
   * concrete project, so records are project-scoped: the per-project Consensus
   * tab filters on this. Optional for backward-compat — a legacy record written
   * before scoping has no projectId and is treated as belonging to no project
   * (it won't surface under any project tab; re-record it to attach one).
   */
  projectId?: string;
  /** The question the council deliberated. */
  question: string;
  /** Final verdict line (e.g. "APPROVE", "APPROVE WITH CONDITIONS", "REJECT"). */
  verdict: string;
  /** Judge's synthesis / rationale for the verdict. */
  synthesis?: string;
  /** Per-voter stances. */
  votes: ConsensusVote[];
  /** Verbatim dissent preserved by synthesis (points a minority raised). */
  dissent?: string[];
  /** ISO timestamp the council settled. */
  settledAt: string;
  /** Optional roster note / how voters were chosen. */
  roster?: string;
}

const KEY = 'records';
/** Set once the bundled seed has been planted, so a full cleanup isn't undone. */
const SEEDED_KEY = 'seeded';

/** The release-hosting council (2026-06-28) — seeded so the tab is never empty. */
const SEED: ConsensusRecord = {
  id: 'release-hosting-2026-06-28',
  // The release-hosting council was held for the zana-command-center project.
  projectId: '117b6f76-8fdc-4e15-b7c1-90673e256c1c',
  question:
    'Where should we host the Electron app auto-updater feed and the extension marketplace registry, given the internal git host is login-gated and unreachable by electron-updater?',
  verdict: 'APPROVE — Option C (static feeds on an internally-controlled object store + CDN, via electron-updater\'s generic provider)',
  roster: 'security-reviewer + performance-engineer + researcher → judge synthesizer',
  synthesis:
    'Both feeds are 100% static, so no web service is justified. Heroku (Option A) would just front S3 needlessly with no CDN and a cold-start penalty on the 30-min poll; a baked-in internal-host token (Option D) is a CWE-798 hard-coded credential. Hosting both as static files behind one CDN base, read via electron-updater\'s generic provider, makes the host a one-value config flip. The B-vs-C (public github.com vs private internal infra) choice reduces to a confidentiality decision for the human — landed on C (internal infra) for now.',
  votes: [
    {
      voter: 'security-reviewer',
      stance: 'CHANGES',
      rationale:
        'Option D (internal host with baked token) is a security blocker — CWE-798 hard-coded credential: the same token ships in every client, is extractable, and rotation means re-shipping the app. Options A/B/C are all security-acceptable: the marketplace already enforces sha256 + Ed25519 and the mac app is Developer-ID signed + notarized, so a compromised host is detected, not silently trusted. Enforce Ed25519 for the registry; rely on code-signing for the updater. Do NOT use Option D.',
    },
    {
      voter: 'performance-engineer',
      stance: 'CHANGES',
      rationale:
        'A Heroku dyno is the wrong tool: ephemeral filesystem means artifacts live in S3 anyway (pointless proxy), no built-in CDN, always-on cost for a sub-1 req/sec workload, and cold-start latency degrades every 30-min poll. Options B (GitHub releases) and C (S3+CDN) both give CDN-edge delivery, pay-per-GB cost, and zero maintenance — slight preference for B on ops burden. Avoid Option A.',
    },
    {
      voter: 'researcher',
      stance: 'APPROVE',
      rationale:
        'electron-updater\'s generic provider takes a single static base URL and removes ALL GitHub/internal-host dependency for the app updater; the marketplace registry is likewise 100% static files. No dynamic behavior (access control, telemetry, gating) is required, so a custom web service is unjustified. Recommend Option C: one internally-controlled bucket+CDN serving /app-updates and /extensions, a single trust anchor — keeping internal builds on internal infra vs exposing them on public github.com.',
    },
  ],
  dissent: [
    'security-reviewer: "If internal builds must remain private, use Option A (Heroku) with requireSignature: true" — superseded, since A still needs S3 behind it, so C dominates A for the same privacy goal.',
    'performance-engineer: "...with a slight preference for B due to lower ops burden." — B (public github.com) trades the confidentiality of internal builds for lower ops; researcher counters on exactly that axis.',
  ],
  settledAt: '2026-06-28T00:00:00.000Z',
};

export default defineMainModule({
  id: 'consensus',
  setup(ctx) {
    async function readAll(): Promise<ConsensusRecord[]> {
      const stored = (await ctx.storage.get<ConsensusRecord[]>(KEY)) ?? [];
      // Seed EXACTLY once (guarded by a persisted marker), so the tab opens with
      // real content on first run — but a user who deletes every record (incl.
      // the seed) gets a truly empty tab back, not a resurrected seed. Without
      // the marker, `stored.length === 0` would re-seed after any full cleanup.
      if (stored.length === 0 && !(await ctx.storage.get<boolean>(SEEDED_KEY))) {
        await ctx.storage.set(KEY, [SEED]);
        await ctx.storage.set(SEEDED_KEY, true);
        return [SEED];
      }
      return stored;
    }

    /** Upsert a record into the store (shared by `record` and `ingest`). */
    async function upsert(rec: ConsensusRecord): Promise<void> {
      const all = await readAll();
      const next = all.filter((r) => r.id !== rec.id);
      next.push(rec);
      await ctx.storage.set(KEY, next);
    }

    /** Best-effort coercion of an agent-written payload into a valid record. */
    function toRecord(raw: unknown, sourceKey: string): ConsensusRecord | null {
      const d = raw as ReanalysisPayload | null;
      if (!d || typeof d.question !== 'string' || typeof d.verdict !== 'string') return null;
      if (!Array.isArray(d.votes)) return null;
      const votes: ConsensusVote[] = d.votes
        .filter((v) => v && typeof v.voter === 'string' && typeof v.stance === 'string')
        .map((v) => ({ voter: v.voter, stance: v.stance, rationale: String(v.rationale ?? '') }));
      if (votes.length === 0) return null;
      const settledAt =
        typeof d.settledAt === 'string' && d.settledAt ? d.settledAt : new Date().toISOString();
      // Deterministic id from the artifact id so a re-ingest of the SAME artifact
      // overwrites rather than duplicates; a fresh re-analysis (new artifact)
      // becomes a NEW record and the original decision is preserved.
      const id = `reanalysis-${sourceKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      return {
        id,
        projectId: typeof d.projectId === 'string' ? d.projectId : undefined,
        question: d.question,
        verdict: d.verdict,
        synthesis: typeof d.synthesis === 'string' ? d.synthesis : undefined,
        votes,
        dissent: Array.isArray(d.dissent) ? d.dissent.filter((x) => typeof x === 'string') : undefined,
        settledAt,
        roster:
          (typeof d.roster === 'string' && d.roster ? d.roster : 'council re-analysis') +
          (d.sourceId ? ` · re-run of ${d.sourceId}` : ''),
      };
    }

    return {
      /**
       * List records, newest-settled first (lightweight projection for the
       * list). When `projectId` is given (the per-project tab passes its scoped
       * id), only that project's decisions are returned; omitting it lists all
       * (a global/unscoped view).
       */
      async list(projectId?: string) {
        const all = await readAll();
        return all
          .filter((r) => !projectId || r.projectId === projectId)
          .slice()
          .sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''))
          .map((r) => ({
            id: r.id,
            question: r.question,
            verdict: r.verdict,
            voters: r.votes.length,
            settledAt: r.settledAt,
          }));
      },

      /** Full record by id, or null. */
      async get(id: string): Promise<ConsensusRecord | null> {
        const all = await readAll();
        return all.find((r) => r.id === id) ?? null;
      },

      /**
       * Upsert a record (write seam for an orchestrator that just settled a
       * council). Replaces an existing record with the same id.
       */
      async record(rec: ConsensusRecord) {
        if (!rec?.id || !rec?.question) throw new Error('consensus.record: id + question required');
        await upsert(rec);
        ctx.log(`recorded consensus ${rec.id} (${rec.verdict})`);
        return { id: rec.id };
      },

      /**
       * Fold any new re-analysis artifacts (written by a spawned council agent
       * via `zana_artifact_create`) into the store, then return how many were
       * ingested. Reads over the brokered `ctx.mcp('zana', …)` capability:
       * `zana_artifact_list` filtered to {@link REANALYSIS_TAG}, then per
       * artifact `zana_artifact_read` → parse → upsert → `zana_artifact_delete`.
       * Deleting each consumed artifact makes this idempotent (no "already seen"
       * ledger needed) and keeps the tagged set drained (Rule 5, plus a hard
       * {@link ARTIFACT_INGEST_CAP} per call). Degrades to `{ ingested: 0 }` when
       * the mcp capability is absent or the zana server is unavailable — never
       * throws. `projectPath` is an ADVISORY scope hint the host realpath-confines
       * (Rules 1/2); omitting it targets the global (`~`) zana workspace.
       */
      async ingest(opts?: { projectPath?: string }): Promise<{ ingested: number }> {
        const mcp = ctx.mcp;
        if (!mcp) return { ingested: 0 };
        const scope = opts?.projectPath ? { projectPath: opts.projectPath } : { useGlobal: true };

        let list: unknown;
        try {
          list = await mcp('zana', 'zana_artifact_list', { tag: REANALYSIS_TAG }, scope);
        } catch (err) {
          // zana server unavailable / tool error → nothing to fold in.
          ctx.log('ingest: zana_artifact_list failed (zana MCP unavailable?)', err);
          return { ingested: 0 };
        }
        const metas = (Array.isArray(list) ? list : [])
          .filter((m): m is { id: string } => !!m && typeof (m as { id?: unknown }).id === 'string')
          .slice(0, ARTIFACT_INGEST_CAP);

        let ingested = 0;
        for (const meta of metas) {
          const artifactId = meta.id;
          try {
            const full = await mcp('zana', 'zana_artifact_read', { artifactId }, scope);
            const content =
              full && typeof full === 'object' ? (full as { content?: unknown }).content : undefined;
            if (typeof content === 'string') {
              const rec = toRecord(JSON.parse(content), artifactId);
              if (rec) {
                await upsert(rec);
                ingested++;
                ctx.log(`ingested re-analysis ${rec.id} (${rec.verdict})`);
              }
            }
            // Consume the artifact so a later ingest doesn't re-fold it. A
            // malformed/unreadable one is deleted too — it shouldn't be re-read
            // on every ingest. If the delete itself fails, the deterministic id
            // makes a future re-ingest an idempotent overwrite, not a duplicate.
            await mcp('zana', 'zana_artifact_delete', { artifactId }, scope);
          } catch (err) {
            ctx.log(`ingest: skip artifact ${artifactId}`, err);
          }
        }
        return { ingested };
      },

      /** Delete a record by id. Returns whether a record actually matched. */
      async remove(id: string) {
        const all = await readAll();
        const next = all.filter((r) => r.id !== id);
        await ctx.storage.set(KEY, next);
        ctx.log(`removed consensus ${id}`);
        return { removed: id, ok: next.length !== all.length };
      },

      /**
       * Delete EVERY recorded decision (the "clear all" cleanup). Leaves the seed
       * marker set so the bundled seed does NOT reappear. Returns the count wiped.
       */
      async clearAll() {
        const all = await readAll();
        const count = all.length;
        await ctx.storage.set(KEY, []);
        await ctx.storage.set(SEEDED_KEY, true);
        ctx.log(`cleared all consensus records (${count})`);
        return { cleared: count };
      },
    };
  },
});
