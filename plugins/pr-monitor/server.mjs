// lib/types.ts
var TIS_PRESETS = {
  fast: { id: "fast", label: "Fast", warnHours: 1, dangerHours: 2 },
  standard: { id: "standard", label: "Standard", warnHours: 4, dangerHours: 6 },
  "long-running": { id: "long-running", label: "Long-running", warnHours: 12, dangerHours: 24 }
};
var DEFAULT_TIS_PRESET = "standard";
var DEFAULT_REVIEW_TIS_PRESET = "standard";
var EMPTY_SYNC_HEALTH_STATE = { gone404: {}, kept: [] };
var EMPTY_SYNC_HEALTH = {
  disconnectedHosts: [],
  outageHosts: [],
  remoteGone: [],
  keptGone: []
};
var DEFAULT_SETTINGS_NAV = "organizations";
var DEFAULT_PR_MONITOR_SETTINGS = {
  pollIntervalMinutes: 15,
  notifyOnChange: true,
  badgeMode: "total",
  watchedRepos: [],
  watchedPeople: [],
  relevanceModes: {
    authored: true,
    reviewRequested: true,
    involved: true
  },
  autoDiscover: false,
  discoverHosts: void 0,
  tisWarnHours: 4,
  tisDangerHours: 6,
  reviewWarnDays: 3,
  reviewDangerDays: 5,
  gusLocatorBaseUrl: void 0,
  settingsActiveNav: DEFAULT_SETTINGS_NAV,
  organizations: [],
  repositories: [],
  orgDiscovered: false,
  authorDiscovered: false,
  notifyInApp: true,
  sendToInbox: false,
  autoSyncEnabled: true
};
var SETTINGS_STORAGE_KEY = "settings";
var GITHUB_PR_URL_RE = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;
function repoOf(url) {
  const m = GITHUB_PR_URL_RE.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return m[2];
}
function prNumber(url) {
  const m = GITHUB_PR_URL_RE.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return Number(m[3]);
}
var STATUS_PRIORITY = {
  failed: 7,
  conflict: 6,
  yellow: 5,
  "review-required": 4,
  pending: 3,
  integrating: 2,
  green: 1,
  "closed-abandoned": 0,
  "closed-merged": 0
};
function statusPriority(status) {
  return STATUS_PRIORITY[status];
}
var WORK_ITEM_RE = /\bW-\d{8}\b/i;
function extractWorkItem(title, branch, body) {
  for (const source of [title, branch, body]) {
    if (typeof source !== "string" || !source) continue;
    const m = WORK_ITEM_RE.exec(source);
    if (m) return m[0].toUpperCase();
  }
  return void 0;
}

// lib/badge.ts
function isPrUnread(pr) {
  return pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
}
function computeNavBadge(args) {
  const badgeMode = args.settings?.badgeMode ?? DEFAULT_PR_MONITOR_SETTINGS.badgeMode;
  if (badgeMode === "unread") {
    const unseenCount = args.prs.filter(isPrUnread).length;
    return unseenCount > 0 ? unseenCount : null;
  }
  const totalCount = args.totalCount ?? args.prs.length;
  return totalCount > 0 ? totalCount : null;
}

// lib/gh-exec.ts
import { execFile as execFileCb } from "node:child_process";
var MAX_BUFFER = 8e6;
var DEFAULT_TIMEOUT_MS = 3e4;
function execCode(error) {
  if (!error) return 0;
  const raw = error.code;
  if (raw === "ENOENT") return 127;
  if (typeof raw === "number") return raw;
  const status = error.status;
  if (typeof status === "number") return status;
  return 1;
}
function createGhExec() {
  return ({ bin, args, timeoutMs }) => new Promise((resolve, reject) => {
    if (bin !== "gh") {
      reject(new Error("pr-monitor only executes gh"));
      return;
    }
    execFileCb(
      "gh",
      args,
      {
        timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          code: execCode(error),
          stdout: stdout ?? "",
          stderr: stderr ?? ""
        });
      }
    );
  });
}

// lib/notify.ts
function repoFor(pr, repositories) {
  const key = (pr.repo ?? "").toLowerCase();
  if (!key) return void 0;
  return (repositories ?? []).find(
    (r) => `${r.owner}/${r.repo}`.toLowerCase() === key
  );
}
function computeNotifyDelivery(pr, settings) {
  const repo = repoFor(pr, settings.repositories);
  const repoNotMuted = repo ? repo.notifyInApp !== false : true;
  const notificationWorthy = repoNotMuted && !pr.muted;
  if (!notificationWorthy) return { inApp: false, inbox: false };
  const globalInApp = settings.notifyInApp ?? settings.notifyOnChange ?? false;
  const globalInbox = settings.sendToInbox ?? false;
  return {
    inApp: globalInApp,
    inbox: globalInbox && !!pr.projectId
  };
}

// lib/inbox-delivery.ts
var STATUS_LABELS = {
  pending: "Pending",
  failed: "Failing",
  conflict: "Merge conflict",
  yellow: "Merge blocked",
  "review-required": "Review required",
  integrating: "Merging",
  green: "All checks passing",
  "closed-merged": "Merged",
  "closed-abandoned": "Closed"
};
function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}
function escapeMarkdownText(text) {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}
function safeMarkdownUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  } catch {
    return "";
  }
  return url.replace(/[)\s]/g, encodeURIComponent);
}
function isInterestingDelta(delta) {
  const worsened = statusPriority(delta.newStatus) > statusPriority(delta.oldStatus);
  return delta.newStatus === "failed" || delta.newStatus === "conflict" || delta.newStatus === "yellow" || delta.newStatus === "green" || delta.newStatus === "closed-merged" || delta.newStatus === "closed-abandoned" || worsened;
}
function inboxCommentForDelta(delta) {
  const repo = escapeMarkdownText(delta.pr.repo);
  const title = escapeMarkdownText(delta.pr.title);
  const href = safeMarkdownUrl(delta.pr.url);
  const titleLine = href ? `[${title}](${href})` : title;
  return `**${repo}#${delta.pr.number}** \u2014 ${statusLabel(delta.oldStatus)} \u2192 **${statusLabel(delta.newStatus)}**

${titleLine}`;
}
function inboxDeliveriesForDeltas(deltas, settings) {
  const out = [];
  for (const delta of deltas) {
    if (!isInterestingDelta(delta)) continue;
    const delivery = computeNotifyDelivery(delta.pr, settings);
    if (!delivery.inbox || !delta.pr.projectId) continue;
    out.push({
      projectId: delta.pr.projectId,
      comments: inboxCommentForDelta(delta),
      pr: delta.pr
    });
  }
  return out;
}

// lib/migrate.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var LEGACY_MODULE_ID = "pr-monitor";
function defaultPrMonitorDataDir() {
  return process.env.ZCC_DATA_DIR?.trim() || process.env.ZCC_CENTER_DIR?.trim() || join(homedir(), ".zcc");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function migrateLegacyKv(kv, dataDir = defaultPrMonitorDataDir()) {
  const keys = await kv.list();
  if (keys.length > 0) return false;
  const legacyPath = join(dataDir, "modules", `${LEGACY_MODULE_ID}.json`);
  if (!existsSync(legacyPath)) return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(legacyPath, "utf8"));
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const entries = Object.entries(parsed);
  if (entries.length === 0) return false;
  for (const [key, value] of entries) {
    await kv.set(key, value);
  }
  return true;
}

