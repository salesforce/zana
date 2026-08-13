const m = "consensus-reanalysis", w = 50, l = "records", g = "seeded", y = {
  id: "release-hosting-2026-06-28",
  // The release-hosting council was held for the zana-command-center project.
  projectId: "117b6f76-8fdc-4e15-b7c1-90673e256c1c",
  question: "Where should we host the Electron app auto-updater feed and the extension marketplace registry, given the internal git host is login-gated and unreachable by electron-updater?",
  verdict: "APPROVE — Option C (static feeds on an internally-controlled object store + CDN, via electron-updater's generic provider)",
  roster: "security-reviewer + performance-engineer + researcher → judge synthesizer",
  synthesis: "Both feeds are 100% static, so no web service is justified. Heroku (Option A) would just front S3 needlessly with no CDN and a cold-start penalty on the 30-min poll; a baked-in internal-host token (Option D) is a CWE-798 hard-coded credential. Hosting both as static files behind one CDN base, read via electron-updater's generic provider, makes the host a one-value config flip. The B-vs-C (public github.com vs private internal infra) choice reduces to a confidentiality decision for the human — landed on C (internal infra) for now.",
  votes: [
    {
      voter: "security-reviewer",
      stance: "CHANGES",
      rationale: "Option D (internal host with baked token) is a security blocker — CWE-798 hard-coded credential: the same token ships in every client, is extractable, and rotation means re-shipping the app. Options A/B/C are all security-acceptable: the marketplace already enforces sha256 + Ed25519 and the mac app is Developer-ID signed + notarized, so a compromised host is detected, not silently trusted. Enforce Ed25519 for the registry; rely on code-signing for the updater. Do NOT use Option D."
    },
    {
      voter: "performance-engineer",
      stance: "CHANGES",
      rationale: "A Heroku dyno is the wrong tool: ephemeral filesystem means artifacts live in S3 anyway (pointless proxy), no built-in CDN, always-on cost for a sub-1 req/sec workload, and cold-start latency degrades every 30-min poll. Options B (GitHub releases) and C (S3+CDN) both give CDN-edge delivery, pay-per-GB cost, and zero maintenance — slight preference for B on ops burden. Avoid Option A."
    },
    {
      voter: "researcher",
      stance: "APPROVE",
      rationale: "electron-updater's generic provider takes a single static base URL and removes ALL GitHub/internal-host dependency for the app updater; the marketplace registry is likewise 100% static files. No dynamic behavior (access control, telemetry, gating) is required, so a custom web service is unjustified. Recommend Option C: one internally-controlled bucket+CDN serving /app-updates and /extensions, a single trust anchor — keeping internal builds on internal infra vs exposing them on public github.com."
    }
  ],
  dissent: [
    'security-reviewer: "If internal builds must remain private, use Option A (Heroku) with requireSignature: true" — superseded, since A still needs S3 behind it, so C dominates A for the same privacy goal.',
    'performance-engineer: "...with a slight preference for B due to lower ops burden." — B (public github.com) trades the confidentiality of internal builds for lower ops; researcher counters on exactly that axis.'
  ],
  settledAt: "2026-06-28T00:00:00.000Z"
}, b = {
  id: "consensus",
  setup(r) {
    async function a() {
      const t = await r.storage.get(l) ?? [];
      return t.length === 0 && !await r.storage.get(g) ? (await r.storage.set(l, [y]), await r.storage.set(g, !0), [y]) : t;
    }
    async function f(t) {
      const e = (await a()).filter((i) => i.id !== t.id);
      e.push(t), await r.storage.set(l, e);
    }
    function v(t, s) {
      const e = t;
      if (!e || typeof e.question != "string" || typeof e.verdict != "string" || !Array.isArray(e.votes)) return null;
      const i = e.votes.filter((n) => n && typeof n.voter == "string" && typeof n.stance == "string").map((n) => ({ voter: n.voter, stance: n.stance, rationale: String(n.rationale ?? "") }));
      if (i.length === 0) return null;
      const u = typeof e.settledAt == "string" && e.settledAt ? e.settledAt : (/* @__PURE__ */ new Date()).toISOString();
      return {
        id: `reanalysis-${s.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        projectId: typeof e.projectId == "string" ? e.projectId : void 0,
        question: e.question,
        verdict: e.verdict,
        synthesis: typeof e.synthesis == "string" ? e.synthesis : void 0,
        votes: i,
        dissent: Array.isArray(e.dissent) ? e.dissent.filter((n) => typeof n == "string") : void 0,
        settledAt: u,
        roster: (typeof e.roster == "string" && e.roster ? e.roster : "council re-analysis") + (e.sourceId ? ` · re-run of ${e.sourceId}` : "")
      };
    }
    return {
      /**
       * List records, newest-settled first (lightweight projection for the
       * list). When `projectId` is given (the per-project tab passes its scoped
       * id), only that project's decisions are returned; omitting it lists all
       * (a global/unscoped view).
       */
      async list(t) {
        return (await a()).filter((e) => !t || e.projectId === t).slice().sort((e, i) => (i.settledAt ?? "").localeCompare(e.settledAt ?? "")).map((e) => ({
          id: e.id,
          question: e.question,
          verdict: e.verdict,
          voters: e.votes.length,
          settledAt: e.settledAt
        }));
      },
      /** Full record by id, or null. */
      async get(t) {
        return (await a()).find((e) => e.id === t) ?? null;
      },
      /**
       * Upsert a record (write seam for an orchestrator that just settled a
       * council). Replaces an existing record with the same id.
       */
      async record(t) {
        if (!(t != null && t.id) || !(t != null && t.question)) throw new Error("consensus.record: id + question required");
        return await f(t), r.log(`recorded consensus ${t.id} (${t.verdict})`), { id: t.id };
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
      async ingest(t) {
        const s = r.mcp;
        if (!s) return { ingested: 0 };
        const e = t != null && t.projectPath ? { projectPath: t.projectPath } : { useGlobal: !0 };
        let i;
        try {
          i = await s("zana", "zana_artifact_list", { tag: m }, e);
        } catch (n) {
          return r.log("ingest: zana_artifact_list failed (zana MCP unavailable?)", n), { ingested: 0 };
        }
        const u = (Array.isArray(i) ? i : []).filter((n) => !!n && typeof n.id == "string").slice(0, w);
        let p = 0;
        for (const n of u) {
          const d = n.id;
          try {
            const o = await s("zana", "zana_artifact_read", { artifactId: d }, e), h = o && typeof o == "object" ? o.content : void 0;
            if (typeof h == "string") {
              const c = v(JSON.parse(h), d);
              c && (await f(c), p++, r.log(`ingested re-analysis ${c.id} (${c.verdict})`));
            }
            await s("zana", "zana_artifact_delete", { artifactId: d }, e);
          } catch (o) {
            r.log(`ingest: skip artifact ${d}`, o);
          }
        }
        return { ingested: p };
      },
      /** Delete a record by id. Returns whether a record actually matched. */
      async remove(t) {
        const s = await a(), e = s.filter((i) => i.id !== t);
        return await r.storage.set(l, e), r.log(`removed consensus ${t}`), { removed: t, ok: e.length !== s.length };
      },
      /**
       * Delete EVERY recorded decision (the "clear all" cleanup). Leaves the seed
       * marker set so the bundled seed does NOT reappear. Returns the count wiped.
       */
      async clearAll() {
        const s = (await a()).length;
        return await r.storage.set(l, []), await r.storage.set(g, !0), r.log(`cleared all consensus records (${s})`), { cleared: s };
      }
    };
  }
};
export {
  b as default
};
