//#region src/renderer/panel.tsx
var e = { activate({ React: e, host: t }) {
	let { useState: n, useEffect: r, useCallback: i, useRef: a, useMemo: o } = e, s = e.createElement;
	function c(e) {
		let t = (e || "").toLowerCase();
		return /\breject|\bblock|contre|against/.test(t) ? "reject" : t.startsWith("changes") || t.includes("condition") || t.includes("escalat") ? "conditions" : "approve";
	}
	function l(e) {
		let t = (e || "").toLowerCase();
		return /reject|block|contre|against|veto/.test(t) ? "reject" : /change|revise|rework|condition|abstain|escalat|defer|neutral/.test(t) ? "conditions" : "approve";
	}
	function u(e) {
		return (e || "").split(/[-_ ]+/).filter(Boolean).slice(0, 2).map((e) => e[0].toUpperCase()).join("");
	}
	let d = {
		approve: "#3fb950",
		reject: "#f85149",
		conditions: "#d29922"
	}, f = [
		"approve",
		"conditions",
		"reject"
	], p = {
		approve: "FOR",
		conditions: "CHANGES",
		reject: "AGAINST"
	}, m = {
		approve: "APPROVED",
		reject: "REJECTED",
		conditions: "CONDITIONS"
	};
	function h(e, t) {
		let n = (e || "").trim(), r = n.match(/^(.{2,32}?)\s*[—–:-]\s+(.+)$/s);
		return r ? {
			badge: r[1].trim().toUpperCase(),
			detail: r[2].trim()
		} : n.length <= 28 ? {
			badge: n.toUpperCase(),
			detail: ""
		} : {
			badge: m[t],
			detail: n
		};
	}
	let g = typeof matchMedia == "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	function _(e, t, n, r, i) {
		let a = e <= 6 ? 1 : e <= 14 ? 2 : e <= 30 ? 3 : e <= 60 ? 5 : 8, o = [];
		for (let e = 0; e < a; e++) o.push(t + (a === 1 ? (n - t) * .5 : (n - t) * (e / (a - 1))));
		let s = o.reduce((e, t) => e + t, 0), c = o.map((t) => Math.max(1, Math.round(t / s * e))), l = e - c.reduce((e, t) => e + t, 0);
		for (let e = c.length - 1; l !== 0 && e >= 0; e--) {
			let t = l > 0 ? 1 : -1;
			c[e] + t >= 1 && (c[e] += t, l -= t);
		}
		let u = [];
		for (let e = 0; e < a; e++) {
			let t = c[e], n = o[e];
			for (let e = 0; e < t; e++) {
				let a = t === 1 ? .5 : e / (t - 1), o = Math.PI * .95 - a * Math.PI * .9;
				u.push({
					ang: o,
					x: r + n * Math.cos(o),
					y: i - n * Math.sin(o)
				});
			}
		}
		return u.sort((e, t) => t.ang - e.ang), u.slice(0, e);
	}
	function v(e, t, n, r) {
		return [e + n * Math.cos(r), t - n * Math.sin(r)];
	}
	function y(e, t, n, r, i) {
		let [a, o] = v(e, t, n, r), [s, c] = v(e, t, n, i);
		return `M ${a} ${o} A ${n} ${n} 0 ${+(Math.abs(i - r) > Math.PI)} 1 ${s} ${c}`;
	}
	let b = `
      .cx-seat { transition: fill .5s ease, transform .18s cubic-bezier(.2,1.5,.4,1); transform-box: fill-box; transform-origin: center; cursor: pointer; }
      .cx-seat:hover, .cx-seat:focus { transform: scale(1.5); outline: none; }
      .cx-seat.on { filter: drop-shadow(0 0 4px var(--cx-seat-color)); }
      .cx-seat.focused { stroke: var(--fg, #e6edf3); stroke-width: 2; }
      .cx-initial { pointer-events: none; opacity: 0; transition: opacity .4s ease; }
      .cx-initial.show { opacity: 1; }
      .cx-card { transition: transform .12s ease, border-color .15s ease; }
      .cx-card:hover { transform: translateY(-1px); }
      .cx-card.flash { animation: cxflash 1.2s ease; }
      @keyframes cxflash { 0% { box-shadow: 0 0 0 0 ${d.conditions}; } 25% { box-shadow: 0 0 0 3px ${d.conditions}; } 100% { box-shadow: 0 0 0 0 transparent; } }
      .cx-verdict.landed { animation: cxslam .5s cubic-bezier(.2,1.4,.4,1) both; }
      .cx-gavel.landed { animation: cxgavel .6s ease both; transform-origin: 80% 80%; display: inline-block; }
      @keyframes cxslam { 0% { opacity: 0; transform: scale(1.5) translateY(-6px); } 100% { opacity: 1; transform: none; } }
      @keyframes cxgavel { 0%,60% { transform: rotate(0); } 70% { transform: rotate(-32deg); } 85% { transform: rotate(6deg); } 100% { transform: rotate(0); } }
      @media (prefers-reduced-motion: reduce) {
        .cx-seat { transition: fill 0s; }
        .cx-card.flash, .cx-verdict.landed, .cx-gavel.landed { animation: none; }
      }
      /* rail row: reveal the delete affordance on hover/focus-within */
      .cx-row { position: relative; }
      .cx-row-del { position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity .12s ease, background .12s ease;
        background: none; border: none; color: var(--fg-dim, #8b949e); cursor: pointer; border-radius: 6px;
        width: 24px; height: 24px; display: grid; place-items: center; font-size: 13px; line-height: 1; }
      .cx-row:hover .cx-row-del, .cx-row:focus-within .cx-row-del { opacity: .7; }
      .cx-row-del:hover, .cx-row-del:focus { opacity: 1 !important; background: color-mix(in srgb, ${d.reject} 22%, transparent);
        color: ${d.reject}; outline: none; }
    `;
	function x(e, t) {
		let [o, s] = n(0), [c, l] = n(!1), u = a([]), d = i(() => {
			if (u.current.forEach((e) => clearTimeout(e)), u.current = [], s(0), l(!1), g || e === 0) {
				s(e), l(!0);
				return;
			}
			let t = e > 20 ? 45 : 85;
			for (let n = 1; n <= e; n++) u.current.push(window.setTimeout(() => s(n), 160 + (n - 1) * t));
			u.current.push(window.setTimeout(() => l(!0), 160 + e * t + 200));
		}, [e]);
		return r(() => (d(), () => {
			u.current.forEach((e) => clearTimeout(e));
		}), [t]), {
			revealed: o,
			landed: c,
			run: d
		};
	}
	function S(e) {
		let { votes: t, revealed: n, winBloc: r, focusedIdx: i, onSelect: a } = e, c = t.length, p = c <= 6 ? 16 : c <= 14 ? 11 : c <= 30 ? 8 : 6, m = o(() => t.map((e, t) => ({
			v: e,
			bloc: l(e.stance),
			oi: t
		})).sort((e, t) => f.indexOf(e.bloc) - f.indexOf(t.bloc)), [t]), h = o(() => _(c, 120, 300, 380, 330), [c]), g = {
			approve: 0,
			conditions: 0,
			reject: 0
		};
		m.forEach((e) => g[e.bloc]++);
		let b = m.slice(0, n).filter((e) => e.bloc === r).length, x = [], S = Math.PI * .95, C = S - Math.PI * .05, w = S;
		f.forEach((e) => {
			let t = g[e] / (c || 1);
			if (t <= 0) return;
			let n = w - t * C;
			x.push(s("path", {
				key: `band-${e}`,
				d: y(380, 330, 326, w, n),
				fill: "none",
				stroke: d[e],
				strokeWidth: 14,
				opacity: .85
			})), w = n;
		});
		let T = S - .5 * C, [E, D] = v(380, 330, 314, T), [O, k] = v(380, 330, 338, T);
		x.push(s("line", {
			key: "tick",
			x1: E,
			y1: D,
			x2: O,
			y2: k,
			stroke: "var(--fg, #e6edf3)",
			strokeWidth: 1.5,
			strokeDasharray: "3 3",
			opacity: .5
		}));
		let [A, j] = v(380, 330, 350, T);
		return x.push(s("text", {
			key: "ticklabel",
			x: A,
			y: j - 2,
			fill: "var(--fg-dim, #8b949e)",
			fontSize: 9.5,
			textAnchor: "middle"
		}, "50%")), x.push(s("rect", {
			key: "podium",
			x: 354,
			y: 342,
			width: 52,
			height: 10,
			rx: 3,
			fill: "var(--border, #30363d)"
		})), m.forEach((e, t) => {
			let r = h[t];
			if (!r) return;
			let o = t < n, c = o ? d[e.bloc] : "var(--seat-empty, #2d333b)", l = i === e.oi, f = [s("circle", {
				key: "c",
				cx: r.x,
				cy: r.y,
				r: p,
				className: "cx-seat" + (o ? " on" : "") + (l ? " focused" : ""),
				fill: c,
				stroke: "rgba(0,0,0,.3)",
				strokeWidth: .5,
				tabIndex: 0,
				role: "button",
				"aria-label": `${e.v.voter}: ${e.v.stance}`,
				style: { "--cx-seat-color": d[e.bloc] },
				onClick: () => a(e.oi),
				onKeyDown: (t) => {
					(t.key === "Enter" || t.key === " ") && (t.preventDefault(), a(e.oi));
				}
			}, s("title", null, `${e.v.voter} — ${e.v.stance}`))];
			p >= 11 && f.push(s("text", {
				key: "t",
				x: r.x,
				y: r.y,
				className: "cx-initial" + (o ? " show" : ""),
				textAnchor: "middle",
				dominantBaseline: "central",
				fontSize: 8,
				fontWeight: 700,
				fill: "rgba(0,0,0,.55)"
			}, u(e.v.voter))), x.push(s("g", { key: `seat-${t}` }, ...f));
		}), x.push(s("text", {
			key: "bignum",
			x: 380,
			y: 308,
			textAnchor: "middle",
			fill: d[r],
			fontSize: 34,
			fontWeight: 800
		}, String(b))), x.push(s("text", {
			key: "bigof",
			x: 380,
			y: 332,
			textAnchor: "middle",
			fill: "var(--fg-dim, #8b949e)",
			fontSize: 11,
			letterSpacing: 1
		}, `of ${c} voters`)), s("svg", {
			viewBox: "0 0 760 400",
			role: "img",
			"aria-label": `Hemicycle: ${c} voters. ` + f.map((e) => `${g[e]} ${e}`).join(", "),
			style: {
				display: "block",
				width: "100%",
				maxWidth: 760,
				margin: "4px auto 0",
				overflow: "visible"
			}
		}, ...x);
	}
	function C(e) {
		let t = e.votes.map((e) => `  - ${e.voter} [${e.stance}]: ${e.rationale}`).join("\n"), n = [
			"{",
			`  "sourceId": ${JSON.stringify(e.id)},`,
			e.projectId ? `  "projectId": ${JSON.stringify(e.projectId)},` : "",
			`  "question": ${JSON.stringify(e.question)},`,
			"  \"verdict\": \"<short head — e.g. APPROVE — followed by the decision detail>\",",
			"  \"synthesis\": \"<the judge's synthesis / ruling>\",",
			"  \"roster\": \"<who voted / how chosen>\",",
			"  \"votes\": [ { \"voter\": \"<id>\", \"stance\": \"APPROVE|CHANGES|CONDITIONS|REJECT\", \"rationale\": \"<verbatim>\" } ],",
			"  \"dissent\": [\"<verbatim minority points, if any>\"]",
			"}"
		].filter((e) => e !== "").join("\n");
		return [
			"Re-analyse a prior council decision by convening a FRESH council on the same question, then record the new verdict.",
			"",
			"QUESTION:",
			e.question,
			"",
			`PRIOR VERDICT: ${e.verdict}`,
			e.roster ? `PRIOR ROSTER: ${e.roster}` : "",
			"PRIOR VOTES:",
			t,
			e.synthesis ? `\nPRIOR SYNTHESIS: ${e.synthesis}` : "",
			"",
			"STEP 1 — Run the council. Use the /zana:council skill (or the zana_deliberate MCP tool) on the QUESTION above. Let voters reach their own stances; do NOT just echo the prior verdict.",
			"",
			"STEP 2 — Record the result as a Zana artifact. Call the zana_artifact_create MCP tool with:",
			"  - type: \"decision-record\"",
			"  - tags: [\"consensus-reanalysis\"]   (REQUIRED — the Consensus panel folds in exactly this tag)",
			"  - title: a short summary of the decision",
			"  - content: a JSON string matching this shape EXACTLY:",
			"",
			n,
			"",
			"Create ONLY that one artifact as your final action. The Consensus panel will fold it in (and remove the artifact) automatically once you finish."
		].filter((e) => e !== "").join("\n");
	}
	function w(e) {
		return s("span", { style: {
			display: "inline-block",
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 10.5,
			fontWeight: 700,
			letterSpacing: .3,
			color: e.color,
			border: `1px solid ${e.color}`,
			whiteSpace: "nowrap"
		} }, e.text);
	}
	function T(e) {
		let { vote: t } = e, n = l(t.stance), r = d[n], i = e.flashKey === e.idx;
		return s("div", {
			id: `cx-card-${e.recordId}-${e.idx}`,
			className: "cx-card" + (i ? " flash" : ""),
			onClick: e.onClick,
			style: {
				border: "1px solid var(--border, #30363d)",
				borderLeft: `3px solid ${r}`,
				borderRadius: 8,
				padding: "11px 13px",
				marginBottom: 0,
				background: "var(--bg-elevated, rgba(255,255,255,0.02))",
				scrollMarginTop: 16,
				cursor: "pointer"
			}
		}, s("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: 8,
			marginBottom: 6
		} }, s("span", { style: {
			width: 18,
			height: 18,
			borderRadius: 999,
			display: "inline-grid",
			placeItems: "center",
			fontSize: 9,
			fontWeight: 700,
			color: "#0d1117",
			background: r
		} }, u(t.voter)), s("strong", { style: { fontSize: 13 } }, t.voter), s("span", { style: { marginLeft: "auto" } }, s(w, {
			text: t.stance.toUpperCase(),
			color: r
		}))), s("div", { style: {
			fontSize: 12.5,
			lineHeight: 1.55,
			opacity: .92
		} }, t.rationale));
	}
	function E(e) {
		let { record: t, host: u, onReanalysed: m } = e, g = c(t.verdict), _ = d[g], v = t.votes.length, { revealed: y, landed: b, run: w } = x(v, t.id), [E, D] = n(null), [O, k] = n(null), [A, j] = n("idle"), M = a(null), N = a(null), P = i(async () => {
			if (A === "idle") {
				j("launching");
				try {
					let e = (u.getScopedProjectId() ? u.listProjects().find((e) => e.id === u.getScopedProjectId()) : void 0) ?? u.getActiveProject() ?? void 0, n = u.getScopedProjectId() ?? t.projectId ?? e?.id;
					if (!n) {
						u.toast("Re-analyse needs a project — open this decision under its project tab", "error"), j("idle");
						return;
					}
					N.current = e?.path ?? null;
					let r = C(t), i = await u.launchSession({
						projectId: n,
						title: `Re-analyse: ${t.question.slice(0, 40)}`,
						extraArgs: [r]
					});
					if (!i) {
						u.toast("Could not launch the re-analysis session", "error"), j("idle");
						return;
					}
					M.current = i.id, j("running"), u.toast("Council re-analysis launched — its verdict will appear here when it settles", "info");
				} catch (e) {
					u.toast(`Re-analyse failed: ${e instanceof Error ? e.message : String(e)}`, "error"), j("idle");
				}
			}
		}, [
			A,
			t,
			u
		]);
		r(() => {
			if (A === "running") return u.on("session:agentStatus", ({ sessionId: e, state: t }) => {
				if (e === M.current && (t === "idle" || t === "done")) {
					j("ingesting");
					let e = N.current ?? void 0;
					u.call("ingest", { projectPath: e }).then((e) => {
						e.ingested > 0 && u.toast(`Folded in ${e.ingested} re-analysis verdict${e.ingested > 1 ? "s" : ""}`, "info"), m();
					}).catch(() => {}).finally(() => {
						j("idle"), M.current = null, N.current = null;
					});
				}
			});
		}, [
			A,
			u,
			m
		]);
		let F = i((e) => {
			D(e), k(null), window.setTimeout(() => k(e), 0);
			let n = document.getElementById(`cx-card-${t.id}-${e}`);
			n && n.scrollIntoView({
				behavior: "smooth",
				block: "nearest"
			});
		}, [t.id]), I = o(() => t.votes.map((e) => l(e.stance)).sort((e, t) => f.indexOf(e) - f.indexOf(t)), [t.votes]), L = {
			approve: 0,
			conditions: 0,
			reject: 0
		};
		I.slice(0, y).forEach((e) => L[e]++);
		let R = [];
		R.push(s("h2", {
			key: "q",
			style: {
				fontSize: 18,
				margin: "0 0 14px",
				lineHeight: 1.4,
				maxWidth: 820
			}
		}, t.question));
		let { badge: z, detail: B } = h(t.verdict, g), V = f.map((e) => s("span", {
			key: e,
			style: {
				display: "inline-flex",
				alignItems: "center",
				gap: 6
			}
		}, s("span", { style: {
			width: 10,
			height: 10,
			borderRadius: 3,
			background: d[e],
			boxShadow: `0 0 6px ${d[e]}`
		} }), s("span", { style: { fontVariantNumeric: "tabular-nums" } }, String(L[e])), s("span", { style: { opacity: .85 } }, " " + p[e])));
		R.push(s("div", {
			key: "banner",
			style: {
				padding: "16px 20px",
				borderRadius: 12,
				marginBottom: 6,
				border: "1px solid var(--border, #30363d)",
				borderLeft: `5px solid ${_}`,
				background: "var(--bg-elevated, rgba(255,255,255,0.03))"
			}
		}, s("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: 18,
			flexWrap: "wrap"
		} }, s("div", {
			className: "cx-verdict" + (b ? " landed" : ""),
			style: {
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				padding: "8px 16px",
				borderRadius: 999,
				fontSize: 17,
				fontWeight: 800,
				letterSpacing: .6,
				lineHeight: 1,
				color: _,
				background: `color-mix(in srgb, ${_} 16%, transparent)`,
				border: `1.5px solid ${_}`,
				whiteSpace: "nowrap"
			}
		}, s("span", {
			className: "cx-gavel" + (b ? " landed" : ""),
			style: { fontSize: 18 }
		}, "⚖️"), z), s("div", {
			title: "Voter stances. The verdict is the judge's reasoned synthesis of the rationales — not a majority count, so \"CHANGES\" votes (qualified support) can still settle as APPROVE.",
			style: {
				display: "flex",
				gap: 16,
				fontSize: 13,
				fontWeight: 600,
				cursor: "help"
			}
		}, ...V), s("div", { style: {
			marginLeft: "auto",
			fontSize: 11,
			opacity: .6,
			textAlign: "right",
			lineHeight: 1.5,
			whiteSpace: "pre-line"
		} }, (t.roster ? t.roster + "\n" : "") + (t.settledAt ? "settled " + t.settledAt.slice(0, 10) : ""))), B ? s("div", { style: {
			marginTop: 13,
			paddingTop: 13,
			borderTop: "1px solid var(--border, #30363d)",
			fontSize: 15,
			fontWeight: 600,
			lineHeight: 1.45,
			color: "var(--fg, #e6edf3)",
			maxWidth: 820
		} }, B) : null));
		let H = A !== "idle", U = A === "launching" ? "Launching…" : A === "running" ? "● Council in session…" : A === "ingesting" ? "Folding in…" : "↻ Re-analyse";
		return R.push(s("div", {
			key: "controls",
			style: {
				display: "flex",
				gap: 10,
				alignItems: "center",
				margin: "16px 0 0",
				flexWrap: "wrap"
			}
		}, s("button", {
			onClick: () => w(),
			style: {
				font: "inherit",
				fontSize: 12,
				cursor: "pointer",
				background: "var(--bg-elevated, rgba(255,255,255,0.04))",
				color: "inherit",
				border: "1px solid var(--border, #30363d)",
				borderRadius: 8,
				padding: "7px 13px"
			}
		}, "▸ Replay roll-call"), s("button", {
			onClick: () => void P(),
			disabled: H,
			title: "Convene a fresh council on this question and record the new verdict here",
			style: {
				font: "inherit",
				fontSize: 12,
				cursor: H ? "default" : "pointer",
				background: H ? "var(--bg-elevated, rgba(255,255,255,0.04))" : `color-mix(in srgb, ${_} 14%, transparent)`,
				color: H ? "inherit" : _,
				opacity: H ? .75 : 1,
				border: `1px solid ${H ? "var(--border, #30363d)" : _}`,
				borderRadius: 8,
				padding: "7px 13px",
				fontWeight: 600
			}
		}, U), s("span", { style: {
			fontSize: 11,
			opacity: .55
		} }, A === "running" ? "watching the session — its verdict lands here when it settles" : "click a seat to read its rationale"))), R.push(s("div", { key: "chamber" }, s(S, {
			votes: t.votes,
			revealed: y,
			winBloc: g,
			focusedIdx: E,
			onSelect: F
		}))), t.synthesis && R.push(s("div", { key: "synth" }, s("div", { style: {
			fontSize: 11,
			textTransform: "uppercase",
			letterSpacing: .6,
			opacity: .55,
			margin: "26px 0 10px",
			fontWeight: 600
		} }, "Synthesis — the ruling"), s("div", { style: {
			fontSize: 13.5,
			lineHeight: 1.65,
			maxWidth: 760,
			padding: "12px 16px",
			borderRadius: 10,
			background: "var(--bg-elevated, rgba(255,255,255,0.03))",
			border: "1px solid var(--border, #30363d)"
		} }, t.synthesis))), R.push(s("div", {
			key: "votes-h",
			style: {
				fontSize: 11,
				textTransform: "uppercase",
				letterSpacing: .6,
				opacity: .55,
				margin: "26px 0 10px",
				fontWeight: 600
			}
		}, `Voters (${v}) — click a seat above`)), R.push(s("div", {
			key: "votes",
			style: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
				gap: 10
			}
		}, ...t.votes.map((e, n) => s(T, {
			key: n,
			vote: e,
			idx: n,
			recordId: t.id,
			flashKey: O,
			onClick: () => F(n)
		})))), t.dissent && t.dissent.length && R.push(s("div", {
			key: "dissent",
			style: {
				marginTop: 24,
				maxWidth: 760
			}
		}, s("div", { style: {
			fontSize: 11,
			textTransform: "uppercase",
			letterSpacing: .6,
			color: d.conditions,
			marginBottom: 10,
			fontWeight: 600
		} }, "Minority report — dissent (verbatim)"), ...t.dissent.map((e, t) => s("div", {
			key: t,
			style: {
				fontSize: 12.5,
				lineHeight: 1.55,
				opacity: .92,
				borderLeft: `2px solid ${d.conditions}`,
				padding: "6px 0 6px 14px",
				marginBottom: 8
			}
		}, e)))), s("div", { style: {
			padding: "22px 30px 56px",
			overflowY: "auto",
			flex: 1,
			minWidth: 0
		} }, ...R);
	}
	function D(e) {
		let [a, o] = n([]), [l, u] = n(null), [f, p] = n(null), [m, h] = n(null), [g, _] = n(!0), v = i(async () => {
			_(!0), h(null);
			try {
				let e = t.getScopedProjectId() ?? void 0, n = await t.call("list", e);
				o(n), u((e) => e ?? n[0]?.id ?? null);
			} catch (e) {
				h(e instanceof Error ? e.message : String(e));
			} finally {
				_(!1);
			}
		}, []);
		r(() => {
			v();
		}, [v]);
		let y = i(async (e, n) => {
			if (await t.confirm({
				title: "Delete this decision?",
				body: `"${n}"\n\nThis can't be undone.`,
				confirmLabel: "Delete",
				danger: !0
			})) try {
				await t.call("remove", e), u((t) => t === e ? a.filter((t) => t.id !== e)[0]?.id ?? null : t), await v();
			} catch (e) {
				t.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
			}
		}, [a, v]), x = i(async () => {
			if (a.length && await t.confirm({
				title: `Delete ALL ${a.length} decision${a.length > 1 ? "s" : ""}?`,
				body: "This clears the Consensus tab and can't be undone.",
				confirmLabel: "Delete all",
				danger: !0
			})) try {
				let { cleared: e } = await t.call("clearAll");
				u(null), p(null), await v(), t.toast(`Cleared ${e} decision${e === 1 ? "" : "s"}`, "info");
			} catch (e) {
				t.toast(`Clear failed: ${e instanceof Error ? e.message : String(e)}`, "error");
			}
		}, [a, v]);
		r(() => {
			if (!l) {
				p(null);
				return;
			}
			let e = !1;
			return t.call("get", l).then((t) => {
				e || p(t);
			}).catch((t) => {
				e || h(t instanceof Error ? t.message : String(t));
			}), () => {
				e = !0;
			};
		}, [l]);
		let S = a.length === 0 && !g ? [s("div", {
			key: "empty",
			style: {
				padding: "8px 16px",
				fontSize: 12,
				opacity: .5
			}
		}, "No recorded decisions yet.")] : a.map((e) => {
			let t = e.id === l, n = d[c(e.verdict)];
			return s("div", {
				key: e.id,
				className: "cx-row"
			}, s("button", {
				onClick: () => u(e.id),
				style: {
					textAlign: "left",
					background: t ? "var(--bg-active, rgba(255,255,255,0.06))" : "none",
					border: "none",
					borderLeft: `3px solid ${t ? n : "transparent"}`,
					color: "inherit",
					cursor: "pointer",
					padding: "11px 34px 11px 16px",
					display: "block",
					width: "100%"
				}
			}, s("div", { style: {
				fontSize: 12.5,
				lineHeight: 1.4,
				marginBottom: 8,
				display: "-webkit-box",
				WebkitLineClamp: 2,
				WebkitBoxOrient: "vertical",
				overflow: "hidden"
			} }, e.question), s("div", { style: {
				display: "flex",
				gap: 8,
				alignItems: "center"
			} }, s("span", { style: {
				width: 8,
				height: 8,
				borderRadius: 999,
				background: n,
				display: "inline-block",
				boxShadow: `0 0 6px ${n}`
			} }), s("span", { style: {
				fontSize: 11,
				opacity: .6
			} }, `${e.voters} voters · ${(e.settledAt || "").slice(0, 10)}`))), s("button", {
				className: "cx-row-del",
				title: "Delete this decision",
				"aria-label": `Delete decision: ${e.question}`,
				onClick: (t) => {
					t.stopPropagation(), y(e.id, e.question);
				}
			}, "🗑"));
		}), C = s("div", { style: {
			width: 280,
			minWidth: 280,
			borderRight: "1px solid var(--border, #30363d)",
			overflowY: "auto",
			display: "flex",
			flexDirection: "column"
		} }, s("div", { style: {
			padding: "14px 16px 8px",
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between"
		} }, s("span", { style: {
			fontSize: 12,
			textTransform: "uppercase",
			letterSpacing: .6,
			opacity: .55,
			fontWeight: 600
		} }, "Decisions"), s("div", { style: {
			display: "flex",
			gap: 4,
			alignItems: "center"
		} }, s("button", {
			onClick: () => void v(),
			title: "Refresh",
			style: {
				background: "none",
				border: "none",
				color: "inherit",
				cursor: "pointer",
				opacity: .6,
				fontSize: 12
			}
		}, "⟳"), a.length > 0 ? s("button", {
			onClick: () => void x(),
			title: "Delete all decisions",
			style: {
				background: "none",
				border: "none",
				color: "inherit",
				cursor: "pointer",
				opacity: .6,
				fontSize: 12
			}
		}, "🗑") : null)), ...S), w = m ? s("div", { style: {
			padding: 24,
			color: d.reject,
			fontSize: 13
		} }, `Error: ${m}`) : f ? s(E, {
			key: f.id,
			record: f,
			host: t,
			onReanalysed: () => void v()
		}) : s("div", { style: {
			padding: 24,
			opacity: .5,
			fontSize: 13
		} }, g ? "Loading…" : "Select a decision.");
		return s("div", { style: {
			gridColumn: "2 / -1",
			minWidth: 0,
			display: "flex",
			height: "100%",
			width: "100%",
			fontFamily: "inherit"
		} }, s("style", null, b), C, w);
	}
	return {
		panel: D,
		commands: (e) => [{
			id: "refresh",
			label: "Consensus: view decisions",
			icon: "Scale",
			run: () => e.toast("Open the Consensus tab to view council decisions")
		}],
		navBadge: () => null
	};
} };
//#endregion
export { e as default };
