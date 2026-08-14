//#region ../../packages/extension-sdk/src/index.ts
function e(e) {
	return e;
}
//#endregion
//#region src/main/index.ts
var t = "records", n = "seeded", r = {
	id: "release-hosting-2026-06-28",
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
	dissent: ["security-reviewer: \"If internal builds must remain private, use Option A (Heroku) with requireSignature: true\" — superseded, since A still needs S3 behind it, so C dominates A for the same privacy goal.", "performance-engineer: \"...with a slight preference for B due to lower ops burden.\" — B (public github.com) trades the confidentiality of internal builds for lower ops; researcher counters on exactly that axis."],
	settledAt: "2026-06-28T00:00:00.000Z"
}, i = e({
	id: "consensus",
	setup(e) {
		async function i() {
			let i = await e.storage.get(t) ?? [];
			return i.length === 0 && !await e.storage.get(n) ? (await e.storage.set(t, [r]), await e.storage.set(n, !0), [r]) : i;
		}
		async function a(n) {
			let r = (await i()).filter((e) => e.id !== n.id);
			r.push(n), await e.storage.set(t, r);
		}
		function o(e, t) {
			let n = e;
			if (!n || typeof n.question != "string" || typeof n.verdict != "string" || !Array.isArray(n.votes)) return null;
			let r = n.votes.filter((e) => e && typeof e.voter == "string" && typeof e.stance == "string").map((e) => ({
				voter: e.voter,
				stance: e.stance,
				rationale: String(e.rationale ?? "")
			}));
			if (r.length === 0) return null;
			let i = typeof n.settledAt == "string" && n.settledAt ? n.settledAt : (/* @__PURE__ */ new Date()).toISOString();
			return {
				id: `reanalysis-${t.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
				projectId: typeof n.projectId == "string" ? n.projectId : void 0,
				question: n.question,
				verdict: n.verdict,
				synthesis: typeof n.synthesis == "string" ? n.synthesis : void 0,
				votes: r,
				dissent: Array.isArray(n.dissent) ? n.dissent.filter((e) => typeof e == "string") : void 0,
				settledAt: i,
				roster: (typeof n.roster == "string" && n.roster ? n.roster : "council re-analysis") + (n.sourceId ? ` · re-run of ${n.sourceId}` : "")
			};
		}
		return {
			async list(e) {
				return (await i()).filter((t) => !e || t.projectId === e).slice().sort((e, t) => (t.settledAt ?? "").localeCompare(e.settledAt ?? "")).map((e) => ({
					id: e.id,
					question: e.question,
					verdict: e.verdict,
					voters: e.votes.length,
					settledAt: e.settledAt
				}));
			},
			async get(e) {
				return (await i()).find((t) => t.id === e) ?? null;
			},
			async record(t) {
				if (!t?.id || !t?.question) throw Error("consensus.record: id + question required");
				return await a(t), e.log(`recorded consensus ${t.id} (${t.verdict})`), { id: t.id };
			},
			async ingest(t) {
				let n = e.mcp;
				if (!n) return { ingested: 0 };
				let r = t?.projectPath ? { projectPath: t.projectPath } : { useGlobal: !0 }, i;
				try {
					i = await n("zana", "zana_artifact_list", { tag: "consensus-reanalysis" }, r);
				} catch (t) {
					return e.log("ingest: zana_artifact_list failed (zana MCP unavailable?)", t), { ingested: 0 };
				}
				let s = (Array.isArray(i) ? i : []).filter((e) => !!e && typeof e.id == "string").slice(0, 50), c = 0;
				for (let t of s) {
					let i = t.id;
					try {
						let t = await n("zana", "zana_artifact_read", { artifactId: i }, r), s = t && typeof t == "object" ? t.content : void 0;
						if (typeof s == "string") {
							let t = o(JSON.parse(s), i);
							t && (await a(t), c++, e.log(`ingested re-analysis ${t.id} (${t.verdict})`));
						}
						await n("zana", "zana_artifact_delete", { artifactId: i }, r);
					} catch (t) {
						e.log(`ingest: skip artifact ${i}`, t);
					}
				}
				return { ingested: c };
			},
			async remove(n) {
				let r = await i(), a = r.filter((e) => e.id !== n);
				return await e.storage.set(t, a), e.log(`removed consensus ${n}`), {
					removed: n,
					ok: a.length !== r.length
				};
			},
			async clearAll() {
				let r = (await i()).length;
				return await e.storage.set(t, []), await e.storage.set(n, !0), e.log(`cleared all consensus records (${r})`), { cleared: r };
			}
		};
	}
});
//#endregion
export { i as default };
