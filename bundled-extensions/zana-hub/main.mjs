import { homedir as D } from "node:os";
import { join as w } from "node:path";
import { randomUUID as M } from "node:crypto";
function E(e) {
  return e.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "team";
}
function L(e, t) {
  const l = new Set(t), i = E(e);
  if (!l.has(i)) return i;
  let n = 2;
  for (; l.has(`${i}-${n}`); ) n++;
  return `${i}-${n}`;
}
function _(e) {
  if (!e || typeof e.name != "string" || !e.name.trim())
    return "Team name is required.";
  if (!Array.isArray(e.slots) || e.slots.length === 0)
    return "At least one roster slot is required.";
  for (const t of e.slots) {
    if (!t || typeof t.profileId != "string" || !t.profileId.trim())
      return "Every slot needs a profile.";
    if (typeof t.quantity != "number" || !Number.isInteger(t.quantity) || t.quantity < 1)
      return "Slot quantity must be a whole number ≥ 1.";
  }
  return e.maxConcurrentWorkers != null && (!Number.isInteger(e.maxConcurrentWorkers) || e.maxConcurrentWorkers < 1) ? "Max concurrent workers must be a whole number ≥ 1." : null;
}
function F(e, t, l, i) {
  const n = e.slots.map((c) => ({ profileId: c.profileId, quantity: c.quantity })), a = [];
  for (const c of n) a.includes(c.profileId) || a.push(c.profileId);
  const s = n.reduce((c, p) => c + p.quantity, 0), r = t.rules && typeof t.rules == "object" ? t.rules : {}, f = typeof r.maxConcurrentWorkers == "number" ? r.maxConcurrentWorkers : void 0, u = e.maxConcurrentWorkers ?? f ?? s;
  return {
    ...t,
    // preserve unknown/unedited top-level keys (dynamicSpawning, …)
    id: l,
    name: e.name.trim(),
    icon: e.icon,
    description: e.description,
    orchestratorProfileId: e.orchestratorProfileId,
    slots: n,
    initialPrompt: e.initialPrompt,
    rules: { ...r, maxConcurrentWorkers: u },
    autoStart: e.autoStart === !0,
    workerProfileIds: a,
    maxTotalWorkers: s,
    updatedAt: i
  };
}
function O(e) {
  return !e || typeof e.displayName != "string" || !e.displayName.trim() ? "Profile name is required." : !Array.isArray(e.allowedTools) || !Array.isArray(e.disallowedTools) ? "Tool lists must be arrays." : null;
}
function x(e) {
  const t = [];
  for (const l of e) {
    const i = typeof l == "string" ? l.trim() : "";
    i && !t.includes(i) && t.push(i);
  }
  return t;
}
function z(e, t) {
  const l = e[t];
  return typeof l == "string" ? l : void 0;
}
function U(e, t, l, i) {
  return {
    ...t,
    // preserve unknown/unedited top-level keys
    id: l,
    displayName: e.displayName.trim(),
    icon: e.icon,
    description: e.description,
    category: e.category,
    model: e.model,
    effortLevel: e.effortLevel,
    permissionMode: e.permissionMode,
    systemPrompt: e.systemPrompt,
    allowedTools: x(e.allowedTools),
    disallowedTools: x(e.disallowedTools),
    builtIn: t.builtIn === !0,
    createdAt: z(t, "createdAt") ?? i,
    updatedAt: i
  };
}
const W = 200, G = 40, q = 8e3, y = w(D(), ".zana");
function b(e) {
  try {
    return JSON.parse(e);
  } catch {
    return;
  }
}
function o(e) {
  return typeof e == "string" && e ? e : void 0;
}
function N(e) {
  return Array.isArray(e) ? e.filter((t) => typeof t == "string" && t.length > 0) : [];
}
function C(e) {
  return /^[a-zA-Z0-9._-]+$/.test(e) && e !== "." && e !== "..";
}
async function v(e, t, l) {
  let i;
  try {
    i = await e.readdir(w(y, t));
  } catch {
    return [];
  }
  const n = i.filter((s) => s.endsWith(".json") && s !== "_index.json").slice(0, W), a = [];
  for (const s of n)
    try {
      const r = await e.readFile(w(y, t, s), "utf-8"), f = b(r);
      f !== void 0 && a.push(f);
    } catch (r) {
      l(`skipped ${t}/${s}: ${r instanceof Error ? r.message : String(r)}`);
    }
  return a;
}
function J(e) {
  if (!e || typeof e != "object") return null;
  const t = e, l = o(t.id), i = o(t.name);
  if (!l || !i) return null;
  const n = t.rules && typeof t.rules == "object" ? t.rules : {}, a = typeof n.maxConcurrentWorkers == "number" ? n.maxConcurrentWorkers : typeof t.maxTotalWorkers == "number" ? t.maxTotalWorkers : void 0, s = Array.isArray(t.slots) ? t.slots : [];
  let r = 0;
  const f = [];
  for (const c of s) {
    if (!c || typeof c != "object") continue;
    const p = c, g = o(p.profileId), h = typeof p.quantity == "number" && p.quantity > 0 ? p.quantity : 1;
    r += h, g && f.push(h > 1 ? `${g}×${h}` : g);
  }
  const u = f.slice(0, 6).join(" · ") || void 0;
  return {
    id: l,
    name: i,
    icon: o(t.icon),
    description: o(t.description),
    slots: s.length,
    workerTotal: r,
    roster: u,
    maxWorkers: a,
    autoStart: t.autoStart === !0,
    updatedAt: o(t.updatedAt)
  };
}
function X(e) {
  if (!e || typeof e != "object") return null;
  const t = e, l = o(t.id);
  return l ? {
    id: l,
    name: o(t.displayName) ?? o(t.name) ?? l,
    icon: o(t.icon),
    model: o(t.model),
    category: o(t.category),
    description: o(t.description)
  } : null;
}
function B(e) {
  if (!e || typeof e != "object") return null;
  const t = e, l = o(t.id);
  return l ? {
    id: l,
    name: o(t.name) ?? l,
    type: o(t.type),
    enabled: t.enabled !== !1,
    description: o(t.description)
  } : null;
}
function Z(e) {
  if (!e || typeof e != "object") return null;
  const t = e, l = o(t.id);
  return l ? {
    id: l,
    profileName: o(t.profileName),
    profileIcon: o(t.profileIcon),
    state: o(t.state) ?? "unknown",
    model: o(t.model),
    mode: o(t.mode),
    lastAction: o(t.lastAction),
    spawnedAt: typeof t.spawnedAt == "number" ? t.spawnedAt : void 0,
    lastActivity: typeof t.lastActivity == "number" ? t.lastActivity : void 0
  } : null;
}
function K(e) {
  return e.length > q ? `${e.slice(0, q)}

… (truncated)` : e;
}
function m(e, t, l) {
  const i = o(l);
  i && e.push({ label: t, value: i });
}
function S(e, t, l) {
  const i = o(l);
  i && e.push({ label: t, value: K(i), block: !0 });
}
function j(e) {
  return typeof e == "number" && e > 0 ? new Date(e).toLocaleString() : o(e);
}
function H(e) {
  const t = [], i = (Array.isArray(e.slots) ? e.slots : []).map((s) => {
    if (!s || typeof s != "object") return null;
    const r = s, f = o(r.profileId);
    if (!f) return null;
    const u = typeof r.quantity == "number" && r.quantity > 0 ? r.quantity : 1;
    return u > 1 ? `${f} ×${u}` : f;
  }).filter((s) => s !== null);
  m(t, "Description", e.description), m(t, "Orchestrator", e.orchestratorProfileId), i.length && t.push({ label: "Roster", value: i.join(", ") });
  const n = e.rules && typeof e.rules == "object" ? e.rules : {}, a = [];
  return typeof n.maxConcurrentWorkers == "number" && a.push(`max ${n.maxConcurrentWorkers} concurrent`), n.autoRestart === !0 && a.push("auto-restart"), n.requireApproval === !0 && a.push("requires approval"), a.length && t.push({ label: "Rules", value: a.join(" · ") }), t.push({ label: "Auto-start", value: e.autoStart === !0 ? "yes" : "no" }), m(t, "Updated", j(e.updatedAt)), S(t, "Initial prompt", e.initialPrompt), t;
}
function Q(e) {
  const t = [];
  return m(t, "Description", e.description), m(t, "Category", e.category), m(t, "Model", e.model), m(t, "Effort", e.effortLevel), m(t, "Permission mode", e.permissionMode), Array.isArray(e.allowedTools) && e.allowedTools.length && t.push({ label: "Allowed tools", value: e.allowedTools.map(String).join(", ") }), m(t, "Updated", j(e.updatedAt)), S(t, "System prompt", e.systemPrompt), t;
}
function V(e) {
  const t = [];
  return m(t, "Type", e.type), t.push({ label: "Enabled", value: e.enabled !== !1 ? "yes" : "no" }), e.global === !0 && t.push({ label: "Scope", value: "global" }), m(t, "Description", e.description), m(t, "Updated", j(e.updatedAt)), S(t, "Content", e.content), t;
}
function Y(e) {
  const t = [];
  return m(t, "State", e.state), m(t, "Profile", e.profileName ?? e.profileId), m(t, "Model", e.model), m(t, "Mode", e.mode), m(t, "Working dir", e.cwd), typeof e.exitCode == "number" && t.push({ label: "Exit code", value: String(e.exitCode) }), typeof e.tokenCount == "number" && t.push({ label: "Tokens", value: String(e.tokenCount) }), m(t, "Spawned", j(e.spawnedAt)), m(t, "Last activity", j(e.lastActivity)), m(t, "Last action", e.lastAction), S(t, "Prompt", e.prompt), S(t, "Result", e.result), t;
}
const ee = {
  team: "teams",
  profile: "profiles",
  skill: "skills",
  run: "runs"
};
async function te(e, t) {
  try {
    const l = await e.readFile(w(y, "sprints", "_index.json"), "utf-8"), i = b(l);
    return Array.isArray(i) ? i.slice(0, W).map((n) => {
      const a = n ?? {}, s = o(a.id);
      return s ? { id: s, status: o(a.status) ?? "unknown", updatedAt: o(a.updatedAt) } : null;
    }).filter((n) => n !== null) : [];
  } catch {
    return [];
  }
}
async function re(e) {
  try {
    const t = await e.readFile(w(y, "workers.json"), "utf-8"), l = b(t);
    return Array.isArray(l) ? l.length : 0;
  } catch {
    return 0;
  }
}
async function oe(e) {
  try {
    const t = await e.readFile(w(y, "automation-state.json"), "utf-8"), l = b(t);
    if (!l || typeof l != "object") return 0;
    const i = l;
    return i.goals && typeof i.goals == "object" ? Object.keys(i.goals).length : Object.keys(i).length;
  } catch {
    return 0;
  }
}
const le = {
  id: "zana-hub",
  setup(e) {
    const t = e.fs, l = async (n) => {
      if (!t || typeof n != "string" || !C(n)) return null;
      let a;
      try {
        a = await t.readFile(w(y, "teams", `${n}.json`), "utf-8");
      } catch {
        return null;
      }
      const s = b(a);
      if (!s || typeof s != "object") return null;
      const r = s, f = Array.isArray(r.slots) ? r.slots.map((p) => {
        const g = p ?? {}, h = o(g.profileId), k = typeof g.quantity == "number" ? g.quantity : 1;
        return h ? { profileId: h, quantity: k } : null;
      }).filter((p) => p !== null) : [], u = r.rules && typeof r.rules == "object" ? r.rules : {};
      return { template: {
        id: o(r.id) ?? n,
        name: o(r.name) ?? n,
        icon: o(r.icon),
        description: o(r.description),
        orchestratorProfileId: o(r.orchestratorProfileId),
        slots: f,
        initialPrompt: o(r.initialPrompt),
        maxConcurrentWorkers: typeof u.maxConcurrentWorkers == "number" ? u.maxConcurrentWorkers : void 0,
        autoStart: r.autoStart === !0
      }, raw: r };
    }, i = async (n) => {
      if (!t || typeof n != "string" || !C(n)) return null;
      let a;
      try {
        a = await t.readFile(w(y, "profiles", `${n}.json`), "utf-8");
      } catch {
        return null;
      }
      const s = b(a);
      if (!s || typeof s != "object") return null;
      const r = s;
      return { template: {
        id: o(r.id) ?? n,
        displayName: o(r.displayName) ?? o(r.name) ?? n,
        icon: o(r.icon),
        description: o(r.description),
        category: o(r.category),
        model: o(r.model),
        effortLevel: o(r.effortLevel),
        permissionMode: o(r.permissionMode),
        systemPrompt: o(r.systemPrompt),
        allowedTools: N(r.allowedTools),
        disallowedTools: N(r.disallowedTools)
      }, raw: r };
    };
    return {
      /**
       * Read the whole global Zana workspace into one overview. No args. Always
       * resolves (never throws): a missing `~/.zana` or any partial-read problem
       * is reported via `present` / `warnings`, so the panel can render an
       * honest empty/partial state instead of an error wall.
       */
      async overview() {
        const n = [], a = (d) => {
          n.length < 20 && n.push(d);
        };
        if (!t)
          return {
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
        let s = !0;
        try {
          await t.readdir(y);
        } catch {
          s = !1;
        }
        if (!s)
          return {
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
        const [r, f, u, c, p, g, h] = await Promise.all([
          v(t, "teams", a),
          v(t, "profiles", a),
          v(t, "skills", a),
          v(t, "runs", a),
          te(t),
          re(t),
          oe(t)
        ]), k = r.map(J).filter((d) => d !== null), I = f.map(X).filter((d) => d !== null), P = u.map(B).filter((d) => d !== null), T = c.map(Z).filter((d) => d !== null), $ = {};
        for (const d of T) $[d.state] = ($[d.state] ?? 0) + 1;
        const R = T.slice().sort((d, A) => (A.lastActivity ?? A.spawnedAt ?? 0) - (d.lastActivity ?? d.spawnedAt ?? 0)).slice(0, G);
        return k.sort((d, A) => (A.updatedAt ?? "").localeCompare(d.updatedAt ?? "")), I.sort((d, A) => d.name.localeCompare(A.name)), P.sort((d, A) => d.name.localeCompare(A.name)), e.log(
          `overview: ${k.length} teams, ${I.length} profiles, ${P.length} skills, ${T.length} runs, ${p.length} sprints`
        ), {
          present: !0,
          teams: k,
          profiles: I,
          skills: P,
          sprints: p,
          runs: R,
          runStateCounts: $,
          workerCount: g,
          autopilotGoalCount: h,
          warnings: n
        };
      },
      getTeam: l,
      /** List `~/.zana/profiles` as dropdown options. Never throws. */
      async listProfiles() {
        if (!t) return [];
        const n = await v(t, "profiles", () => {
        }), a = [];
        for (const s of n) {
          if (!s || typeof s != "object") continue;
          const r = s, f = o(r.id);
          f && a.push({
            id: f,
            displayName: o(r.displayName) ?? o(r.name) ?? f,
            icon: o(r.icon)
          });
        }
        return a.sort((s, r) => s.displayName.localeCompare(r.displayName)), a;
      },
      /**
       * The SINGLE write seam. Validates, resolves the id/filename (slug for a
       * new team, preserved for an edit), merges onto the existing raw object,
       * normalizes derived fields, and writes. Never throws — failure is data.
       */
      async saveTeam(n) {
        if (!t) return { ok: !1, error: "Filesystem write capability unavailable — grant fs:write for ~/.zana." };
        const a = _(n);
        if (a) return { ok: !1, error: a };
        let s = [];
        try {
          s = (await t.readdir(w(y, "teams"))).filter((c) => c.endsWith(".json") && c !== "_index.json").map((c) => c.slice(0, -5));
        } catch {
          s = [];
        }
        let r, f = {};
        if (n.id && C(n.id)) {
          r = n.id;
          const c = await l(r);
          c && (f = c.raw);
        } else
          r = L(n.name, s);
        const u = F(n, f, r, (/* @__PURE__ */ new Date()).toISOString());
        try {
          await t.writeFile(w(y, "teams", `${r}.json`), JSON.stringify(u, null, 2));
        } catch (c) {
          return { ok: !1, error: c instanceof Error ? c.message : String(c) };
        }
        return e.log(`saveTeam: wrote teams/${r}.json`), { ok: !0, id: r };
      },
      getProfile: i,
      /**
       * The SINGLE profile write seam. Validates, resolves the id/filename
       * (a minted UUID for a new profile, preserved for an edit), merges onto
       * the existing raw object, and writes. Never throws — failure is data.
       */
      async saveProfile(n) {
        if (!t) return { ok: !1, error: "Filesystem write capability unavailable — grant fs:write for ~/.zana." };
        const a = O(n);
        if (a) return { ok: !1, error: a };
        let s, r = {};
        if (n.id && C(n.id)) {
          s = n.id;
          const u = await i(s);
          u && (r = u.raw);
        } else
          s = M();
        const f = U(n, r, s, (/* @__PURE__ */ new Date()).toISOString());
        try {
          await t.writeFile(w(y, "profiles", `${s}.json`), JSON.stringify(f, null, 2));
        } catch (u) {
          return { ok: !1, error: u instanceof Error ? u.message : String(u) };
        }
        return e.log(`saveProfile: wrote profiles/${s}.json`), { ok: !0, id: s };
      },
      /**
       * Read the FULL record behind one row (a team/profile/skill/run) on
       * demand and curate it into an ordered, bounded {@link ZanaDetail} for the
       * panel's detail view. Reading only when the user clicks keeps the
       * overview payload small while still surfacing the rich fields (system
       * prompts, skill content, initial prompts, run results) the summary omits.
       *
       * `id` is treated as an opaque file stem: records are stored as
       * `<dir>/<id>.json`. It is sanitised (no separators / `..`) so a crafted
       * id can't escape the fs-gated `~/.zana` root. Resolves `null` when the
       * kind is unknown or the file is missing/unreadable/malformed.
       */
      async detail(n, a) {
        if (!t) return null;
        const s = ee[n];
        if (!s || typeof a != "string" || !/^[\w.-]+$/.test(a) || a.includes("..")) return null;
        let r;
        try {
          r = await t.readFile(w(y, s, `${a}.json`), "utf-8");
        } catch {
          return null;
        }
        const f = b(r);
        if (!f || typeof f != "object") return null;
        const u = f;
        let c, p;
        return n === "team" ? (c = H(u), p = o(u.name) ?? a) : n === "profile" ? (c = Q(u), p = o(u.displayName) ?? o(u.name) ?? a) : n === "skill" ? (c = V(u), p = o(u.name) ?? a) : (c = Y(u), p = o(u.profileName) ?? a), { kind: n, id: a, title: p, icon: o(u.icon) ?? o(u.profileIcon), fields: c };
      }
    };
  }
};
export {
  le as default
};
