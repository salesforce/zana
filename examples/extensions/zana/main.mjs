//#region ../../src/shared/zana-types.ts
/** Statuses we treat as terminal/closed when `closedAt` isn't set. */
var CLOSED_STATUSES = /* @__PURE__ */ new Set([
	"done",
	"closed",
	"completed",
	"cancelled",
	"canceled",
	"rejected"
]);
/**
* Whether a ticket is closed. A non-null `closedAt` always wins; otherwise the
* raw status is matched (case-insensitively) against a known closed-set.
*/
function isClosedZanaStatus(status, closedAt) {
	if (closedAt) return true;
	return CLOSED_STATUSES.has((status ?? "").trim().toLowerCase());
}
//#endregion
//#region src/main/zana-main.ts
/** Window for the `throughput7d` KPI. */
var SEVEN_DAYS_MS = 6048e5;
/**
* Bounded, safe shape for a renderer-supplied `actor` recorded in a ticket's
* persisted audit log: letters/digits/space plus `_.@-`, 1–64 chars. Rejects
* control chars, newlines, and oversized blobs that could pollute the log.
* (Retained from the built-in; the actor is still renderer-supplied.)
*/
var SAFE_ACTOR_RE = /^[\w .@-]{1,64}$/;
/**
* A ticket/artifact id flows into an MCP `arguments` field the server uses to
* key a lookup; keep it a bare uuid with no path semantics (anchored, so any
* `/`, `\`, `..`, or absolute prefix fails). Mirrors the built-in's guard —
* defence-in-depth even though the server also validates.
*/
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Reject a missing or non-bare-uuid id before it reaches the server. */
function isSafeId(id) {
	return typeof id === "string" && UUID_RE.test(id);
}
/**
* Translate {@link SourceOpts} into the `ctx.mcp` opts. A `useGlobal` (or a
* missing projectPath) selects the fixed HOME (`~`) workspace child; a
* projectPath selects the confined project child.
*/
function mcpOpts(opts) {
	if (opts.useGlobal || !opts.projectPath) return { useGlobal: true };
	return { projectPath: opts.projectPath };
}
/**
* Synthesize the `ZanaSource` descriptor the snapshot carries. The RENDERER
* never reads `snapshot.source` (verified), but the type requires it and it's
* cheap + honest to fill: the resolved `.zana` PATH is host-side (we don't get
* it back from the pool), so `path` is left empty and `label`/`kind` reflect the
* requested scope. If a future UI needs the concrete path, add a pool call.
*/
function describeSource(opts) {
	const useGlobal = opts.useGlobal || !opts.projectPath;
	return {
		kind: useGlobal ? "global" : "project",
		label: useGlobal ? "Global (~/.zana)" : "Project",
		path: ""
	};
}
/**
* The raw ticket shape `zana_ticket_list` / `zana_ticket_get` return (a subset
* of the on-disk ticket). Every field is optional/untrusted — the server owns
* the schema, and we normalise defensively into the shared `ZanaTicket`.
*/
function mapTicket(raw) {
	if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
	return {
		id: raw.id,
		title: typeof raw.title === "string" ? raw.title : "(untitled)",
		description: typeof raw.description === "string" ? raw.description : void 0,
		status: typeof raw.status === "string" ? raw.status : "unknown",
		priority: typeof raw.priority === "string" ? raw.priority : void 0,
		assigneeName: typeof raw.assigneeName === "string" ? raw.assigneeName : void 0,
		assigneeId: typeof raw.assigneeId === "string" ? raw.assigneeId : void 0,
		assigneeProfileId: typeof raw.assigneeProfileId === "string" ? raw.assigneeProfileId : void 0,
		sprintId: typeof raw.sprintId === "string" ? raw.sprintId : void 0,
		labels: Array.isArray(raw.labels) ? raw.labels.filter((l) => typeof l === "string") : [],
		blockedBy: Array.isArray(raw.blockedBy) ? raw.blockedBy.filter((b) => typeof b === "string") : [],
		type: typeof raw.type === "string" ? raw.type : void 0,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : void 0,
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : void 0,
		closedAt: typeof raw.closedAt === "string" ? raw.closedAt : void 0,
		resultSummary: typeof raw.resultSummary === "string" ? raw.resultSummary : void 0,
		comments: Array.isArray(raw.comments) ? raw.comments.filter((c) => c && typeof c.body === "string").map((c) => ({
			author: typeof c.author === "string" ? c.author : void 0,
			body: c.body,
			createdAt: typeof c.createdAt === "string" ? c.createdAt : void 0
		})) : void 0
	};
}
/** Normalise one raw `audit[]` entry, coercing fields and tolerating garbage. */
function mapAuditEntry(raw) {
	if (!raw || typeof raw !== "object") return null;
	const entry = { action: typeof raw.action === "string" ? raw.action : String(raw.action ?? "") };
	if (typeof raw.id === "string") entry.id = raw.id;
	if (typeof raw.actor === "string") entry.actor = raw.actor;
	if (typeof raw.timestamp === "string") entry.timestamp = raw.timestamp;
	if (raw.details && typeof raw.details === "object" && !Array.isArray(raw.details)) entry.details = raw.details;
	return entry;
}
/** Normalise a raw ticket into a ZanaTicketDetail (base + audit + heavier fields). */
function mapTicketDetail(raw) {
	const base = mapTicket(raw);
	if (!base) return null;
	const audit = Array.isArray(raw.audit) ? raw.audit.map(mapAuditEntry).filter((e) => e !== null) : [];
	return {
		...base,
		createdBy: typeof raw.createdBy === "string" ? raw.createdBy : void 0,
		reworkCount: typeof raw.reworkCount === "number" ? raw.reworkCount : void 0,
		reviewPhase: typeof raw.reviewPhase === "string" ? raw.reviewPhase : void 0,
		audit
	};
}
/** Normalise a raw artifact object into a ZanaArtifact (content may be absent). */
function mapArtifact(raw) {
	if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
	return {
		id: raw.id,
		title: typeof raw.title === "string" ? raw.title : "(untitled)",
		type: typeof raw.type === "string" ? raw.type : void 0,
		content: typeof raw.content === "string" ? raw.content : "",
		tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [],
		createdBy: typeof raw.createdBy === "string" ? raw.createdBy : void 0,
		linkedTickets: Array.isArray(raw.linkedTickets) ? raw.linkedTickets.filter((t) => typeof t === "string") : [],
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : void 0
	};
}
/** Normalise a raw sprint into a ZanaSprint, deriving ticket counts from `tickets`. */
function mapSprint(raw, tickets) {
	if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
	const matching = tickets.filter((t) => t.sprintId === raw.id);
	const openCount = matching.filter((t) => !isClosedZanaStatus(t.status, t.closedAt)).length;
	return {
		id: raw.id,
		status: typeof raw.status === "string" ? raw.status : void 0,
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : void 0,
		name: typeof raw.name === "string" && raw.name ? raw.name : `Sprint ${raw.id.slice(0, 8)}`,
		ticketCount: matching.length,
		openCount
	};
}
/**
* Normalise a raw profile (from `zana_list_profiles`) into a ZanaProfile. The
* server's list shape carries `displayName` + `origin` (enriched upstream); we
* tolerate the older `name`-only shape as a fallback so a stale server still
* renders (origin then defaults to 'builtin').
*/
function mapProfile(raw) {
	if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
	const toolList = (v) => Array.isArray(v) ? v.filter((t) => typeof t === "string") : void 0;
	const displayName = typeof raw.displayName === "string" && raw.displayName || typeof raw.name === "string" && raw.name || raw.id;
	return {
		id: raw.id,
		displayName,
		description: typeof raw.description === "string" ? raw.description : void 0,
		icon: typeof raw.icon === "string" ? raw.icon : void 0,
		category: typeof raw.category === "string" ? raw.category : void 0,
		origin: raw.origin === "workspace" ? "workspace" : "builtin",
		model: typeof raw.model === "string" ? raw.model : void 0,
		allowedTools: toolList(raw.allowedTools),
		disallowedTools: toolList(raw.disallowedTools)
	};
}
/** Normalise a raw profile into full detail (base + prompt + heavier fields). */
function mapProfileDetail(raw) {
	const base = mapProfile(raw);
	if (!base) return null;
	return {
		...base,
		systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : void 0,
		permissionMode: typeof raw.permissionMode === "string" ? raw.permissionMode : void 0,
		effortLevel: typeof raw.effortLevel === "string" ? raw.effortLevel : void 0
	};
}
/** Compute aggregate KPIs over the loaded data (unchanged from the built-in). */
function computeKpis(tickets, sprints, artifacts) {
	const byStatus = {};
	const byPriority = {};
	let openTickets = 0;
	let closedTickets = 0;
	let blockedTickets = 0;
	let throughput7d = 0;
	const cutoff = Date.now() - SEVEN_DAYS_MS;
	for (const t of tickets) {
		byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
		if (t.priority) byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
		if (isClosedZanaStatus(t.status, t.closedAt)) {
			closedTickets += 1;
			if (t.closedAt) {
				const ts = Date.parse(t.closedAt);
				if (!Number.isNaN(ts) && ts >= cutoff) throughput7d += 1;
			}
		} else {
			openTickets += 1;
			if (t.blockedBy.length > 0) blockedTickets += 1;
		}
	}
	return {
		totalTickets: tickets.length,
		openTickets,
		closedTickets,
		blockedTickets,
		byStatus,
		byPriority,
		sprintCount: sprints.length,
		artifactCount: artifacts.length,
		throughput7d
	};
}
/** Descending string compare on optional ISO timestamps (missing sorts last). */
function byDateDesc(a, b) {
	return (b ?? "").localeCompare(a ?? "");
}
/** The npm package whose version the version-check reports on. */
var ZANA_PACKAGE = "@zana-ai/mcp";
var ZANA_UPGRADE_COMMAND = `npm install -g ${ZANA_PACKAGE}@latest`;
var zanaMainModule = {
	id: "zana",
	setup(ctx) {
		const { log } = ctx;
		const mcp = ctx.mcp;
		if (!mcp) throw new Error("zana: ctx.mcp is required (host MCP pool backs the zana data path); refusing to run without it");
		/** Call a zana MCP tool for the given source scope, returning parsed JSON. */
		const call = (tool, args, opts) => mcp("zana", tool, args, mcpOpts(opts));
		return {
			/**
			* THE main capability: compose a full snapshot from one `.zana` root by
			* fanning three MCP list calls in parallel, then computing KPIs here (as
			* the built-in did). A `zana-mcp-server` failure degrades to an EMPTY
			* snapshot (never throws) so the board renders an honest empty state.
			*/
			async getSnapshot(opts) {
				const src = opts ?? {};
				const source = describeSource(src);
				const isInitialized = ctx.mcpIsWorkspaceInitialized ? await ctx.mcpIsWorkspaceInitialized(mcpOpts(src)).catch(() => false) : false;
				try {
					const [rawTickets, rawArtifacts, rawSprints] = await Promise.all([
						call("zana_ticket_list", {}, src),
						call("zana_artifact_list", {}, src),
						call("zana_sprint_list", {}, src)
					]);
					const tickets = (Array.isArray(rawTickets) ? rawTickets : []).map(mapTicket).filter((t) => t !== null);
					const artifacts = (Array.isArray(rawArtifacts) ? rawArtifacts : []).map(mapArtifact).filter((a) => a !== null);
					const sprints = (Array.isArray(rawSprints) ? rawSprints : []).map((s) => mapSprint(s, tickets)).filter((s) => s !== null);
					tickets.sort((a, b) => byDateDesc(a.updatedAt, b.updatedAt));
					artifacts.sort((a, b) => byDateDesc(a.createdAt, b.createdAt));
					return {
						source,
						kpis: computeKpis(tickets, sprints, artifacts),
						tickets,
						sprints,
						artifacts,
						isInitialized
					};
				} catch (err) {
					log("getSnapshot failed (zana MCP unavailable?)", err);
					return {
						source,
						kpis: computeKpis([], [], []),
						tickets: [],
						sprints: [],
						artifacts: [],
						isInitialized
					};
				}
			},
			/** Read one ticket's FULL detail (incl. audit). Null when not found / unavailable. */
			async getTicket(opts) {
				if (!opts || !isSafeId(opts.id)) return null;
				try {
					const raw = await call("zana_ticket_get", { ticketId: opts.id }, opts);
					if (!raw || typeof raw !== "object" || "error" in raw) return null;
					return mapTicketDetail(raw);
				} catch (err) {
					log(`getTicket failed (${opts.id})`, err);
					return null;
				}
			},
			/** Read one artifact (content fetched on demand). Null when not found / unavailable. */
			async getArtifact(opts) {
				if (!opts || !isSafeId(opts.id)) return null;
				try {
					const raw = await call("zana_artifact_read", { artifactId: opts.id }, opts);
					if (!raw || typeof raw !== "object" || "error" in raw) return null;
					return mapArtifact(raw);
				} catch (err) {
					log(`getArtifact failed (${opts.id})`, err);
					return null;
				}
			},
			/**
			* List ALL agent profiles (built-in + workspace). Profiles are GLOBAL in
			* zana (not project-scoped), so this always targets the global child.
			* Sorted by category then displayName. Degrades to [] on failure.
			*/
			async listProfiles() {
				try {
					const raw = await call("zana_list_profiles", {}, { useGlobal: true });
					const profiles = (Array.isArray(raw) ? raw : []).map(mapProfile).filter((p) => p !== null);
					profiles.sort((a, b) => {
						const cat = (a.category ?? "").localeCompare(b.category ?? "");
						return cat !== 0 ? cat : a.displayName.localeCompare(b.displayName);
					});
					return profiles;
				} catch (err) {
					log("listProfiles failed", err);
					return [];
				}
			},
			/** Read one profile's FULL detail (incl. system prompt). Null when not found. */
			async getProfile(opts) {
				if (!opts || typeof opts.id !== "string" || !opts.id) return null;
				try {
					const raw = await call("zana_get_profile", { profileId: opts.id }, { useGlobal: true });
					if (!raw || typeof raw !== "object" || "error" in raw) return null;
					return mapProfileDetail(raw);
				} catch (err) {
					log(`getProfile failed (${opts.id})`, err);
					return null;
				}
			},
			/**
			* WRITE capability: set or clear a ticket's assignee via the server's
			* `zana_ticket_assign` tool (added upstream), then re-read the full detail.
			*
			* The server owns the audit-entry append + `updatedAt` bump + persistence,
			* so the legacy JS read-modify-write, atomic tmp+rename, and per-file mutex
			* are GONE — the cross-process race the built-in only bounded is now the
			* server's single-writer concern.
			*
			* Assignment rules (mapped onto the tool's `{ profileId, assigneeName }`):
			*   - profileId non-empty → assign to that profile.
			*   - assigneeName only   → free-text assign (profileId omitted).
			*   - neither             → unassign (both omitted).
			* `actor` is sanitised before it's forwarded (the server stamps it into the
			* audit entry). Unlike reads, a failure THROWS: a user-initiated write must
			* surface, not silently no-op.
			*/
			async assignTicket(opts) {
				if (!opts || !isSafeId(opts.id)) throw new Error("A ticket id is required");
				const profileId = typeof opts.profileId === "string" && opts.profileId ? opts.profileId : void 0;
				const assigneeName = typeof opts.assigneeName === "string" && opts.assigneeName ? opts.assigneeName : void 0;
				const actor = typeof opts.actor === "string" && SAFE_ACTOR_RE.test(opts.actor) ? opts.actor : void 0;
				try {
					const res = await call("zana_ticket_assign", {
						ticketId: opts.id,
						...profileId !== void 0 ? { profileId } : {},
						...assigneeName !== void 0 ? { assigneeName } : {},
						...actor !== void 0 ? { assignedBy: actor } : {}
					}, opts);
					if (res && typeof res === "object" && "error" in res && res.error) throw new Error(String(res.error));
					const detail = await call("zana_ticket_get", { ticketId: opts.id }, opts);
					const mapped = detail && typeof detail === "object" && !("error" in detail) ? mapTicketDetail(detail) : null;
					if (!mapped) throw new Error("Failed to read Zana ticket back after assignment");
					return mapped;
				} catch (err) {
					if (err instanceof Error) throw err;
					log(`assignTicket failed (${opts.id})`, err);
					throw new Error("Failed to assign Zana ticket");
				}
			},
			/**
			* WRITE capability backing the explicit "Init Zana" button: create the
			* `.zana/` skeleton (tickets/sprints/artifacts/plans/audit/sessions/runs/
			* events/scheduler/tmp + a config.json) for the current project via
			* `ctx.mcpInitWorkspace`. Idempotent (a no-op if already initialized).
			* Unlike reads, a failure THROWS — a user-initiated write must surface.
			*/
			async initProject(opts) {
				if (!ctx.mcpInitWorkspace) throw new Error("zana: init is unavailable (host has no MCP pool)");
				try {
					return await ctx.mcpInitWorkspace(mcpOpts(opts ?? {}));
				} catch (err) {
					if (err instanceof Error) throw err;
					log("initProject failed", err);
					throw new Error("Failed to initialize the Zana workspace");
				}
			},
			/**
			* Report the installed vs. latest `@zana-ai/mcp` version. Uses the BROKERED
			* `ctx.exec('npm', …)` (scope `execAllowlist: ["npm"]`) + `ctx.fetch`
			* against the npm registry (scope `egressAllowlist: ["registry.npmjs.org"]`)
			* — no raw Node here (this is the untrusted disk-ext tier). Both reads are
			* tolerant; the capability never throws, so the settings panel always gets a
			* renderable result even offline / npm-less / without the brokered caps.
			*/
			async getVersionInfo() {
				const [installed, latest] = await Promise.all([readInstalledZanaVersion(ctx, log), readLatestZanaVersion(ctx, log)]);
				const updateAvailable = !!installed && !!latest && installed !== latest;
				let error;
				if (!installed && !latest) error = "Could not read the installed or latest version.";
				else if (!installed) error = "Zana MCP does not appear to be installed globally.";
				else if (!latest) error = "Could not reach the npm registry to check for updates.";
				return {
					package: ZANA_PACKAGE,
					installed,
					latest,
					updateAvailable,
					upgradeCommand: ZANA_UPGRADE_COMMAND,
					error
				};
			}
		};
	}
};
/**
* Read the globally-installed `@zana-ai/mcp` version via the brokered
* `ctx.exec('npm', ['ls','-g',…,'--json'])`. Returns null when the broker cap is
* absent, npm is missing, the package isn't installed globally, or the output
* can't be parsed — never throws.
*/
async function readInstalledZanaVersion(ctx, log) {
	if (!ctx.exec) return null;
	try {
		const res = await ctx.exec({
			bin: "npm",
			args: [
				"ls",
				"-g",
				ZANA_PACKAGE,
				"--depth=0",
				"--json"
			],
			timeoutMs: 5e3
		});
		const v = JSON.parse(res.stdout).dependencies?.[ZANA_PACKAGE]?.version;
		return typeof v === "string" && v ? v : null;
	} catch (err) {
		log("readInstalledZanaVersion failed", err);
		return null;
	}
}
/**
* Read the latest published `@zana-ai/mcp` version from the npm registry via the
* brokered `ctx.fetch` (host applies the egress allowlist). Returns null on any
* missing-cap / network / parse failure.
*/
async function readLatestZanaVersion(ctx, log) {
	if (!ctx.fetch) return null;
	try {
		const res = await ctx.fetch(`https://registry.npmjs.org/${encodeURIComponent(ZANA_PACKAGE)}/latest`, { headers: { accept: "application/json" } });
		if (!res.ok) return null;
		const body = JSON.parse(res.body);
		return typeof body.version === "string" && body.version ? body.version : null;
	} catch (err) {
		log("readLatestZanaVersion failed", err);
		return null;
	}
}
//#endregion
//#region src/main-entry.ts
/**
* Main-process entry for the zana DISK extension.
*
* The host spawns a per-extension utilityProcess and `import()`s this module
* there; its `default` export must be a {@link MainModule}. We re-export
* `zanaMainModule`, which maps zana's 7 renderer-facing capabilities
* (getSnapshot / getTicket / getArtifact / listProfiles / getProfile /
* assignTicket / getVersionInfo) onto zana's MCP server via the brokered
* `ctx.mcp('zana', tool, args)` capability — so in the isolated child every data
* call forwards over the broker port to the host-managed MCP child pool
* (permission-gated against the manifest's `mcp` grant + `mcpAllowlist: ['zana']`).
* `getVersionInfo` additionally uses the brokered `ctx.exec`/`ctx.fetch` caps
* (npm + registry query), gated by the `exec`/`net` grants.
*
* The build externalizes only `electron` + node builtins; zana-main imports
* neither (it's pure JS + ctx capabilities + shared types), so the bundle is
* self-contained.
*/
var main_entry_default = zanaMainModule;
//#endregion
export { main_entry_default as default };