// lib/status.ts
var FAIL = /* @__PURE__ */ new Set(["fail", "failure"]);
var RUNNING = /* @__PURE__ */ new Set(["pending", "in_progress", "queued"]);
var EARLY_CHECKS = /^(gus|scm|codeowners|credential|lock.the.line|prizm|continuous-integration\/jenkins)/i;
var SYNC_RE = /sync['’]?d from Perforce to Git, as commit \[?([0-9a-f]{7,40})/i;
function normalize(s) {
  return (s ?? "").toLowerCase().trim() || "pending";
}
var SFCI_JOB_COMMENT_PREFIX = "An SFCI job has been created for your Pull Request at:";
var SFCI_JOB_AUTHOR = "tok-gimlet";
function hasSfciJobComment(comments) {
  if (!Array.isArray(comments)) return false;
  for (const c of comments) {
    if (!c || typeof c !== "object") continue;
    const rec = c;
    const login = rec.author?.login ?? rec.user?.login;
    if (typeof login !== "string" || login.toLowerCase() !== SFCI_JOB_AUTHOR) continue;
    const body = rec.body;
    if (typeof body !== "string") continue;
    if (body.trimStart().startsWith(SFCI_JOB_COMMENT_PREFIX)) return true;
  }
  return false;
}
var EXCERPT_MAX = 280;
function normalizeExcerpt(raw) {
  let s = raw ?? "";
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(\n[ \t]*\2[^\n]*)/g, "$1");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.split("\n").map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s?|[*_`]+)/, "")).join("\n");
  s = s.replace(/^\s*\n+/, "");
  s = s.trimEnd();
  if (s.length > EXCERPT_MAX) s = s.slice(0, EXCERPT_MAX);
  return s;
}
function computeStatus(mergeState, mergeable, checks) {
  const statuses = checks.map((c) => normalize(c.bucket || c.state));
  const total = statuses.length;
  const anyFail = statuses.some((s) => FAIL.has(s));
  const done = statuses.filter((s) => !RUNNING.has(s)).length;
  const allDone = total > 0 && done === total;
  const prState = (mergeState.state ?? "").toUpperCase();
  const mergeStatus = (mergeState.mergeStateStatus ?? "").toUpperCase();
  const mergeableUp = (mergeable ?? "").toUpperCase();
  const reviewDecision = (mergeState.reviewDecision ?? "").toUpperCase();
  if (prState === "MERGED") return "green";
  if (mergeableUp === "CONFLICTING" || mergeStatus === "DIRTY") {
    return "conflict";
  }
  if (anyFail) return "failed";
  if (!allDone) return "pending";
  if (mergeStatus === "CLEAN") return "green";
  if (mergeStatus === "BLOCKED") {
    const doneChecks = checks.filter((c) => !RUNNING.has(normalize(c.bucket || c.state)));
    const allEarly = doneChecks.length > 0 && doneChecks.every((c) => EARLY_CHECKS.test(c.name));
    if (allEarly) return "pending";
  }
  if (reviewDecision === "REVIEW_REQUIRED") return "review-required";
  return "yellow";
}
function computeClosedStatus(state, mergeStateStatus, probe) {
  if ((state ?? "").toUpperCase() === "MERGED") return "closed-merged";
  if (!probe || !probe.landedSha) return "closed-abandoned";
  if (!probe.finalBranch) return "integrating";
  if (probe.finalBranchContainsSha === true) return "closed-merged";
  if (probe.intermediateBranch && probe.intermediateBranchContainsSha === true) {
    return "integrating";
  }
  return "integrating";
}
function parsePrUrl(url) {
  const m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec((url ?? "").trim());
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3], number: m[4] };
}
function destBranches(base) {
  const b = (base ?? "").trim();
  if (b.startsWith("p4/")) return { final: b, intermediate: null };
  if (b.startsWith("m/")) {
    const suffix = b.replace(/\/+$/, "").split("/").pop() ?? "";
    return { final: `p4/${suffix}`, intermediate: b };
  }
  return { final: null, intermediate: null };
}

// lib/gh-client.ts
var GH_TIMEOUT_MS = 3e4;
function isSafeRepoArg(v) {
  return typeof v === "string" && /^[A-Za-z0-9._][A-Za-z0-9._-]*\/[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(v);
}
async function runGh(broker, args, log) {
  try {
    return await broker({ bin: "gh", args, timeoutMs: GH_TIMEOUT_MS });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log(`gh ${args.join(" ")} failed to spawn: ${detail}`);
    return null;
  }
}
function parseJson(stdout) {
  const s = stdout?.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
      }
    }
    return null;
  }
}
async function fetchChecks(ctx, url) {
  if (!ctx.exec) return [];
  const result = await runGh(ctx.exec, ["pr", "checks", "--json", "name,state,bucket", "--", url], ctx.log);
  if (!result) return [];
  const parsed = parseJson(result.stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((r) => !!r && typeof r === "object").map((r) => ({
    name: typeof r.name === "string" ? r.name : "unknown",
    state: typeof r.state === "string" ? r.state : "",
    bucket: typeof r.bucket === "string" ? r.bucket : void 0
  }));
}
function reduceReviewers(reviews, reviewRequests) {
  const byLogin = /* @__PURE__ */ new Map();
  for (const r of reviews) {
    const login = r?.author?.login;
    if (typeof login !== "string" || !login) continue;
    const state = String(r?.state ?? "").toUpperCase();
    let bucket = null;
    if (state === "APPROVED") bucket = "approved";
    else if (state === "CHANGES_REQUESTED") bucket = "changes-requested";
    if (!bucket) continue;
    const entry = { login, state: bucket };
    if (typeof r.author?.name === "string" && r.author.name) entry.name = r.author.name;
    byLogin.set(login, entry);
  }
  for (const req of reviewRequests) {
    const login = req?.login;
    if (typeof login !== "string" || !login) continue;
    const prior = byLogin.get(login);
    if (prior && prior.state === "changes-requested") continue;
    const entry = { login, state: "review-requested" };
    if (typeof req.name === "string" && req.name) entry.name = req.name;
    byLogin.set(login, entry);
  }
  return Array.from(byLogin.values());
}
async function fetchMergeState(ctx, url) {
  const empty = {
    state: "",
    mergeStateStatus: "",
    mergeable: "",
    title: "",
    baseRefName: "",
    reviewDecision: "",
    headRefName: "",
    author: null,
    isDraft: false,
    body: "",
    createdAt: 0,
    updatedAt: 0,
    reviewers: []
  };
  if (!ctx.exec) return empty;
  const result = await runGh(
    ctx.exec,
    [
      "pr",
      "view",
      "--json",
      "state,mergeStateStatus,mergeable,reviewDecision,title,baseRefName,headRefName,author,isDraft,body,createdAt,updatedAt,reviews,reviewRequests",
      "--",
      url
    ],
    ctx.log
  );
  if (!result || result.code !== 0) return empty;
  const parsed = parseJson(result.stdout);
  if (!parsed || typeof parsed !== "object") return empty;
  let author = null;
  if (parsed.author && typeof parsed.author === "object" && typeof parsed.author.login === "string") {
    author = { login: parsed.author.login };
    if (typeof parsed.author.name === "string") {
      author.name = parsed.author.name;
    }
  }
  const body = normalizeExcerpt(typeof parsed.body === "string" ? parsed.body : "");
  let createdAt = 0;
  if (typeof parsed.createdAt === "string") {
    const d = new Date(parsed.createdAt);
    if (!isNaN(d.getTime())) {
      createdAt = d.getTime();
    }
  }
  let updatedAt = 0;
  if (typeof parsed.updatedAt === "string") {
    const d = new Date(parsed.updatedAt);
    if (!isNaN(d.getTime())) {
      updatedAt = d.getTime();
    }
  }
  const reviewers = reduceReviewers(
    Array.isArray(parsed.reviews) ? parsed.reviews : [],
    Array.isArray(parsed.reviewRequests) ? parsed.reviewRequests : []
  );
  return {
    state: typeof parsed.state === "string" ? parsed.state : "",
    mergeStateStatus: typeof parsed.mergeStateStatus === "string" ? parsed.mergeStateStatus : "",
    mergeable: typeof parsed.mergeable === "string" ? parsed.mergeable : "",
    title: typeof parsed.title === "string" ? parsed.title : "",
    baseRefName: typeof parsed.baseRefName === "string" ? parsed.baseRefName : "",
    reviewDecision: typeof parsed.reviewDecision === "string" ? parsed.reviewDecision : "",
    headRefName: typeof parsed.headRefName === "string" ? parsed.headRefName : "",
    author,
    isDraft: typeof parsed.isDraft === "boolean" ? parsed.isDraft : false,
    body,
    createdAt,
    updatedAt,
    reviewers
  };
}
async function ghApi(ctx, host, path) {
  if (!ctx.exec) return null;
  const result = await runGh(ctx.exec, ["api", "--hostname", host, "--", path], ctx.log);
  if (!result || result.code !== 0) return null;
  return parseJson(result.stdout);
}
function apiBaseUrlForHost(host) {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}
var AUTH_HOSTS_TTL_MS = 6e4;
var authHostsCache = null;
function invalidateAuthHosts() {
  authHostsCache = null;
}
async function getAuthHosts(ctx) {
  if (!ctx.exec) return [];
  const cached = authHostsCache;
  if (cached && Date.now() - cached.at < AUTH_HOSTS_TTL_MS) return cached.accounts;
  const result = await runGh(ctx.exec, ["auth", "status"], ctx.log);
  if (!result) return [];
  const text = `${result.stdout ?? ""}
${result.stderr ?? ""}`;
  const accounts = parseAuthStatus(text);
  authHostsCache = { at: Date.now(), accounts };
  return accounts;
}
function parseAuthStatus(text) {
  const accounts = [];
  const lines = text.split("\n");
  let currentHost = "";
  let login = "";
  let active = false;
  const flush = () => {
    if (currentHost && login) {
      accounts.push({
        host: currentHost,
        login,
        apiBaseUrl: apiBaseUrlForHost(currentHost),
        active
      });
    }
    login = "";
    active = false;
  };
  for (const raw of lines) {
    const isIndented = /^\s/.test(raw);
    const line = raw.trim();
    if (!line) continue;
    if (!isIndented && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(line)) {
      flush();
      currentHost = line;
      continue;
    }
    const m = line.match(/Logged in to \S+ account (\S+)/i);
    if (m) login = m[1];
    if (/Active account:\s*true/i.test(line)) active = true;
  }
  flush();
  return accounts;
}
async function searchPrs(ctx, host, login, mode, watchedRepos) {
  if (!ctx.exec) {
    return { ok: false, error: "exec capability unavailable" };
  }
  let relation;
  if (mode === "authored") {
    relation = `author:${login}`;
  } else if (mode === "reviewRequested") {
    relation = `review-requested:${login}`;
  } else {
    relation = `involves:${login}`;
  }
  let q = `is:pr is:open ${relation}`;
  if (watchedRepos.length > 0) {
    for (const repo of watchedRepos) {
      if (!isSafeRepoArg(repo)) {
        ctx.log(`searchPrs: dropping unsafe repo filter ${JSON.stringify(repo)}`);
        continue;
      }
      q += ` repo:${repo}`;
    }
  }
  const MAX_PAGES = 5;
  const PER_PAGE = 100;
  const collected = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const path = `search/issues?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`;
    const data = await ghApi(ctx, host, path);
    if (!data || typeof data !== "object") {
      if (page === 1) {
        return { ok: false, error: `Search failed for ${host} (${relation}): no data returned (auth issue?)` };
      }
      break;
    }
    const payload = data;
    if (!Array.isArray(payload.items)) {
      if (page === 1) {
        return { ok: false, error: `Search failed for ${host} (${relation}): malformed response` };
      }
      break;
    }
    if (payload.items.length === 0) {
      break;
    }
    for (const item of payload.items) {
      if (!item || typeof item !== "object") continue;
      const i = item;
      if (typeof i.html_url !== "string" || !i.html_url) continue;
      if (typeof i.title !== "string") continue;
      if (typeof i.number !== "number") continue;
      if (!i.user || typeof i.user.login !== "string") continue;
      let repo = "";
      if (typeof i.repository_url === "string") {
        const m = i.repository_url.match(/\/([^/]+\/[^/]+)$/);
        if (m) repo = m[1];
      }
      if (!repo) {
        try {
          repo = i.html_url.match(/\/([^/]+\/[^/]+)\/pull\/\d+/)?.[1] ?? "";
        } catch {
        }
      }
      collected.push({
        url: i.html_url,
        title: i.title,
        number: i.number,
        repo,
        author: { login: i.user.login },
        isDraft: typeof i.draft === "boolean" ? i.draft : false
      });
    }
    if (payload.items.length < PER_PAGE) {
      break;
    }
  }
  if (collected.length >= MAX_PAGES * PER_PAGE) {
    ctx.log(
      `searchPrs(${host}, ${login}, ${mode}): truncated at ${collected.length} items (page cap ${MAX_PAGES})`
    );
  }
  return { ok: true, prs: collected };
}
async function listOrgRepos(ctx, host, org, page) {
  if (!ctx.exec) return { ok: false, error: "exec capability unavailable" };
  if (!/^[A-Za-z0-9._-]+$/.test(org) || org.startsWith("-")) {
    return { ok: false, error: `Invalid organization: ${JSON.stringify(org)}` };
  }
  const pg = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const PER_PAGE = 100;
  const tryPath = async (base) => {
    const data = await ghApi(ctx, host, `${base}/${org}/repos?per_page=${PER_PAGE}&page=${pg}&sort=full_name`);
    if (!Array.isArray(data)) return null;
    return data;
  };
  let rows = await tryPath("orgs");
  if (rows === null) rows = await tryPath("users");
  if (rows === null) {
    return { ok: false, error: `Could not list repositories for ${org} on ${host}` };
  }
  const repos = [];
  for (const r of rows) {
    const owner = r.owner?.login ?? org;
    const name = typeof r.name === "string" ? r.name : "";
    if (!name) continue;
    repos.push({
      owner,
      repo: name,
      fullName: typeof r.full_name === "string" ? r.full_name : `${owner}/${name}`,
      host,
      isPrivate: r.private === true
    });
  }
  return { ok: true, repos, hasMore: rows.length >= PER_PAGE };
}
async function searchRepos(ctx, host, query, org) {
  if (!ctx.exec) return { ok: false, error: "exec capability unavailable" };
  const q = String(query ?? "").trim();
  if (!q) return { ok: true, repos: [] };
  let full = q;
  if (org && /^[A-Za-z0-9._-]+$/.test(org) && !org.startsWith("-")) {
    full = `${q} org:${org}`;
  }
  const data = await ghApi(ctx, host, `search/repositories?q=${encodeURIComponent(full)}&per_page=50`);
  if (!data || typeof data !== "object") {
    return { ok: false, error: `Repository search failed on ${host}` };
  }
  const items = data.items;
  if (!Array.isArray(items)) return { ok: true, repos: [] };
  const repos = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const r = it;
    const owner = r.owner?.login ?? "";
    const name = typeof r.name === "string" ? r.name : "";
    if (!owner || !name) continue;
    repos.push({
      owner,
      repo: name,
      fullName: typeof r.full_name === "string" ? r.full_name : `${owner}/${name}`,
      host,
      isPrivate: r.private === true
    });
  }
  return { ok: true, repos };
}
async function searchReposAllHosts(ctx, query) {
  if (!ctx.exec) return { ok: false, error: "exec capability unavailable" };
  const q = String(query ?? "").trim();
  if (!q) return { ok: true, repos: [] };
  const accounts = await getAuthHosts(ctx);
  const hosts = Array.from(new Set(accounts.map((a) => a.host)));
  if (hosts.length === 0) return { ok: true, repos: [] };
  const perHost = await Promise.all(hosts.map((h) => searchRepos(ctx, h, q)));
  const seen = /* @__PURE__ */ new Set();
  const repos = [];
  for (const res of perHost) {
    if (!res.ok || !res.repos) continue;
    for (const r of res.repos) {
      const key = `${r.host}|${r.fullName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(r);
    }
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { ok: true, repos };
}
var REPOS_PAGES_PER_BATCH = 30;
var REPOS_PAGE_WINDOW = 5;
async function listAllRepos(ctx, host, batch) {
  if (!ctx.exec) return { ok: false, error: "exec capability unavailable" };
  const b = Number.isFinite(batch) && batch > 0 ? Math.floor(batch) : 1;
  const PER_PAGE = 100;
  const firstPage = (b - 1) * REPOS_PAGES_PER_BATCH + 1;
  const lastPage = firstPage + REPOS_PAGES_PER_BATCH - 1;
  const repos = [];
  let anyOk = false;
  let hasMore = false;
  let exhausted = false;
  for (let winStart = firstPage; winStart <= lastPage && !exhausted; winStart += REPOS_PAGE_WINDOW) {
    const pages = [];
    for (let pg = winStart; pg < winStart + REPOS_PAGE_WINDOW && pg <= lastPage; pg++) pages.push(pg);
    const results = await Promise.all(
      pages.map(
        (pg) => ghApi(
          ctx,
          host,
          `user/repos?per_page=${PER_PAGE}&page=${pg}&sort=full_name&affiliation=owner,collaborator,organization_member`
        )
      )
    );
    for (let i = 0; i < results.length; i++) {
      const pg = pages[i];
      const data = results[i];
      if (!Array.isArray(data)) {
        if (pg === firstPage) return { ok: false, error: `Could not list repositories on ${host}` };
        exhausted = true;
        break;
      }
      anyOk = true;
      const rows = data;
      for (const r of rows) {
        const owner = r.owner?.login ?? "";
        const name = typeof r.name === "string" ? r.name : "";
        if (!owner || !name) continue;
        repos.push({
          owner,
          repo: name,
          fullName: typeof r.full_name === "string" ? r.full_name : `${owner}/${name}`,
          host,
          isPrivate: r.private === true
        });
      }
      if (rows.length < PER_PAGE) {
        exhausted = true;
        break;
      }
    }
  }
  if (!exhausted && anyOk) hasMore = true;
  const incompleteOwner = hasMore ? repos[repos.length - 1]?.owner : void 0;
  return { ok: anyOk, repos, hasMore, incompleteOwner };
}
async function listReposAllHosts(ctx, batch) {
  if (!ctx.exec) return { ok: false, error: "exec capability unavailable" };
  const accounts = await getAuthHosts(ctx);
  const hosts = Array.from(new Set(accounts.map((a) => a.host)));
  if (hosts.length === 0) return { ok: true, repos: [], hasMore: false, incompleteOwners: [] };
  const perHost = await Promise.all(hosts.map((h) => listAllRepos(ctx, h, batch)));
  const seen = /* @__PURE__ */ new Set();
  const repos = [];
  let hasMore = false;
  const incomplete = /* @__PURE__ */ new Set();
  for (const res of perHost) {
    if (!res.ok || !res.repos) continue;
    if (res.hasMore) hasMore = true;
    if (res.incompleteOwner) incomplete.add(res.incompleteOwner);
    for (const r of res.repos) {
      const key = `${r.host}|${r.fullName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(r);
    }
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { ok: true, repos, hasMore, incompleteOwners: Array.from(incomplete) };
}
async function suggestedRepos(ctx, host, sinceIso) {
  if (!ctx.exec) return { ok: false, error: "exec capability unavailable" };
  const q = `is:pr author:@me updated:>=${sinceIso}`;
  const MAX_PAGES = 5;
  const PER_PAGE = 100;
  const byRepo = /* @__PURE__ */ new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await ghApi(
      ctx,
      host,
      `search/issues?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}&sort=updated`
    );
    if (!data || typeof data !== "object") {
      if (page === 1) return { ok: false, error: `Activity scan failed on ${host}` };
      break;
    }
    const items = data.items;
    if (!Array.isArray(items) || items.length === 0) break;
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const i = it;
      let full = "";
      if (typeof i.repository_url === "string") {
        const m = i.repository_url.match(/\/([^/]+\/[^/]+)$/);
        if (m) full = m[1];
      }
      if (!full) continue;
      const [owner, repo] = full.split("/");
      if (!owner || !repo) continue;
      let ts = 0;
      if (typeof i.updated_at === "string") {
        const d = new Date(i.updated_at);
        if (!isNaN(d.getTime())) ts = d.getTime();
      }
      const prev = byRepo.get(full);
      if (prev) {
        prev.prCount += 1;
        if (ts > prev.lastActivity) prev.lastActivity = ts;
      } else {
        byRepo.set(full, { owner, repo, fullName: full, host, prCount: 1, lastActivity: ts });
      }
    }
    if (items.length < PER_PAGE) break;
  }
  const repos = Array.from(byRepo.values()).sort(
    (a, b) => b.prCount - a.prCount || b.lastActivity - a.lastActivity
  );
  return { ok: true, repos };
}
async function getAuthUser(ctx, host) {
  const data = await ghApi(ctx, host, "user");
  if (!data || typeof data !== "object") return null;
  const u = data;
  if (typeof u.login !== "string" || !u.login) return null;
  const out = { login: u.login };
  if (typeof u.name === "string" && u.name) out.name = u.name;
  if (typeof u.email === "string" && u.email) out.email = u.email;
  if (typeof u.avatar_url === "string" && u.avatar_url) out.avatarUrl = u.avatar_url;
  return out;
}
function classifyGhFault(result) {
  if (!result) return "outage";
  if (result.code === 0) return "ok";
  const text = `${result.stdout ?? ""}
${result.stderr ?? ""}`;
  const lower = text.toLowerCase();
  const statusMatch = text.match(/HTTP\s+(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const rateLimited = /rate limit|rate-limit|secondary rate|abuse detection|api rate/i.test(text);
  const authProblem = /not logged in|gh auth login|bad credentials|requires authentication|401|token/i.test(lower) || /must authenticate|authentication|unauthorized/i.test(lower);
  if (status === 404) return "remote-gone";
  if (status === 401) return "disconnect";
  if (status === 429) return "outage";
  if (status === 403) return rateLimited ? "outage" : "disconnect";
  if (status >= 500 && status < 600) return "outage";
  if (rateLimited) return "outage";
  if (/not logged in|gh auth login/i.test(lower)) return "disconnect";
  return "outage";
}
async function probeRepoFault(ctx, host, owner, repo) {
  if (!ctx.exec) return "outage";
  const full = `${owner}/${repo}`;
  if (!isSafeRepoArg(full)) return "outage";
  const result = await runGh(ctx.exec, ["api", "--hostname", host, "--", `repos/${owner}/${repo}`], ctx.log);
  return classifyGhFault(result);
}
async function testRepoConnection(ctx, host, owner, repo) {
  const full = `${owner}/${repo}`;
  if (!isSafeRepoArg(full)) {
    return { ok: false, error: `Invalid repository: ${full}` };
  }
  const data = await ghApi(ctx, host, `repos/${owner}/${repo}`);
  if (data && typeof data === "object" && "full_name" in data) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `Couldn't reach ${full} on ${host}. Check access, or re-authenticate with: gh auth login ${host}`
  };
}

// lib/sync-health.ts
var REMOTE_GONE_CONFIRM_PASSES = 2;
function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}
function reduceSyncHealth(prev, probes, authDisconnectedHosts) {
  const base = prev ?? EMPTY_SYNC_HEALTH_STATE;
  const prevGone = base.gone404 ?? {};
  const keptSet = new Set((base.kept ?? []).map((n) => n.toLowerCase()));
  const disconnectedHosts = new Set(authDisconnectedHosts);
  for (const p of probes) {
    if (p.fault === "disconnect") disconnectedHosts.add(p.host);
  }
  const nextGone = { ...prevGone };
  const remoteGone = [];
  const hostHasProbe = /* @__PURE__ */ new Map();
  const hostAllOutage = /* @__PURE__ */ new Map();
  for (const p of probes) {
    const name = p.name.toLowerCase();
    if (p.fault === "remote-gone" && !disconnectedHosts.has(p.host)) {
      nextGone[name] = (nextGone[name] ?? 0) + 1;
    } else {
      nextGone[name] = 0;
    }
    if (p.fault === "ok") keptSet.delete(name);
    if (!disconnectedHosts.has(p.host)) {
      hostHasProbe.set(p.host, true);
      const prevAll = hostAllOutage.get(p.host);
      const isOutage = p.fault === "outage";
      hostAllOutage.set(p.host, prevAll === void 0 ? isOutage : prevAll && isOutage);
    }
  }
  for (const [name, count] of Object.entries(nextGone)) {
    if (count >= REMOTE_GONE_CONFIRM_PASSES && !keptSet.has(name)) remoteGone.push(name);
  }
  const outageHosts = [];
  for (const [host, hasProbe] of hostHasProbe) {
    if (hasProbe && hostAllOutage.get(host) === true && !disconnectedHosts.has(host)) {
      outageHosts.push(host);
    }
  }
  const state = {
    gone404: nextGone,
    kept: uniqueSorted(keptSet)
  };
  const health = {
    disconnectedHosts: uniqueSorted(disconnectedHosts),
    outageHosts: uniqueSorted(outageHosts),
    remoteGone: uniqueSorted(remoteGone),
    keptGone: uniqueSorted(keptSet)
  };
  return { state, health };
}
function isKeptGone(state, repoFullName) {
  const kept = new Set((state?.kept ?? []).map((n) => n.toLowerCase()));
  return kept.has((repoFullName ?? "").toLowerCase());
}

