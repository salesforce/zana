import { homedir as e } from "node:os";
import { join as t } from "node:path";
import { randomUUID as n } from "node:crypto";
//#region ../../packages/extension-sdk/src/index.ts
function r(e) {
	return e;
}
//#endregion
//#region src/main/normalize-team.ts
function i(e) {
	return e.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "team";
}
function a(e, t) {
	let n = new Set(t), r = i(e);
	if (!n.has(r)) return r;
	let a = 2;
	for (; n.has(`${r}-${a}`);) a++;
	return `${r}-${a}`;
}
function o(e) {
	if (!e || typeof e.name != "string" || !e.name.trim()) return "Team name is required.";
	if (!Array.isArray(e.slots) || e.slots.length === 0) return "At least one roster slot is required.";
	for (let t of e.slots) {
		if (!t || typeof t.profileId != "string" || !t.profileId.trim()) return "Every slot needs a profile.";
		if (typeof t.quantity != "number" || !Number.isInteger(t.quantity) || t.quantity < 1) return "Slot quantity must be a whole number ≥ 1.";
	}
	return e.maxConcurrentWorkers != null && (!Number.isInteger(e.maxConcurrentWorkers) || e.maxConcurrentWorkers < 1) ? "Max concurrent workers must be a whole number ≥ 1." : null;
}
function s(e, t, n, r) {
	let i = e.slots.map((e) => ({
		profileId: e.profileId,
		quantity: e.quantity
	})), a = [];
	for (let e of i) a.includes(e.profileId) || a.push(e.profileId);
	let o = i.reduce((e, t) => e + t.quantity, 0), s = t.rules && typeof t.rules == "object" ? t.rules : {}, c = typeof s.maxConcurrentWorkers == "number" ? s.maxConcurrentWorkers : void 0, l = e.maxConcurrentWorkers ?? c ?? o;
	return {
		...t,
		id: n,
		name: e.name.trim(),
		icon: e.icon,
		description: e.description,
		orchestratorProfileId: e.orchestratorProfileId,
		slots: i,
		initialPrompt: e.initialPrompt,
		rules: {
			...s,
			maxConcurrentWorkers: l
		},
		autoStart: e.autoStart === !0,
		workerProfileIds: a,
		maxTotalWorkers: o,
		updatedAt: r
	};
}
//#endregion
//#region src/main/normalize-profile.ts
function c(e) {
	return !e || typeof e.displayName != "string" || !e.displayName.trim() ? "Profile name is required." : !Array.isArray(e.allowedTools) || !Array.isArray(e.disallowedTools) ? "Tool lists must be arrays." : null;
}
function l(e) {
	let t = [];
	for (let n of e) {
		let e = typeof n == "string" ? n.trim() : "";
		e && !t.includes(e) && t.push(e);
	}
	return t;
}
function u(e, t) {
	let n = e[t];
	return typeof n == "string" ? n : void 0;
}
function d(e, t, n, r) {
	return {
		...t,
		id: n,
		displayName: e.displayName.trim(),
		icon: e.icon,
		description: e.description,
		category: e.category,
		model: e.model,
		effortLevel: e.effortLevel,
		permissionMode: e.permissionMode,
		systemPrompt: e.systemPrompt,
		allowedTools: l(e.allowedTools),
		disallowedTools: l(e.disallowedTools),
		builtIn: t.builtIn === !0,
		createdAt: u(t, "createdAt") ?? r,
		updatedAt: r
	};
}
//#endregion
//#region src/main/index.ts
var f = 200, p = 40, m = 8e3, h = t(e(), ".zana");
function g(e) {
	try {
		return JSON.parse(e);
	} catch {
		return;
	}
}
function _(e) {
	return typeof e == "string" && e ? e : void 0;
}
function v(e) {
	return Array.isArray(e) ? e.filter((e) => typeof e == "string" && e.length > 0) : [];
}
function y(e) {
	return /^[a-zA-Z0-9._-]+$/.test(e) && e !== "." && e !== "..";
}
async function b(e, n, r) {
	let i;
	try {
		i = await e.readdir(t(h, n));
	} catch {
		return [];
	}
	let a = i.filter((e) => e.endsWith(".json") && e !== "_index.json").slice(0, f), o = [];
	for (let i of a) try {
		let r = g(await e.readFile(t(h, n, i), "utf-8"));
		r !== void 0 && o.push(r);
	} catch (e) {
		r(`skipped ${n}/${i}: ${e instanceof Error ? e.message : String(e)}`);
	}
	return o;
}
function x(e) {
	if (!e || typeof e != "object") return null;
	let t = e, n = _(t.id), r = _(t.name);
	if (!n || !r) return null;
	let i = t.rules && typeof t.rules == "object" ? t.rules : {}, a = typeof i.maxConcurrentWorkers == "number" ? i.maxConcurrentWorkers : typeof t.maxTotalWorkers == "number" ? t.maxTotalWorkers : void 0, o = Array.isArray(t.slots) ? t.slots : [], s = 0, c = [];
	for (let e of o) {
		if (!e || typeof e != "object") continue;
		let t = e, n = _(t.profileId), r = typeof t.quantity == "number" && t.quantity > 0 ? t.quantity : 1;
		s += r, n && c.push(r > 1 ? `${n}×${r}` : n);
	}
	let l = c.slice(0, 6).join(" · ") || void 0;
	return {
		id: n,
		name: r,
		icon: _(t.icon),
		description: _(t.description),
		slots: o.length,
		workerTotal: s,
		roster: l,
		maxWorkers: a,
		autoStart: t.autoStart === !0,
		updatedAt: _(t.updatedAt)
	};
}
function S(e) {
	if (!e || typeof e != "object") return null;
	let t = e, n = _(t.id);
	return n ? {
		id: n,
		name: _(t.displayName) ?? _(t.name) ?? n,
		icon: _(t.icon),
		model: _(t.model),
		category: _(t.category),
		description: _(t.description)
	} : null;
}
function C(e) {
	if (!e || typeof e != "object") return null;
	let t = e, n = _(t.id);
	return n ? {
		id: n,
		name: _(t.name) ?? n,
		type: _(t.type),
		enabled: t.enabled !== !1,
		description: _(t.description)
	} : null;
}
function w(e) {
	if (!e || typeof e != "object") return null;
	let t = e, n = _(t.id);
	return n ? {
		id: n,
		profileName: _(t.profileName),
		profileIcon: _(t.profileIcon),
		state: _(t.state) ?? "unknown",
		model: _(t.model),
		mode: _(t.mode),
		lastAction: _(t.lastAction),
		spawnedAt: typeof t.spawnedAt == "number" ? t.spawnedAt : void 0,
		lastActivity: typeof t.lastActivity == "number" ? t.lastActivity : void 0
	} : null;
}
function T(e) {
	return e.length > m ? `${e.slice(0, m)}\n\n… (truncated)` : e;
}
function E(e, t, n) {
	let r = _(n);
	r && e.push({
		label: t,
		value: r
	});
}
function D(e, t, n) {
	let r = _(n);
	r && e.push({
		label: t,
		value: T(r),
		block: !0
	});
}
function O(e) {
	return typeof e == "number" && e > 0 ? new Date(e).toLocaleString() : _(e);
}
function k(e) {
	let t = [], n = (Array.isArray(e.slots) ? e.slots : []).map((e) => {
		if (!e || typeof e != "object") return null;
		let t = e, n = _(t.profileId);
		if (!n) return null;
		let r = typeof t.quantity == "number" && t.quantity > 0 ? t.quantity : 1;
		return r > 1 ? `${n} ×${r}` : n;
	}).filter((e) => e !== null);
	E(t, "Description", e.description), E(t, "Orchestrator", e.orchestratorProfileId), n.length && t.push({
		label: "Roster",
		value: n.join(", ")
	});
	let r = e.rules && typeof e.rules == "object" ? e.rules : {}, i = [];
	return typeof r.maxConcurrentWorkers == "number" && i.push(`max ${r.maxConcurrentWorkers} concurrent`), r.autoRestart === !0 && i.push("auto-restart"), r.requireApproval === !0 && i.push("requires approval"), i.length && t.push({
		label: "Rules",
		value: i.join(" · ")
	}), t.push({
		label: "Auto-start",
		value: e.autoStart === !0 ? "yes" : "no"
	}), E(t, "Updated", O(e.updatedAt)), D(t, "Initial prompt", e.initialPrompt), t;
}
function A(e) {
	let t = [];
	return E(t, "Description", e.description), E(t, "Category", e.category), E(t, "Model", e.model), E(t, "Effort", e.effortLevel), E(t, "Permission mode", e.permissionMode), Array.isArray(e.allowedTools) && e.allowedTools.length && t.push({
		label: "Allowed tools",
		value: e.allowedTools.map(String).join(", ")
	}), E(t, "Updated", O(e.updatedAt)), D(t, "System prompt", e.systemPrompt), t;
}
function j(e) {
	let t = [];
	return E(t, "Type", e.type), t.push({
		label: "Enabled",
		value: e.enabled === !1 ? "no" : "yes"
	}), e.global === !0 && t.push({
		label: "Scope",
		value: "global"
	}), E(t, "Description", e.description), E(t, "Updated", O(e.updatedAt)), D(t, "Content", e.content), t;
}
function M(e) {
	let t = [];
	return E(t, "State", e.state), E(t, "Profile", e.profileName ?? e.profileId), E(t, "Model", e.model), E(t, "Mode", e.mode), E(t, "Working dir", e.cwd), typeof e.exitCode == "number" && t.push({
		label: "Exit code",
		value: String(e.exitCode)
	}), typeof e.tokenCount == "number" && t.push({
		label: "Tokens",
		value: String(e.tokenCount)
	}), E(t, "Spawned", O(e.spawnedAt)), E(t, "Last activity", O(e.lastActivity)), E(t, "Last action", e.lastAction), D(t, "Prompt", e.prompt), D(t, "Result", e.result), t;
}
var N = {
	team: "teams",
	profile: "profiles",
	skill: "skills",
	run: "runs"
};
async function P(e, n) {
	try {
		let n = g(await e.readFile(t(h, "sprints", "_index.json"), "utf-8"));
		return Array.isArray(n) ? n.slice(0, f).map((e) => {
			let t = e ?? {}, n = _(t.id);
			return n ? {
				id: n,
				status: _(t.status) ?? "unknown",
				updatedAt: _(t.updatedAt)
			} : null;
		}).filter((e) => e !== null) : [];
	} catch {
		return [];
	}
}
async function F(e) {
	try {
		let n = g(await e.readFile(t(h, "workers.json"), "utf-8"));
		return Array.isArray(n) ? n.length : 0;
	} catch {
		return 0;
	}
}
async function I(e) {
	try {
		let n = g(await e.readFile(t(h, "automation-state.json"), "utf-8"));
		if (!n || typeof n != "object") return 0;
		let r = n;
		return r.goals && typeof r.goals == "object" ? Object.keys(r.goals).length : Object.keys(r).length;
	} catch {
		return 0;
	}
}
var L = r({
	id: "zana-hub",
	setup(e) {
		let r = e.fs, i = async (e) => {
			if (!r || typeof e != "string" || !y(e)) return null;
			let n;
			try {
				n = await r.readFile(t(h, "teams", `${e}.json`), "utf-8");
			} catch {
				return null;
			}
			let i = g(n);
			if (!i || typeof i != "object") return null;
			let a = i, o = Array.isArray(a.slots) ? a.slots.map((e) => {
				let t = e ?? {}, n = _(t.profileId), r = typeof t.quantity == "number" ? t.quantity : 1;
				return n ? {
					profileId: n,
					quantity: r
				} : null;
			}).filter((e) => e !== null) : [], s = a.rules && typeof a.rules == "object" ? a.rules : {};
			return {
				template: {
					id: _(a.id) ?? e,
					name: _(a.name) ?? e,
					icon: _(a.icon),
					description: _(a.description),
					orchestratorProfileId: _(a.orchestratorProfileId),
					slots: o,
					initialPrompt: _(a.initialPrompt),
					maxConcurrentWorkers: typeof s.maxConcurrentWorkers == "number" ? s.maxConcurrentWorkers : void 0,
					autoStart: a.autoStart === !0
				},
				raw: a
			};
		}, l = async (e) => {
			if (!r || typeof e != "string" || !y(e)) return null;
			let n;
			try {
				n = await r.readFile(t(h, "profiles", `${e}.json`), "utf-8");
			} catch {
				return null;
			}
			let i = g(n);
			if (!i || typeof i != "object") return null;
			let a = i;
			return {
				template: {
					id: _(a.id) ?? e,
					displayName: _(a.displayName) ?? _(a.name) ?? e,
					icon: _(a.icon),
					description: _(a.description),
					category: _(a.category),
					model: _(a.model),
					effortLevel: _(a.effortLevel),
					permissionMode: _(a.permissionMode),
					systemPrompt: _(a.systemPrompt),
					allowedTools: v(a.allowedTools),
					disallowedTools: v(a.disallowedTools)
				},
				raw: a
			};
		};
		return {
			async overview() {
				let t = [], n = (e) => {
					t.length < 20 && t.push(e);
				};
				if (!r) return {
					present: !1,
					teams: [],
					profiles: [],
					skills: [],
					sprints: [],
					runs: [],
					runStateCounts: {},
					workerCount: 0,
					autopilotGoalCount: 0,
					warnings: ["filesystem capability unavailable — grant fs:read for ~/.zana"]
				};
				let i = !0;
				try {
					await r.readdir(h);
				} catch {
					i = !1;
				}
				if (!i) return {
					present: !1,
					teams: [],
					profiles: [],
					skills: [],
					sprints: [],
					runs: [],
					runStateCounts: {},
					workerCount: 0,
					autopilotGoalCount: 0,
					warnings: []
				};
				let [a, o, s, c, l, u, d] = await Promise.all([
					b(r, "teams", n),
					b(r, "profiles", n),
					b(r, "skills", n),
					b(r, "runs", n),
					P(r, n),
					F(r),
					I(r)
				]), f = a.map(x).filter((e) => e !== null), m = o.map(S).filter((e) => e !== null), g = s.map(C).filter((e) => e !== null), _ = c.map(w).filter((e) => e !== null), v = {};
				for (let e of _) v[e.state] = (v[e.state] ?? 0) + 1;
				let y = _.slice().sort((e, t) => (t.lastActivity ?? t.spawnedAt ?? 0) - (e.lastActivity ?? e.spawnedAt ?? 0)).slice(0, p);
				return f.sort((e, t) => (t.updatedAt ?? "").localeCompare(e.updatedAt ?? "")), m.sort((e, t) => e.name.localeCompare(t.name)), g.sort((e, t) => e.name.localeCompare(t.name)), e.log(`overview: ${f.length} teams, ${m.length} profiles, ${g.length} skills, ${_.length} runs, ${l.length} sprints`), {
					present: !0,
					teams: f,
					profiles: m,
					skills: g,
					sprints: l,
					runs: y,
					runStateCounts: v,
					workerCount: u,
					autopilotGoalCount: d,
					warnings: t
				};
			},
			getTeam: i,
			async listProfiles() {
				if (!r) return [];
				let e = await b(r, "profiles", () => {}), t = [];
				for (let n of e) {
					if (!n || typeof n != "object") continue;
					let e = n, r = _(e.id);
					r && t.push({
						id: r,
						displayName: _(e.displayName) ?? _(e.name) ?? r,
						icon: _(e.icon)
					});
				}
				return t.sort((e, t) => e.displayName.localeCompare(t.displayName)), t;
			},
			async saveTeam(n) {
				if (!r) return {
					ok: !1,
					error: "Filesystem write capability unavailable — grant fs:write for ~/.zana."
				};
				let c = o(n);
				if (c) return {
					ok: !1,
					error: c
				};
				let l = [];
				try {
					l = (await r.readdir(t(h, "teams"))).filter((e) => e.endsWith(".json") && e !== "_index.json").map((e) => e.slice(0, -5));
				} catch {
					l = [];
				}
				let u, d = {};
				if (n.id && y(n.id)) {
					u = n.id;
					let e = await i(u);
					e && (d = e.raw);
				} else u = a(n.name, l);
				let f = s(n, d, u, (/* @__PURE__ */ new Date()).toISOString());
				try {
					await r.writeFile(t(h, "teams", `${u}.json`), JSON.stringify(f, null, 2));
				} catch (e) {
					return {
						ok: !1,
						error: e instanceof Error ? e.message : String(e)
					};
				}
				return e.log(`saveTeam: wrote teams/${u}.json`), {
					ok: !0,
					id: u
				};
			},
			getProfile: l,
			async saveProfile(i) {
				if (!r) return {
					ok: !1,
					error: "Filesystem write capability unavailable — grant fs:write for ~/.zana."
				};
				let a = c(i);
				if (a) return {
					ok: !1,
					error: a
				};
				let o, s = {};
				if (i.id && y(i.id)) {
					o = i.id;
					let e = await l(o);
					e && (s = e.raw);
				} else o = n();
				let u = d(i, s, o, (/* @__PURE__ */ new Date()).toISOString());
				try {
					await r.writeFile(t(h, "profiles", `${o}.json`), JSON.stringify(u, null, 2));
				} catch (e) {
					return {
						ok: !1,
						error: e instanceof Error ? e.message : String(e)
					};
				}
				return e.log(`saveProfile: wrote profiles/${o}.json`), {
					ok: !0,
					id: o
				};
			},
			async detail(e, n) {
				if (!r) return null;
				let i = N[e];
				if (!i || typeof n != "string" || !/^[\w.-]+$/.test(n) || n.includes("..")) return null;
				let a;
				try {
					a = await r.readFile(t(h, i, `${n}.json`), "utf-8");
				} catch {
					return null;
				}
				let o = g(a);
				if (!o || typeof o != "object") return null;
				let s = o, c, l;
				return e === "team" ? (c = k(s), l = _(s.name) ?? n) : e === "profile" ? (c = A(s), l = _(s.displayName) ?? _(s.name) ?? n) : e === "skill" ? (c = j(s), l = _(s.name) ?? n) : (c = M(s), l = _(s.profileName) ?? n), {
					kind: e,
					id: n,
					title: l,
					icon: _(s.icon) ?? _(s.profileIcon),
					fields: c
				};
			}
		};
	}
});
//#endregion
export { L as default };