// lib/pillState.ts
var FAIL2 = /* @__PURE__ */ new Set(["fail", "failure"]);
var RUNNING2 = /* @__PURE__ */ new Set(["pending", "in_progress", "queued"]);
function normalize2(s) {
  return (s ?? "").toLowerCase().trim() || "pending";
}
function isIgnoredFailingCheck(name, ignored) {
  if (!ignored || ignored.length === 0) return false;
  const n = (name ?? "").toLowerCase();
  return ignored.some((entry) => {
    const e = (entry ?? "").toLowerCase();
    return e.length > 0 && n.includes(e);
  });
}
function isBuildHappy(checks, opts = {}) {
  if (!checks || checks.length === 0) return false;
  const ignored = opts.ignoredFailingChecks;
  for (const c of checks) {
    const st = normalize2(c.bucket || c.state);
    if (RUNNING2.has(st)) return false;
    if (FAIL2.has(st) && !isIgnoredFailingCheck(c.name, ignored)) return false;
  }
  return true;
}

// lib/pr-main.ts
var PRS_KEY = "prs";
var SETTINGS_KEY = "settings";
var DISMISSED_KEY = "dismissedUrls";
var SYNC_HEALTH_KEY = "syncHealth";
var SYNC_HEALTH_PROBE_CAP = 40;
var PR_FETCH_CONCURRENCY = 6;
var DISCOVER_ADD_CAP = 40;
var BULK_URL_CAP = 500;
var FORBIDDEN_URL_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
function isMutablePrKey(prs, url) {
  return !FORBIDDEN_URL_KEYS.has(url) && Object.prototype.hasOwnProperty.call(prs, url);
}
async function mapConcurrent(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (; ; ) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}
var POLL_MIN = 15;
var POLL_MAX = 120;
async function readStorage(ctx, key) {
  return await ctx.storage.get(key);
}
async function readPrs(ctx) {
  const stored = await readStorage(ctx, PRS_KEY);
  return stored && typeof stored === "object" ? stored : {};
}
var prsWriteChain = Promise.resolve();
function withPrsLock(fn) {
  const run = prsWriteChain.then(fn, fn);
  prsWriteChain = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
function overlayUserFields(fresh, current) {
  return {
    ...fresh,
    projectId: current.projectId,
    lastSeenAt: current.lastSeenAt,
    muted: current.muted,
    favorite: current.favorite
  };
}
async function readSettings(ctx) {
  const stored = await readStorage(ctx, SETTINGS_KEY);
  return mergeSettings(stored);
}
async function readDismissed(ctx) {
  const stored = await readStorage(ctx, DISMISSED_KEY);
  return stored && typeof stored === "object" ? stored : {};
}
async function readSyncHealthState(ctx) {
  const stored = await readStorage(ctx, SYNC_HEALTH_KEY);
  if (!stored || typeof stored !== "object") return { ...EMPTY_SYNC_HEALTH_STATE };
  return {
    gone404: stored.gone404 && typeof stored.gone404 === "object" ? stored.gone404 : {},
    kept: Array.isArray(stored.kept) ? stored.kept.filter((n) => typeof n === "string") : []
  };
}
async function runSyncHealthPass(ctx) {
  const settings = await readSettings(ctx);
  const repos = settings.repositories ?? [];
  if (repos.length === 0) return { ...EMPTY_SYNC_HEALTH };
  const conn = await connectionByHost(ctx);
  const authDisconnectedHosts = Array.from(
    new Set(
      repos.filter((r) => (conn[r.host] ?? "disconnected") !== "connected").map((r) => r.host)
    )
  );
  const prev = await readSyncHealthState(ctx);
  const toProbe = repos.filter((r) => r.active).filter((r) => (conn[r.host] ?? "disconnected") === "connected").slice(0, SYNC_HEALTH_PROBE_CAP);
  const probes = await mapConcurrent(toProbe, PR_FETCH_CONCURRENCY, async (r) => {
    const fault = await probeRepoFault(ctx, r.host, r.owner, r.repo);
    return { name: `${r.owner}/${r.repo}`.toLowerCase(), host: r.host, fault };
  });
  const { state, health } = reduceSyncHealth(prev, probes, authDisconnectedHosts);
  await ctx.storage.set(SYNC_HEALTH_KEY, state);
  return health;
}
function mergeSettings(patch) {
  const merged = { ...DEFAULT_PR_MONITOR_SETTINGS, ...patch ?? {} };
  if (!Number.isFinite(merged.pollIntervalMinutes)) {
    merged.pollIntervalMinutes = DEFAULT_PR_MONITOR_SETTINGS.pollIntervalMinutes;
  }
  merged.pollIntervalMinutes = Math.max(POLL_MIN, Math.min(POLL_MAX, Math.round(merged.pollIntervalMinutes)));
  return merged;
}
function findLandedSha(comments) {
  if (!Array.isArray(comments)) return "";
  let sha = "";
  for (const c of comments) {
    if (!c || typeof c !== "object") continue;
    const body = c.body;
    if (typeof body !== "string") continue;
    const m = SYNC_RE.exec(body);
    if (m) sha = m[1];
  }
  return sha;
}
async function probeLanding(ctx, url, baseRefName) {
  const parsed = parsePrUrl(url);
  if (!parsed) return null;
  const { host, owner, repo, number } = parsed;
  const comments = await ghApi(ctx, host, `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
  const sha = findLandedSha(comments);
  const { final, intermediate } = destBranches(baseRefName);
  const probe = {
    landedSha: sha,
    finalBranch: final,
    intermediateBranch: intermediate,
    finalBranchContainsSha: null,
    intermediateBranchContainsSha: null
  };
  if (!sha) return probe;
  if (final) {
    probe.finalBranchContainsSha = await commitContained(ctx, host, owner, repo, sha, final);
  }
  if (intermediate && probe.finalBranchContainsSha !== true) {
    probe.intermediateBranchContainsSha = await commitContained(ctx, host, owner, repo, sha, intermediate);
  }
  return probe;
}
async function commitContained(ctx, host, owner, repo, sha, branch) {
  const data = await ghApi(ctx, host, `repos/${owner}/${repo}/compare/${sha}...${encodeURIComponent(branch)}`);
  if (!data || typeof data !== "object" || !("behind_by" in data)) return null;
  const v = data.behind_by;
  return typeof v === "number" ? v === 0 : null;
}
async function classify(ctx, url, merge, checks) {
  const prState = (merge.state ?? "").toUpperCase();
  if (prState === "MERGED") {
    return computeClosedStatus(merge.state, merge.mergeStateStatus, null);
  }
  if (prState === "CLOSED") {
    const probe = await probeLanding(ctx, url, merge.baseRefName);
    return computeClosedStatus(merge.state, merge.mergeStateStatus, probe);
  }
  return computeStatus(
    { state: merge.state, mergeStateStatus: merge.mergeStateStatus, reviewDecision: merge.reviewDecision },
    merge.mergeable,
    checks
  );
}
async function refreshOne(ctx, prev) {
  const merge = await fetchMergeState(ctx, prev.url);
  let checks = await fetchChecks(ctx, prev.url);
  const prState = (merge.state ?? "").toUpperCase();
  const terminal = prState === "CLOSED" || prState === "MERGED";
  if (checks.length === 0 && !terminal) {
    checks = prev.checks;
  }
  if (checks.length === 0 && terminal) {
    checks = prev.checks;
  }
  const mergeFailed = !merge.state;
  let newStatus = prev.status;
  if (!mergeFailed) {
    newStatus = await classify(ctx, prev.url, merge, checks);
  }
  const now = Date.now();
  const lastStatusChange = newStatus !== prev.status ? now : prev.lastStatusChange;
  const title = mergeFailed ? prev.title : merge.title || prev.title;
  const baseRefName = mergeFailed ? prev.baseRefName : merge.baseRefName || prev.baseRefName;
  const mergeable = mergeFailed ? prev.mergeable : merge.mergeable || prev.mergeable;
  const mergeStateStatus = mergeFailed ? prev.mergeStateStatus : merge.mergeStateStatus || prev.mergeStateStatus;
  const headRefName = mergeFailed ? prev.headRefName : merge.headRefName || prev.headRefName;
  const author = mergeFailed ? prev.author : merge.author || prev.author;
  const isDraft = mergeFailed ? prev.isDraft : merge.isDraft ?? prev.isDraft;
  const body = mergeFailed ? prev.body : merge.body || prev.body;
  const createdAt = mergeFailed ? prev.createdAt : merge.createdAt || prev.createdAt;
  const updatedAt = mergeFailed ? prev.updatedAt : merge.updatedAt || prev.updatedAt;
  const reviewers = mergeFailed ? prev.reviewers : merge.reviewers;
  const workItem = extractWorkItem(title, headRefName, body);
  const settings = await readSettings(ctx);
  const repoRec = (settings.repositories ?? []).find(
    (r) => `${r.owner}/${r.repo}`.toLowerCase() === (prev.repo ?? "").toLowerCase()
  );
  const ignoredFailingChecks = repoRec?.ignoredFailingChecks ?? [];
  const sfciGated = repoRec?.sfciGated === true;
  const buildHappy = isBuildHappy(checks, { ignoredFailingChecks });
  const reviewDecision = mergeFailed ? prev.reviewDecision : merge.reviewDecision || prev.reviewDecision;
  let hasSfciJob = prev.hasSfciJob ?? false;
  if (sfciGated && !terminal && !mergeFailed) {
    const parsed = parsePrUrl(prev.url);
    if (parsed) {
      try {
        const comments = await ghApi(
          ctx,
          parsed.host,
          `repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments?per_page=100`
        );
        hasSfciJob = hasSfciJobComment(comments);
      } catch (err) {
        ctx.log(`SFCI comment fetch failed for ${prev.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  let reviewClockStartedAt = prev.reviewClockStartedAt;
  if (!mergeFailed) {
    if (isDraft) {
      reviewClockStartedAt = void 0;
    } else if (prev.isDraft === true) {
      reviewClockStartedAt = now;
    } else if (prev.reviewClockStartedAt) {
      reviewClockStartedAt = prev.reviewClockStartedAt;
    } else {
      reviewClockStartedAt = createdAt || now;
    }
  }
  return {
    url: prev.url,
    repo: prev.repo,
    number: prev.number,
    title,
    baseRefName,
    status: newStatus,
    mergeable,
    mergeStateStatus,
    checks,
    addedAt: prev.addedAt,
    lastChecked: now,
    lastStatusChange,
    lastSeenAt: prev.lastSeenAt,
    // Carry the manual project assignment forward — refreshOne rebuilds the PR
    // object from the gh poll, so anything not explicitly copied here is lost on
    // the next poll. Dropping projectId silently wiped a user's assignment within
    // one poll interval (looked like "selecting a project doesn't stick").
    projectId: prev.projectId,
    // Phase 1 fields — MUST be copied or wiped (Risk #1)
    headRefName,
    author,
    isDraft,
    body,
    createdAt,
    updatedAt,
    workItem,
    reviewers,
    // source + discoveredVia carry forward (auto PRs need these; manual PRs have source='manual' or undefined→'manual')
    source: prev.source,
    discoveredVia: prev.discoveredVia,
    // Per-PR mute carries forward untouched (R-LIST-018).
    muted: prev.muted,
    // Per-PR favorite carries forward untouched (R-LIST-026) — a user-owned field
    // (R-CORE-004); drop it here and a poll would wipe the mark.
    favorite: prev.favorite,
    // Per-PR fetch-error (R-LIST-023): a failed merge fetch marks THIS PR's row
    // as not-syncable and keeps its last-known state stale; a success clears it
    // and stamps lastSyncOk. (App-level disconnect is a separate signal — R-REPO-013.)
    syncError: mergeFailed ? "Could not sync this PR from GitHub." : void 0,
    lastSyncOk: mergeFailed ? prev.lastSyncOk : now,
    // Two-pill overlay fields — advisory, cached each poll (Risk #1: copy or wipe).
    reviewClockStartedAt,
    reviewDecision,
    buildHappy,
    hasSfciJob
  };
}
async function discoverPrs(ctx) {
  const settings = await readSettings(ctx);
  const accounts = await getAuthHosts(ctx);
  if (accounts.length === 0) {
    ctx.log("discoverPrs: no authenticated gh accounts \u2014 skipping discovery");
    return;
  }
  const enabled = settings.discoverHosts;
  const searchAccounts = enabled === void 0 ? accounts : accounts.filter((a) => enabled.includes(a.host));
  if (searchAccounts.length === 0) {
    ctx.log("discoverPrs: no enabled accounts \u2014 skipping discovery");
    return;
  }
  const dismissed = await readDismissed(ctx);
  const existing = await readPrs(ctx);
  const discovered = /* @__PURE__ */ new Map();
  for (const account of searchAccounts) {
    const { host, login } = account;
    const result = await searchPrs(ctx, host, login, "authored", settings.watchedRepos);
    if (!result.ok) {
      ctx.log(`discoverPrs: searchPrs(${host}, ${login}, authored) failed: ${result.error}`);
      continue;
    }
    for (const pr of result.prs ?? []) {
      const via = `authored:${login}@${host}`;
      if (!discovered.has(pr.url)) {
        discovered.set(pr.url, { ...pr, discoveredVia: via });
      }
    }
  }
  const now = Date.now();
  const gate = await repoSyncGate(ctx);
  const candidates = [];
  for (const [url, pr] of discovered) {
    if (url in dismissed) continue;
    if (url in existing) continue;
    const repoName = pr.repo || repoOf(url);
    if (!gate(repoName)) continue;
    candidates.push({ url, pr });
  }
  if (candidates.length > DISCOVER_ADD_CAP) {
    ctx.log(`discoverPrs: ${candidates.length} new candidates, capping to ${DISCOVER_ADD_CAP} this pass`);
    candidates.length = DISCOVER_ADD_CAP;
  }
  const toAdd = {};
  await mapConcurrent(candidates, PR_FETCH_CONCURRENCY, async ({ url, pr }) => {
    try {
      const merge = await fetchMergeState(ctx, url);
      const checks = await fetchChecks(ctx, url);
      const status = await classify(ctx, url, merge, checks);
      const title = merge.title || pr.title;
      const workItem = extractWorkItem(title, merge.headRefName, merge.body);
      toAdd[url] = {
        url,
        repo: pr.repo || repoOf(url),
        number: pr.number || prNumber(url),
        title,
        baseRefName: merge.baseRefName || "",
        status,
        mergeable: merge.mergeable || "",
        mergeStateStatus: merge.mergeStateStatus || "",
        checks,
        addedAt: now,
        lastChecked: now,
        lastStatusChange: now,
        headRefName: merge.headRefName,
        author: merge.author ?? (pr.author ? { login: pr.author.login } : void 0),
        isDraft: merge.isDraft ?? pr.isDraft,
        body: merge.body,
        createdAt: merge.createdAt,
        updatedAt: merge.updatedAt,
        workItem,
        reviewers: merge.reviewers,
        source: "auto",
        discoveredVia: pr.discoveredVia
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      ctx.log(`discoverPrs: failed to add ${url}: ${detail}`);
    }
  });
  if (Object.keys(toAdd).length === 0) return;
  await withPrsLock(async () => {
    const current = await readPrs(ctx);
    const dismissedNow = await readDismissed(ctx);
    let added = 0;
    for (const [url, newPr] of Object.entries(toAdd)) {
      if (url in current) continue;
      if (url in dismissedNow) continue;
      current[url] = newPr;
      added++;
    }
    if (added > 0) {
      await ctx.storage.set(PRS_KEY, current);
      ctx.log(`discoverPrs: added ${added} auto PRs`);
    }
  });
}
async function pruneDismissed(ctx) {
  const dismissed = await readDismissed(ctx);
  const entries = Object.entries(dismissed).sort((a, b) => b[1] - a[1]);
  const CAP = 500;
  const pruned = {};
  for (const [url, dismissedAt] of entries.slice(0, CAP)) {
    pruned[url] = dismissedAt;
  }
  if (Object.keys(pruned).length !== Object.keys(dismissed).length) {
    await ctx.storage.set(DISMISSED_KEY, pruned);
    ctx.log(`pruneDismissed: capped to ${Object.keys(pruned).length} (was ${Object.keys(dismissed).length})`);
  }
}
function shortHost(host) {
  return host.endsWith(".salesforce.com") ? host.slice(0, -".salesforce.com".length) : host;
}
async function discoverOrgs(ctx, force) {
  const settings = await readSettings(ctx);
  if (settings.orgDiscovered && !force) return settings;
  const accounts = await getAuthHosts(ctx);
  const orgs = accounts.map((a) => ({
    host: a.host,
    login: a.login,
    apiBaseUrl: a.apiBaseUrl
  }));
  let merged;
  if (force) {
    const byKey = /* @__PURE__ */ new Map();
    for (const o of settings.organizations ?? []) byKey.set(`${o.host}|${o.login}`, o);
    for (const o of orgs) byKey.set(`${o.host}|${o.login}`, o);
    merged = Array.from(byKey.values());
  } else {
    merged = orgs;
  }
  const next = mergeSettings({ ...settings, organizations: merged, orgDiscovered: true });
  await ctx.storage.set(SETTINGS_KEY, next);
  return next;
}
async function discoverAuthor(ctx, force) {
  const settings = await readSettings(ctx);
  if (settings.authorDiscovered && !force && settings.author) return settings.author;
  const accounts = await getAuthHosts(ctx);
  if (accounts.length === 0) {
    if (!settings.authorDiscovered) {
      await ctx.storage.set(SETTINGS_KEY, mergeSettings({ ...settings, authorDiscovered: true }));
    }
    return settings.author;
  }
  const primary = accounts.find((a) => a.active) ?? accounts[0];
  const profile = await getAuthUser(ctx, primary.host) ?? { login: primary.login };
  const author = {
    login: profile.login,
    name: profile.name,
    email: profile.email,
    identities: accounts.map((a) => ({ host: a.host, login: a.login }))
  };
  await ctx.storage.set(SETTINGS_KEY, mergeSettings({ ...settings, author, authorDiscovered: true }));
  return author;
}
async function connectionByHost(ctx) {
  const accounts = await getAuthHosts(ctx);
  const connected = new Set(accounts.map((a) => a.host));
  const settings = await readSettings(ctx);
  const out = {};
  for (const o of settings.organizations ?? []) {
    out[o.host] = connected.has(o.host) ? "connected" : "disconnected";
  }
  for (const r of settings.repositories ?? []) {
    if (!(r.host in out)) out[r.host] = connected.has(r.host) ? "connected" : "disconnected";
  }
  return out;
}
async function rejectUnknownHost(ctx, host) {
  const settings = await readSettings(ctx);
  const configured = /* @__PURE__ */ new Set();
  for (const o of settings.organizations ?? []) configured.add(o.host);
  for (const r of settings.repositories ?? []) configured.add(r.host);
  if (!configured.has(host)) return "That host is not configured.";
  const conn = await connectionByHost(ctx);
  if ((conn[host] ?? "disconnected") !== "connected") {
    return "That host is not connected.";
  }
  return null;
}
async function repoSyncGate(ctx) {
  const settings = await readSettings(ctx);
  const conn = await connectionByHost(ctx);
  const health = await readSyncHealthState(ctx);
  const byName = /* @__PURE__ */ new Map();
  for (const r of settings.repositories ?? []) {
    byName.set(`${r.owner}/${r.repo}`.toLowerCase(), r);
  }
  return (repoFullName) => {
    const rec = byName.get(String(repoFullName ?? "").toLowerCase());
    if (!rec) return true;
    if (!rec.active) return false;
    if (isKeptGone(health, repoFullName)) return false;
    return (conn[rec.host] ?? "disconnected") === "connected";
  };
}
function parseRepoRef(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const url = s.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (url) return sanitizeOwnerRepo(url[1], url[2]);
  const ssh = s.match(/^[^@]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return sanitizeOwnerRepo(ssh[1], ssh[2]);
  const bare = s.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (bare) return sanitizeOwnerRepo(bare[1], bare[2]);
  return null;
}
function sanitizeOwnerRepo(owner, repo) {
  const full = `${owner}/${repo}`;
  return isSafeRepoArg(full) ? { owner, repo } : null;
}
async function addRepo(ctx, owner, repo, host, orgLogin) {
  const settings = await readSettings(ctx);
  const repos = settings.repositories ?? [];
  const dup = repos.some(
    (r) => r.host === host && r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase()
  );
  if (dup) return { ok: false, error: "This repository is already connected." };
  const entry = {
    owner,
    repo,
    host,
    orgLogin,
    active: true,
    buildTisPreset: DEFAULT_TIS_PRESET,
    reviewTisPreset: DEFAULT_REVIEW_TIS_PRESET,
    sfciGated: false,
    ignoredFailingChecks: [],
    createdAt: Date.now(),
    notifyInApp: true
  };
  const next = mergeSettings({ ...settings, repositories: [...repos, entry] });
  await ctx.storage.set(SETTINGS_KEY, next);
  return { ok: true, settings: next };
}
async function removePrsForRepo(ctx, fullName) {
  await withPrsLock(async () => {
    const prs = await readPrs(ctx);
    const needle = fullName.toLowerCase();
    let changed = false;
    for (const url of Object.keys(prs)) {
      if (prs[url].repo.toLowerCase() === needle) {
        delete prs[url];
        changed = true;
      }
    }
    if (changed) await ctx.storage.set(PRS_KEY, prs);
  });
}
async function addPrByUrl(ctx, url) {
  try {
    if (typeof url !== "string" || !url.trim()) {
      return { ok: false, error: "Missing PR URL" };
    }
    const cleanUrl = url.trim();
    const repo = repoOf(cleanUrl);
    const number = prNumber(cleanUrl);
    const existing = await readPrs(ctx);
    if (existing[cleanUrl]) {
      return { ok: false, error: `Already monitoring: ${cleanUrl}` };
    }
    const merge = await fetchMergeState(ctx, cleanUrl);
    const checks = await fetchChecks(ctx, cleanUrl);
    const status = await classify(ctx, cleanUrl, merge, checks);
    const now = Date.now();
    const title = merge.title || "";
    const workItem = extractWorkItem(title, merge.headRefName, merge.body);
    const pr = {
      url: cleanUrl,
      repo,
      number,
      title,
      baseRefName: merge.baseRefName || "",
      status,
      mergeable: merge.mergeable || "",
      mergeStateStatus: merge.mergeStateStatus || "",
      checks,
      addedAt: now,
      lastChecked: now,
      lastStatusChange: now,
      // Phase 1 additions (tile redesign)
      headRefName: merge.headRefName,
      author: merge.author ?? void 0,
      isDraft: merge.isDraft,
      body: merge.body,
      createdAt: merge.createdAt,
      updatedAt: merge.updatedAt,
      workItem,
      reviewers: merge.reviewers,
      source: "manual"
      // manually-added PRs always 'manual'; auto PRs come via Phase 3 discoverPrs
    };
    return await withPrsLock(async () => {
      const current = await readPrs(ctx);
      if (current[cleanUrl]) {
        return { ok: false, error: `Already monitoring: ${cleanUrl}` };
      }
      current[cleanUrl] = pr;
      await ctx.storage.set(PRS_KEY, current);
      const prs = Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
      return { ok: true, prs };
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
var prMonitorMainModule = {
  id: "pr-monitor",
  setup(ctx) {
    if (!ctx.exec) {
      throw new Error("pr-monitor: brokered exec capability is unavailable; cannot run the gh CLI.");
    }
    return {
      /**
       * Pull a specific PR by repository + number (R-LIST-003). Builds the PR URL
       * from the connected repo's host + owner/repo + number, then delegates to the
       * same fetch/persist path as {@link addPrByUrl} (source stays 'manual', AC-LIST-3.4).
       * The repo MUST be one of the connected + active repositories (AC-LIST-3.3) —
       * the renderer's dropdown lists exactly those, and main re-validates here since
       * the renderer is untrusted.
       */
      async pullPr(params) {
        try {
          const host = String(params?.host ?? "").trim();
          const fullName = String(params?.fullName ?? "").trim();
          const num = Math.floor(Number(params?.number));
          if (!host || !fullName) return { ok: false, error: "Please select a repository." };
          if (!Number.isFinite(num) || num <= 0) {
            return { ok: false, error: "Enter a valid PR number." };
          }
          if (!isSafeRepoArg(fullName)) {
            return { ok: false, error: `Invalid repository: ${fullName}` };
          }
          const settings = await readSettings(ctx);
          const match = (settings.repositories ?? []).find(
            (r) => r.active && r.host === host && `${r.owner}/${r.repo}`.toLowerCase() === fullName.toLowerCase()
          );
          if (!match) {
            return { ok: false, error: "That repository is not connected and active." };
          }
          const conn = await connectionByHost(ctx);
          if ((conn[match.host] ?? "disconnected") !== "connected") {
            return { ok: false, error: "That repository is not connected and active." };
          }
          const url = `https://${host}/${match.owner}/${match.repo}/pull/${num}`;
          return await addPrByUrl(ctx, url);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Remove a PR from the watch list and return the updated list.
       */
      async removePr(url) {
        const cleanUrl = (url ?? "").trim();
        if (!cleanUrl) return { ok: true, prs: [] };
        return await withPrsLock(async () => {
          const existing = await readPrs(ctx);
          if (!(cleanUrl in existing)) {
            const prs2 = Object.values(existing).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prs2 };
          }
          delete existing[cleanUrl];
          await ctx.storage.set(PRS_KEY, existing);
          const prs = Object.values(existing).sort((a, b) => a.addedAt - b.addedAt);
          return { ok: true, prs };
        });
      },
      /** Return the full tracked list (stable order by addedAt asc). */
      async listPrs() {
        const prs = await readPrs(ctx);
        return Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
      },
      /**
       * Refresh every tracked PR and persist the result. Returns the full PR list
       * plus deltas for status changes, wrapped in a response envelope.
       *
       * **Unified sync (§5.5):** (1) discoverPrs() — author-driven, adds the
       * authenticated user's own open authored PRs (R-CORE-001 / AC-CORE-1.1);
       * (2) refreshOne for every tracked PR (existing, keep status-change detection exactly);
       * (3) prune terminal/dismissed per settings + caps. One pollIntervalMinutes drives both.
      */
      async pollAll() {
        try {
          let health = { ...EMPTY_SYNC_HEALTH };
          try {
            health = await runSyncHealthPass(ctx);
          } catch (err) {
            ctx.log(`sync-health pass failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          await discoverPrs(ctx);
          const snapshot = await readPrs(ctx);
          const deltas = [];
          const fetched = {};
          const gate = await repoSyncGate(ctx);
          const toRefresh = Object.keys(snapshot).filter((url) => {
            const prev = snapshot[url];
            if (prev.status === "closed-merged" || prev.status === "closed-abandoned") return false;
            return gate(prev.repo);
          });
          await mapConcurrent(toRefresh, PR_FETCH_CONCURRENCY, async (url) => {
            try {
              fetched[url] = await refreshOne(ctx, snapshot[url]);
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              ctx.log(`refresh failed for ${url}: ${detail}`);
            }
          });
          const prsList = await withPrsLock(async () => {
            const current = await readPrs(ctx);
            for (const [url, next] of Object.entries(fetched)) {
              const live = current[url];
              if (!live) continue;
              const merged = overlayUserFields(next, live);
              current[url] = merged;
              if (merged.status !== (snapshot[url]?.status ?? merged.status)) {
                deltas.push({ url, oldStatus: snapshot[url].status, newStatus: merged.status, pr: merged });
              }
            }
            await ctx.storage.set(PRS_KEY, current);
            return Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
          });
          await pruneDismissed(ctx);
          return { ok: true, prs: prsList, deltas, health };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },
      /**
       * On-demand sync of a specific repository selection (AC-LIST-2.5 — the
       * Sync & Filter picker's narrowed "Sync" action). Re-checks exactly the
       * monitored PRs whose `repo` (owner/repo) is in `repos`, skipping terminal
       * PRs like {@link pollAll}. Unlike pollAll it does NOT run account-wide
       * discovery — a repo-scoped sync re-checks what's already tracked in those
       * repos, it isn't a discovery pass. An empty/absent `repos` is a no-op that
       * returns the current list unchanged.
       */
      async syncRepos(params) {
        try {
          const wanted = new Set(
            (Array.isArray(params?.repos) ? params.repos : []).map((r) => String(r ?? "").trim().toLowerCase()).filter(Boolean)
          );
          const snapshot = await readPrs(ctx);
          const deltas = [];
          const fetched = {};
          if (wanted.size > 0) {
            for (const url of Object.keys(snapshot)) {
              const prev = snapshot[url];
              if (!wanted.has(prev.repo.toLowerCase())) continue;
              if (prev.status === "closed-merged" || prev.status === "closed-abandoned") continue;
              try {
                fetched[url] = await refreshOne(ctx, prev);
              } catch (err) {
                ctx.log(`sync failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
          const prsList = await withPrsLock(async () => {
            const current = await readPrs(ctx);
            for (const [url, next] of Object.entries(fetched)) {
              const live = current[url];
              if (!live) continue;
              const merged = overlayUserFields(next, live);
              current[url] = merged;
              if (merged.status !== snapshot[url].status) {
                deltas.push({ url, oldStatus: snapshot[url].status, newStatus: merged.status, pr: merged });
              }
            }
            if (Object.keys(fetched).length > 0) await ctx.storage.set(PRS_KEY, current);
            return Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
          });
          return { ok: true, prs: prsList, deltas };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Assign a PR to a project (or clear the assignment with null).
       */
      async assignProject(url, projectId) {
        const cleanUrl = (url ?? "").trim();
        if (!cleanUrl) return { ok: false };
        return await withPrsLock(async () => {
          const prs = await readPrs(ctx);
          if (!(cleanUrl in prs)) return { ok: false };
          prs[cleanUrl].projectId = projectId ?? void 0;
          await ctx.storage.set(PRS_KEY, prs);
          const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
          return { ok: true, prs: prsList };
        });
      },
      /**
       * Mark a PR as seen by updating its lastSeenAt timestamp to now.
       */
      async markPrAsSeen(params) {
        try {
          const cleanUrl = (params?.url ?? "").trim();
          if (!cleanUrl) {
            return { ok: false, error: "Missing PR URL" };
          }
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!(cleanUrl in prs)) {
              return { ok: false, error: `PR not found: ${cleanUrl}` };
            }
            prs[cleanUrl].lastSeenAt = Date.now();
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },
      /**
       * Mark a PR as unseen with an explicit sentinel. Clearing the timestamp would
       * fall back to addedAt, leaving a never-changed PR read when both timestamps
       * match.
       */
      async markPrAsUnseen(params) {
        try {
          const cleanUrl = (params?.url ?? "").trim();
          if (!cleanUrl) {
            return { ok: false, error: "Missing PR URL" };
          }
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!(cleanUrl in prs)) {
              return { ok: false, error: `PR not found: ${cleanUrl}` };
            }
            prs[cleanUrl].lastSeenAt = 0;
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },
      /**
       * Bulk mark-seen / mark-unseen (R-LIST-010, AC-LIST-10.3). Sets or clears
       * lastSeenAt for every URL in the batch in one storage write. Unknown URLs
       * are skipped. `seen: true` → mark read (lastSeenAt = now); `false` →
       * explicitly unread (lastSeenAt = 0).
       */
      async setPrsSeen(params) {
        try {
          const urls = Array.isArray(params?.urls) ? params.urls : [];
          const seen = !!params?.seen;
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            const now = Date.now();
            for (const raw of urls) {
              const url = String(raw ?? "").trim();
              if (url && prs[url]) prs[url].lastSeenAt = seen ? now : 0;
            }
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Bulk dismiss (R-LIST-004 Sweep / R-LIST-006 bulk bar). Removes every URL in
       * the batch from the list; an auto-discovered PR is additionally added to the
       * dismissed set so re-discovery skips it, a manual PR is simply removed
       * (AC-LIST-4.4). One storage write for the list + one for the dismissed set.
       */
      async dismissPrs(params) {
        try {
          const urls = Array.isArray(params?.urls) ? params.urls : [];
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            const dismissed = await readDismissed(ctx);
            const now = Date.now();
            let dismissedChanged = false;
            for (const raw of urls) {
              const url = String(raw ?? "").trim();
              const pr = url ? prs[url] : void 0;
              if (!pr) continue;
              const isAuto = pr.source === "auto";
              delete prs[url];
              if (isAuto) {
                dismissed[url] = now;
                dismissedChanged = true;
              }
            }
            await ctx.storage.set(PRS_KEY, prs);
            if (dismissedChanged) await ctx.storage.set(DISMISSED_KEY, dismissed);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Dismiss a PR (Phase 3). If source==='auto' → remove from prs AND add to
       * dismissedUrls (so rediscovery skips). If source==='manual' or missing → just
       * removePr (delete, NOT added to dismissed). Returns updated PR list.
       */
      async dismissPr(params) {
        try {
          const cleanUrl = (params?.url ?? "").trim();
          if (!cleanUrl) {
            return { ok: false, error: "Missing PR URL" };
          }
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            const pr = prs[cleanUrl];
            if (!pr) {
              return { ok: false, error: `PR not found: ${cleanUrl}` };
            }
            const isAuto = pr.source === "auto";
            delete prs[cleanUrl];
            await ctx.storage.set(PRS_KEY, prs);
            if (isAuto) {
              const dismissed = await readDismissed(ctx);
              dismissed[cleanUrl] = Date.now();
              await ctx.storage.set(DISMISSED_KEY, dismissed);
            }
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },
      /**
       * Toggle a PR's per-PR mute (R-LIST-018). A muted PR stays in the list but
       * generates no notifications regardless of global/per-repo switches. The URL
       * must be an OWN key of the prs map — a prototype-chain trap (`__proto__` etc.)
       * is rejected, so a crafted URL can't pollute the prototype.
       */
      async setPrMuted(params) {
        try {
          const cleanUrl = (params?.url ?? "").trim();
          if (!cleanUrl) return { ok: false, error: "Missing PR URL" };
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!isMutablePrKey(prs, cleanUrl)) return { ok: false, error: `PR not found: ${cleanUrl}` };
            prs[cleanUrl].muted = !!params.muted;
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Toggle a PR's per-PR favorite (R-LIST-026). A find-faster marker: surfaces
       * the row (star + tint) and drives the "Favorites first" sort. Independent of
       * mute/seen/project and does NOT change polling/sync. The URL must be an OWN
       * key of the prs map — a prototype-chain trap (`__proto__` etc.) is rejected,
       * so a crafted URL can't pollute the prototype.
       */
      async setPrFavorite(params) {
        try {
          const cleanUrl = (params?.url ?? "").trim();
          if (!cleanUrl) return { ok: false, error: "Missing PR URL" };
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!isMutablePrKey(prs, cleanUrl)) return { ok: false, error: `PR not found: ${cleanUrl}` };
            prs[cleanUrl].favorite = !!params.favorite;
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Bulk favorite / unfavorite (R-LIST-026, DR-2). Sets or clears `favorite`
       * for every URL in the batch in ONE storage write. Unknown URLs and
       * prototype-chain traps are skipped; the batch is capped at BULK_URL_CAP
       * (Rule 5) so a runaway renderer selection can't unbound the write.
       */
      async setPrsFavorite(params) {
        try {
          const urls = Array.isArray(params?.urls) ? params.urls.slice(0, BULK_URL_CAP) : [];
          const favorite = !!params?.favorite;
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            for (const raw of urls) {
              const url = String(raw ?? "").trim();
              if (url && isMutablePrKey(prs, url)) prs[url].favorite = favorite;
            }
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Re-fetch a single PR on demand (R-LIST-023 retry). Clears its syncError on
       * success. Bypasses the terminal-skip in pollAll — the user asked for THIS PR.
       */
      async retryPr(params) {
        try {
          const cleanUrl = (params?.url ?? "").trim();
          if (!cleanUrl) return { ok: false, error: "Missing PR URL" };
          const snapshot = await readPrs(ctx);
          const prev = snapshot[cleanUrl];
          if (!prev) return { ok: false, error: `PR not found: ${cleanUrl}` };
          const next = await refreshOne(ctx, prev);
          return await withPrsLock(async () => {
            const current = await readPrs(ctx);
            const live = current[cleanUrl];
            if (!live) return { ok: false, error: `PR not found: ${cleanUrl}` };
            current[cleanUrl] = overlayUserFields(next, live);
            await ctx.storage.set(PRS_KEY, current);
            const prsList = Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      // --- Organizations (R-ORG-*) ---
      /**
       * List monitored orgs with derived short-host + live connection state
       * (R-ORG-003/005). Seeds once-ever from `gh` accounts on first call
       * (R-ORG-002 anti-loop, gated by orgDiscovered).
       */
      async listOrgs() {
        try {
          const settings = await discoverOrgs(ctx, false);
          const conn = await connectionByHost(ctx);
          const orgs = (settings.organizations ?? []).map((o) => ({
            ...o,
            shortHost: shortHost(o.host),
            connection: conn[o.host] ?? "disconnected"
          }));
          return { ok: true, orgs };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /** Re-discover orgs from gh accounts (R-ORG-004). Explicit user action. */
      async rediscoverOrgs() {
        try {
          invalidateAuthHosts();
          await discoverOrgs(ctx, true);
          await discoverAuthor(ctx, true);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Delete an org (R-ORG-006): removes the org, its repos, and those repos'
       * PRs from PR Monitor. Leaves gh creds untouched. Identified by host+login.
       */
      async deleteOrg(params) {
        try {
          const host = String(params?.host ?? "").trim();
          const login = String(params?.login ?? "").trim();
          if (!host || !login) return { ok: false, error: "Missing org identity" };
          const settings = await readSettings(ctx);
          const orgs = (settings.organizations ?? []).filter((o) => !(o.host === host && o.login === login));
          const keptRepos = [];
          for (const r of settings.repositories ?? []) {
            if (r.host === host && r.orgLogin === login) {
              await removePrsForRepo(ctx, `${r.owner}/${r.repo}`);
            } else {
              keptRepos.push(r);
            }
          }
          const next = mergeSettings({ ...settings, organizations: orgs, repositories: keptRepos });
          await ctx.storage.set(SETTINGS_KEY, next);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      // --- Repositories (R-REPO-*) ---
      /** List connected repos with short-host + connection state (R-REPO-001). */
      async listRepos() {
        try {
          const settings = await readSettings(ctx);
          const conn = await connectionByHost(ctx);
          const repos = (settings.repositories ?? []).map((r) => ({
            ...r,
            shortHost: shortHost(r.host),
            connection: conn[r.host] ?? "disconnected"
          }));
          return { ok: true, repos };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Add a repository manually (R-REPO-008). `ref` accepts owner/repo, a full
       * URL, or an SSH clone URL; `host` + `orgLogin` come from the org dropdown.
       */
      async addRepository(params) {
        try {
          const host = String(params?.host ?? "").trim();
          const orgLogin = String(params?.orgLogin ?? "").trim();
          if (!host || !orgLogin) return { ok: false, error: "Please select an organization." };
          const parsed = parseRepoRef(params?.ref ?? "");
          if (!parsed) {
            const raw = String(params?.ref ?? "").trim();
            if (raw && !raw.includes("/")) {
              return { ok: false, error: "Please include the owner \u2014 e.g., your-org/repo-name." };
            }
            return { ok: false, error: "Invalid repository. Enter owner/repo or a full GitHub URL." };
          }
          return await addRepo(ctx, parsed.owner, parsed.repo, host, orgLogin);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Add a batch of already-identified repos (from Suggested/Browse selection).
       * Each is `{owner, repo, host, orgLogin}`; duplicates are silently skipped.
       */
      async addRepositories(params) {
        try {
          const list = Array.isArray(params?.repos) ? params.repos : [];
          let added = 0;
          let settings;
          for (const r of list) {
            const parsed = sanitizeOwnerRepo(r.owner, r.repo);
            if (!parsed || !r.host || !r.orgLogin) continue;
            const res = await addRepo(ctx, parsed.owner, parsed.repo, r.host, r.orgLogin);
            if (res.ok) {
              added++;
              settings = res.settings;
            }
          }
          if (!settings) settings = await readSettings(ctx);
          return { ok: true, added, settings };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Update a repo's settings (R-REPO-011): repository ref, org, active flag,
       * TIS preset, and per-repo in-app notifications. Toggling active OFF removes
       * that repo's PRs (user-initiated — R-REPO-011 note). Identified by the
       * ORIGINAL host+owner+repo (`key`), so the ref itself can change.
       */
      async updateRepository(params) {
        try {
          const k = params?.key;
          if (!k?.host || !k?.owner || !k?.repo) return { ok: false, error: "Missing repository key" };
          const settings = await readSettings(ctx);
          const repos = [...settings.repositories ?? []];
          const idx = repos.findIndex(
            (r) => r.host === k.host && r.owner === k.owner && r.repo === k.repo
          );
          if (idx < 0) return { ok: false, error: "Repository not found" };
          const cur = repos[idx];
          const next = { ...cur };
          if (typeof params.ref === "string" && params.ref.trim()) {
            const parsed = parseRepoRef(params.ref);
            if (!parsed) return { ok: false, error: "Invalid repository. Enter owner/repo or a full GitHub URL." };
            next.owner = parsed.owner;
            next.repo = parsed.repo;
          }
          if (typeof params.orgLogin === "string" && params.orgLogin.trim()) {
            next.orgLogin = params.orgLogin.trim();
          }
          const buildPreset = params.buildTisPreset ?? params.tisPreset;
          if (typeof buildPreset === "string" && buildPreset in TIS_PRESETS) {
            next.buildTisPreset = buildPreset;
            next.tisPreset = void 0;
          }
          if (typeof params.reviewTisPreset === "string" && params.reviewTisPreset in TIS_PRESETS) {
            next.reviewTisPreset = params.reviewTisPreset;
          }
          if (typeof params.sfciGated === "boolean") next.sfciGated = params.sfciGated;
          if (Array.isArray(params.ignoredFailingChecks)) {
            next.ignoredFailingChecks = Array.from(
              new Set(params.ignoredFailingChecks.filter((s) => typeof s === "string" && s.trim().length > 0))
            );
          }
          if (typeof params.notifyInApp === "boolean") next.notifyInApp = params.notifyInApp;
          const wasActive = cur.active;
          if (typeof params.active === "boolean") next.active = params.active;
          repos[idx] = next;
          const merged = mergeSettings({ ...settings, repositories: repos });
          await ctx.storage.set(SETTINGS_KEY, merged);
          if (wasActive && next.active === false) {
            await removePrsForRepo(ctx, `${cur.owner}/${cur.repo}`);
            return { ok: true, settings: merged };
          }
          const gatedChanged = next.sfciGated !== cur.sfciGated;
          const ignoredChanged = JSON.stringify(next.ignoredFailingChecks ?? []) !== JSON.stringify(cur.ignoredFailingChecks ?? []);
          if (next.active !== false && (gatedChanged || ignoredChanged)) {
            const repoKey = `${next.owner}/${next.repo}`.toLowerCase();
            const snapshot = await readPrs(ctx);
            const fetched = {};
            for (const url of Object.keys(snapshot)) {
              const prev = snapshot[url];
              if (prev.repo.toLowerCase() !== repoKey) continue;
              if (prev.status === "closed-merged" || prev.status === "closed-abandoned") continue;
              try {
                fetched[url] = await refreshOne(ctx, prev);
              } catch (err) {
                ctx.log(`updateRepository refresh failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            if (Object.keys(fetched).length > 0) {
              const prsList = await withPrsLock(async () => {
                const current = await readPrs(ctx);
                for (const [url, fresh] of Object.entries(fetched)) {
                  const live = current[url];
                  if (!live) continue;
                  current[url] = overlayUserFields(fresh, live);
                }
                await ctx.storage.set(PRS_KEY, current);
                return Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
              });
              return { ok: true, settings: merged, prs: prsList };
            }
          }
          return { ok: true, settings: merged };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /** Delete a repository (R-REPO-011) and its monitored PRs. */
      async deleteRepository(params) {
        try {
          const { host, owner, repo } = params ?? {};
          if (!host || !owner || !repo) return { ok: false, error: "Missing repository key" };
          const settings = await readSettings(ctx);
          const repos = (settings.repositories ?? []).filter(
            (r) => !(r.host === host && r.owner === owner && r.repo === repo)
          );
          const next = mergeSettings({ ...settings, repositories: repos });
          await ctx.storage.set(SETTINGS_KEY, next);
          await removePrsForRepo(ctx, `${owner}/${repo}`);
          return { ok: true, settings: next };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Cheap read of current sync-health (R-REPO-013) without a fresh probe
       * pass. Re-derives the PERSISTENT facts from the stored bookkeeping + live
       * `gh` auth: disconnected hosts (from auth), confirmed remote-gone (≥2
       * passes, not kept), and kept-gone. The TRANSIENT `outageHosts` is only
       * known from an actual probe pass, so it's surfaced through {@link pollAll}'s
       * return, not here — this read leaves it empty. Lets the renderer paint the
       * clue on mount before the first poll completes.
       */
      async getSyncHealth() {
        try {
          const state = await readSyncHealthState(ctx);
          const conn = await connectionByHost(ctx);
          const settings = await readSettings(ctx);
          const trackedHosts = new Set((settings.repositories ?? []).map((r) => r.host));
          const disconnectedHosts = Array.from(trackedHosts).filter((h) => (conn[h] ?? "disconnected") !== "connected").sort();
          const kept = new Set((state.kept ?? []).map((n) => n.toLowerCase()));
          const remoteGone = Object.entries(state.gone404 ?? {}).filter(([name, count]) => count >= 2 && !kept.has(name)).map(([name]) => name).sort();
          const health = {
            disconnectedHosts,
            outageHosts: [],
            remoteGone,
            keptGone: Array.from(kept).sort()
          };
          return { ok: true, health };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /**
       * Resolve a remote-gone repo's Remove/Keep prompt (R-REPO-016). `action`:
       *   - `remove` — delete the repo + its tracked PRs (same as R-REPO-006), and
       *     clear its health bookkeeping.
       *   - `keep`   — retain the repo + last-known PRs (marked stale) but exclude it
       *     from the sync pass; recorded in the kept set so `repoSyncGate` skips it
       *     until removal or recovery (AC-REPO-16.3).
       * `repo` is the `owner/repo` full name (renderer-supplied → validated here,
       * Rule 1/2 — it must be an isSafeRepoArg AND a currently-tracked repo).
       */
      async resolveRemoteGone(params) {
        try {
          const repo = String(params?.repo ?? "").trim();
          const action = params?.action;
          if (!isSafeRepoArg(repo)) return { ok: false, error: `Invalid repository: ${repo}` };
          if (action !== "remove" && action !== "keep") return { ok: false, error: "Invalid action" };
          const settings = await readSettings(ctx);
          const key = repo.toLowerCase();
          const rec = (settings.repositories ?? []).find(
            (r) => `${r.owner}/${r.repo}`.toLowerCase() === key
          );
          if (!rec) return { ok: false, error: `Not a tracked repository: ${repo}` };
          const state = await readSyncHealthState(ctx);
          if (action === "remove") {
            const repos = (settings.repositories ?? []).filter(
              (r) => `${r.owner}/${r.repo}`.toLowerCase() !== key
            );
            const next = mergeSettings({ ...settings, repositories: repos });
            await ctx.storage.set(SETTINGS_KEY, next);
            await removePrsForRepo(ctx, `${rec.owner}/${rec.repo}`);
            const gone404 = { ...state.gone404 };
            delete gone404[key];
            await ctx.storage.set(SYNC_HEALTH_KEY, {
              gone404,
              kept: (state.kept ?? []).filter((n) => n.toLowerCase() !== key)
            });
            return { ok: true, settings: next };
          }
          const keptSet = new Set((state.kept ?? []).map((n) => n.toLowerCase()));
          keptSet.add(key);
          await ctx.storage.set(SYNC_HEALTH_KEY, {
            gone404: state.gone404 ?? {},
            kept: Array.from(keptSet).sort()
          });
          return { ok: true, settings };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      /** Test a repo's connection (R-REPO-010). */
      async testRepository(params) {
        const { host, owner, repo } = params ?? {};
        if (!host || !owner || !repo) return { ok: false, error: "Missing repository key" };
        const bad = await rejectUnknownHost(ctx, host);
        if (bad) return { ok: false, error: bad };
        return testRepoConnection(ctx, host, owner, repo);
      },
      /**
       * Browse an org's repos, one page (R-REPO-009). `org` here is the org login;
       * host from the org record.
       */
      async browseRepos(params) {
        const { host, org } = params ?? {};
        if (!host || !org) return { ok: false, error: "Missing host/org" };
        const bad = await rejectUnknownHost(ctx, host);
        if (bad) return { ok: false, error: bad };
        return listOrgRepos(ctx, host, org, params.page ?? 1);
      },
      /** Server-side repo search on a host (R-REPO-009 hybrid). */
      async searchRepositories(params) {
        const { host, query, org } = params ?? {};
        if (!host) return { ok: false, error: "Missing host" };
        const bad = await rejectUnknownHost(ctx, host);
        if (bad) return { ok: false, error: bad };
        return searchRepos(ctx, host, query ?? "", org);
      },
      /**
       * Search repositories across EVERY authenticated host (R-REPO-009). This is
       * the browser's search-first entry point: no org dropdown — "orgs" here are
       * `gh` user accounts, so a per-org browse degrades to personal repos. Each
       * host is searched via `search/repositories` (covers all orgs the user can
       * see there) and the results merge, deduped by host+fullName. Hosts come
       * from main's own `getAuthHosts` (never renderer free-text — Rule 2).
       */
      async searchAllRepositories(params) {
        return searchReposAllHosts(ctx, params?.query ?? "");
      },
      /**
       * List EVERY accessible repository across all authenticated hosts, one page
       * deep (R-REPO-009 browse-all). This is the browser's show-all-on-open data
       * source (CodeNod parity): the renderer opens the dialog and gets the full
       * owner-grouped list without typing. Each repo is tagged `alreadyAdded` so
       * the browser can render a "Connected" pill instead of a checkbox for repos
       * already monitored. `page` drives "Load more". Hosts come from main's own
       * `getAuthHosts` (never renderer free-text — Rule 2).
       */
      async listAllRepositories(params) {
        const res = await listReposAllHosts(ctx, params?.page ?? 1);
        if (!res.ok || !res.repos) return { ok: res.ok, error: res.error, repos: [], hasMore: false };
        const settings = await readSettings(ctx);
        const connected = new Set(
          (settings.repositories ?? []).map(
            (r) => `${r.host}|${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`
          )
        );
        const repos = res.repos.map((r) => ({
          ...r,
          alreadyAdded: connected.has(`${r.host}|${r.fullName.toLowerCase()}`)
        }));
        return { ok: true, repos, hasMore: res.hasMore, incompleteOwners: res.incompleteOwners };
      },
      /**
       * Suggested repositories (R-REPO-007): scan the author's 90-day PR activity
       * across every monitored org's host, tag which are already connected. The
       * 90-day window is FIXED and computed here (main has a real clock).
       */
      async suggestRepositories() {
        try {
          const settings = await discoverOrgs(ctx, false);
          const orgs = settings.organizations ?? [];
          if (orgs.length === 0) return { ok: true, repos: [] };
          const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
          const connected = new Set(
            (settings.repositories ?? []).map((r) => `${r.host}|${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`)
          );
          const hosts = Array.from(new Set(orgs.map((o) => o.host)));
          const all = [];
          for (const host of hosts) {
            const res = await suggestedRepos(ctx, host, since);
            if (!res.ok || !res.repos) continue;
            for (const r of res.repos) {
              const org = orgs.find((o) => o.host === host && o.login.toLowerCase() === r.owner.toLowerCase()) ?? orgs.find((o) => o.host === host);
              all.push({
                ...r,
                orgLogin: org?.login ?? r.owner,
                alreadyAdded: connected.has(`${host}|${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`)
              });
            }
          }
          return { ok: true, repos: all };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      // --- Author (R-PPL-*) ---
      /**
       * The monitored author's identity across orgs (R-PPL-003/004). Returns the
       * authenticated user's profile (display name + email from the first org's
       * host) plus a per-org GitHub-identity list. Seeds authorDiscovered once.
       */
      async getAuthor() {
        try {
          const author = await discoverAuthor(ctx, false);
          if (!author) return { ok: true, author: void 0 };
          const conn = await connectionByHost(ctx);
          const identities = author.identities.map((i) => ({
            host: i.host,
            shortHost: shortHost(i.host),
            login: i.login,
            connection: conn[i.host] ?? "disconnected"
          }));
          return {
            ok: true,
            author: {
              login: author.login,
              name: author.name,
              email: author.email,
              identities
            }
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    };
  },
  teardown() {
  }
};
function setupPrMonitor(ctx) {
  return prMonitorMainModule.setup(ctx);
}

// lib/rpc.ts
function invokeRpc(fn, args) {
  if (args === void 0) return fn();
  if (Array.isArray(args)) return fn(...args);
  return fn(args);
}

// lib/plugin.ts
var MIN_POLL_MINUTES = 15;
var MAX_POLL_MINUTES = 120;
function clampPollMs(minutes, overrideMs) {
  if (typeof overrideMs === "number" && overrideMs > 0) return overrideMs;
  const value = Number.isFinite(minutes) ? Number(minutes) : DEFAULT_PR_MONITOR_SETTINGS.pollIntervalMinutes;
  const clamped = Math.min(MAX_POLL_MINUTES, Math.max(MIN_POLL_MINUTES, value));
  return clamped * 6e4;
}
async function readSettings2(zcc) {
  const stored = await zcc.storage.kv.get(SETTINGS_STORAGE_KEY);
  return { ...DEFAULT_PR_MONITOR_SETTINGS, ...stored };
}
async function createPrMonitorPlugin(zcc, deps = {}) {
  await migrateLegacyKv(zcc.storage.kv, deps.dataDir ?? defaultPrMonitorDataDir());
  const exec = deps.exec ?? createGhExec();
  const ctx = {
    moduleId: zcc.pluginId,
    log: (message) => zcc.log.info(message),
    exec,
    storage: {
      get: (key) => zcc.storage.kv.get(key),
      set: (key, value) => zcc.storage.kv.set(key, value)
    }
  };
  const methods = setupPrMonitor(ctx);
  for (const [name, handler] of Object.entries(methods)) {
    if (typeof handler !== "function") continue;
    zcc.rpc.method(name, (args) => invokeRpc(handler, args));
  }
  zcc.rpc.method("storageGet", async (key) => {
    if (typeof key !== "string" || !key.trim()) return void 0;
    return zcc.storage.kv.get(key);
  });
  zcc.rpc.method("storageSet", async (args) => {
    const rec = args;
    if (typeof rec?.key !== "string" || !rec.key.trim()) {
      throw new Error("storageSet requires a key");
    }
    await zcc.storage.kv.set(rec.key, rec.value);
  });
  zcc.rpc.method("listProjects", async () => zcc.sdk.projects.list());
  zcc.rpc.method("pushInbox", async (args) => {
    const rec = args;
    const projectId = typeof rec?.projectId === "string" ? rec.projectId.trim() : "";
    const comments = typeof rec?.comments === "string" ? rec.comments : "";
    if (!projectId || !comments.trim()) {
      throw new Error("pushInbox requires projectId and comments");
    }
    return zcc.sdk.inbox.push({ projectId, comments });
  });
  zcc.rpc.method("badge", async () => {
    const prs = await methods.listPrs();
    const settings = await readSettings2(zcc);
    return { count: computeNavBadge({ settings, prs }) };
  });
  async function deliverInbox(deltas) {
    if (!deltas?.length) return;
    const settings = await readSettings2(zcc);
    for (const delivery of inboxDeliveriesForDeltas(deltas, settings)) {
      try {
        await zcc.sdk.inbox.push({ projectId: delivery.projectId, comments: delivery.comments });
      } catch (err) {
        zcc.log.warn(
          `inbox push failed for ${delivery.pr.repo}#${delivery.pr.number}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  if (deps.startBackground === false) return;
  zcc.background.service("poll", () => {
    let stopped = false;
    let timer;
    const tick = async () => {
      if (stopped) return;
      const settings = await readSettings2(zcc);
      if (settings.autoSyncEnabled !== false) {
        try {
          const result = await (deps.pollAll ?? methods.pollAll)();
          if (result.ok) await deliverInbox(result.deltas);
        } catch (err) {
          zcc.log.warn(`poll failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (stopped) return;
      const waitMs = clampPollMs(settings.pollIntervalMinutes, deps.pollIntervalMs);
      timer = setTimeout(() => {
        void tick();
      }, waitMs);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  });
}

// server.ts
async function plugin(zcc, deps) {
  await createPrMonitorPlugin(zcc, deps);
}
export {
  plugin as default
};
