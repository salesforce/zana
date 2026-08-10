//#region src/renderer/panel.tsx
var e = { activate({ React: e, host: t }) {
	let { useState: n, useEffect: r, useCallback: i } = e, a = e.createElement;
	function o(e) {
		let t = e.toLowerCase();
		return t.includes("run") ? "#3fb950" : t.includes("err") || t.includes("fail") ? "#f85149" : t.includes("done") || t.includes("complete") ? "#58a6ff" : "#8b949e";
	}
	function s(e) {
		return a("span", { style: {
			display: "inline-block",
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 11,
			fontWeight: 600,
			lineHeight: 1.7,
			color: e.subtle ? e.color : "#0d1117",
			background: e.subtle ? "transparent" : e.color,
			border: `1px solid ${e.color}`,
			whiteSpace: "nowrap"
		} }, e.text);
	}
	function c(e) {
		return a("div", { style: {
			flex: "1 1 130px",
			minWidth: 130,
			padding: "14px 16px",
			borderRadius: 10,
			background: "var(--bg-elevated, #161b22)",
			border: "1px solid var(--border, #30363d)"
		} }, a("div", { style: {
			fontSize: 26,
			fontWeight: 700,
			lineHeight: 1.1
		} }, String(e.value)), a("div", { style: {
			fontSize: 12,
			color: "var(--text-muted, #8b949e)",
			marginTop: 4
		} }, e.label), e.hint ? a("div", { style: {
			fontSize: 11,
			color: "var(--text-muted, #8b949e)",
			marginTop: 2
		} }, e.hint) : null);
	}
	function l(e) {
		return a("div", { style: {
			padding: 24,
			color: "var(--text-muted, #8b949e)",
			fontSize: 13
		} }, e.text);
	}
	function u(e) {
		let [t, r] = n(!1), i = !!e.onClick;
		return a("div", {
			onClick: e.onClick,
			onMouseEnter: i ? () => r(!0) : void 0,
			onMouseLeave: i ? () => r(!1) : void 0,
			role: i ? "button" : void 0,
			tabIndex: i ? 0 : void 0,
			onKeyDown: i ? (t) => {
				(t.key === "Enter" || t.key === " ") && (t.preventDefault(), e.onClick());
			} : void 0,
			style: {
				display: "flex",
				alignItems: "center",
				gap: 12,
				padding: "10px 14px",
				borderBottom: "1px solid var(--border, #21262d)",
				cursor: i ? "pointer" : "default",
				background: t ? "var(--surface-2, #161b22)" : "transparent"
			}
		}, a("div", { style: {
			flex: 1,
			minWidth: 0
		} }, a("div", { style: {
			fontSize: 13,
			fontWeight: 600
		} }, e.left), e.sub ? a("div", { style: {
			fontSize: 11,
			color: "var(--text-muted, #8b949e)",
			marginTop: 2
		} }, e.sub) : null), e.right ? a("div", { style: { flexShrink: 0 } }, e.right) : null, i ? a("div", { style: {
			flexShrink: 0,
			color: "var(--muted, #8b949e)",
			fontSize: 14,
			opacity: t ? 1 : .4
		} }, "›") : null);
	}
	function d(e) {
		let t = e.data, n = Object.entries(t.runStateCounts).sort((e, t) => t[1] - e[1]);
		return a("div", { style: {
			padding: 16,
			display: "flex",
			flexDirection: "column",
			gap: 18
		} }, a("div", { style: {
			display: "flex",
			flexWrap: "wrap",
			gap: 12
		} }, a(c, {
			label: "Teams",
			value: t.teams.length
		}), a(c, {
			label: "Profiles",
			value: t.profiles.length
		}), a(c, {
			label: "Skills",
			value: t.skills.length
		}), a(c, {
			label: "Sprints",
			value: t.sprints.length
		}), a(c, {
			label: "Workers",
			value: t.workerCount
		}), a(c, {
			label: "Autopilot goals",
			value: t.autopilotGoalCount
		})), a("div", null, a("div", { style: {
			fontSize: 12,
			fontWeight: 700,
			textTransform: "uppercase",
			color: "var(--text-muted, #8b949e)",
			marginBottom: 8
		} }, "Agent runs"), n.length === 0 ? a(l, { text: "No agent runs recorded yet." }) : a("div", { style: {
			display: "flex",
			flexWrap: "wrap",
			gap: 8
		} }, ...n.map(([e, t]) => a(s, {
			key: e,
			text: `${e} · ${t}`,
			color: o(e),
			subtle: !0
		})))));
	}
	function f() {
		return {
			name: "",
			slots: [{
				profileId: "",
				quantity: 1
			}]
		};
	}
	function p(e) {
		let [r, i] = n(e.initial), [o, s] = n(!1), [c, l] = n(null), u = (e) => i((t) => ({
			...t,
			...e
		})), d = (e, t) => i((n) => ({
			...n,
			slots: n.slots.map((n, r) => r === e ? {
				...n,
				...t
			} : n)
		})), f = () => i((e) => ({
			...e,
			slots: [...e.slots, {
				profileId: "",
				quantity: 1
			}]
		})), p = (e) => i((t) => ({
			...t,
			slots: t.slots.filter((t, n) => n !== e)
		})), m = new Set(e.profiles.map((e) => e.id)), h = [r.orchestratorProfileId, ...r.slots.map((e) => e.profileId)].filter((e) => !!e && !m.has(e)), g = [...e.profiles, ...h.map((e) => ({
			id: e,
			displayName: `⚠ unknown: ${e}`
		}))], _ = () => {
			s(!0), l(null), t.call("saveTeam", r).then((t) => {
				t.ok ? e.onSaved() : l(t.error);
			}).catch((e) => l(e instanceof Error ? e.message : String(e))).finally(() => s(!1));
		}, v = {
			fontSize: 11,
			fontWeight: 600,
			color: "var(--text-muted, #8b949e)",
			marginBottom: 4
		}, y = {
			width: "100%",
			boxSizing: "border-box",
			padding: "6px 8px",
			borderRadius: 6,
			border: "1px solid var(--border, #30363d)",
			background: "var(--bg-input, #161b22)",
			color: "var(--text-primary, #c9d1d9)",
			fontSize: 13
		}, b = (e, t) => a("div", { style: { marginBottom: 12 } }, a("div", { style: v }, e), t), x = (e, t, n) => a("select", {
			value: e ?? "",
			onChange: (e) => t(e.target.value),
			style: y
		}, n ? a("option", {
			key: "",
			value: ""
		}, "— select profile —") : null, ...g.map((e) => a("option", {
			key: e.id,
			value: e.id
		}, e.displayName)));
		return a("div", { style: {
			padding: 16,
			maxWidth: 720
		} }, c ? a("div", { style: {
			color: "#f85149",
			fontSize: 12,
			marginBottom: 12
		} }, c) : null, b("Name", a("input", {
			type: "text",
			value: r.name,
			placeholder: "Backend Squad",
			onChange: (e) => u({ name: e.target.value }),
			style: y
		})), b("Icon (emoji)", a("input", {
			type: "text",
			value: r.icon ?? "",
			placeholder: "⚙️",
			onChange: (e) => u({ icon: e.target.value }),
			style: {
				...y,
				width: 80
			}
		})), b("Description", a("textarea", {
			value: r.description ?? "",
			rows: 2,
			onChange: (e) => u({ description: e.target.value }),
			style: y
		})), b("Orchestrator", x(r.orchestratorProfileId, (e) => u({ orchestratorProfileId: e }), !0)), a("div", { style: v }, "Roster slots"), ...r.slots.map((e, t) => a("div", {
			key: String(t),
			style: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				marginBottom: 8
			}
		}, a("div", { style: { flex: 1 } }, x(e.profileId, (e) => d(t, { profileId: e }), !0)), a("input", {
			type: "number",
			min: 1,
			value: e.quantity,
			onChange: (e) => d(t, { quantity: Math.max(1, parseInt(e.target.value || "1", 10) || 1) }),
			style: {
				...y,
				width: 72
			}
		}), a("button", {
			type: "button",
			onClick: () => p(t),
			disabled: r.slots.length <= 1,
			style: {
				fontSize: 12,
				padding: "4px 8px",
				borderRadius: 6,
				border: "1px solid var(--border, #30363d)",
				background: "transparent",
				color: "var(--text-muted, #8b949e)",
				cursor: r.slots.length <= 1 ? "default" : "pointer"
			}
		}, "Remove"))), a("button", {
			type: "button",
			onClick: f,
			style: {
				fontSize: 12,
				padding: "4px 10px",
				borderRadius: 6,
				border: "1px dashed var(--border, #30363d)",
				background: "transparent",
				color: "var(--text-primary, #c9d1d9)",
				cursor: "pointer",
				marginBottom: 12
			}
		}, "+ Add slot"), b("Initial prompt", a("textarea", {
			value: r.initialPrompt ?? "",
			rows: 6,
			onChange: (e) => u({ initialPrompt: e.target.value }),
			style: y
		})), b("Max concurrent workers", a("input", {
			type: "number",
			min: 1,
			value: r.maxConcurrentWorkers ?? "",
			placeholder: "default: total slots",
			onChange: (e) => {
				let t = parseInt(e.target.value, 10);
				u({ maxConcurrentWorkers: Number.isInteger(t) && t >= 1 ? t : void 0 });
			},
			style: {
				...y,
				width: 120
			}
		})), a("label", { style: {
			display: "flex",
			alignItems: "center",
			gap: 8,
			fontSize: 13,
			marginBottom: 16
		} }, a("input", {
			type: "checkbox",
			checked: r.autoStart === !0,
			onChange: (e) => u({ autoStart: e.target.checked })
		}), "Auto-start"), a("div", { style: {
			display: "flex",
			gap: 8
		} }, a("button", {
			type: "button",
			onClick: _,
			disabled: o,
			style: {
				fontSize: 13,
				fontWeight: 600,
				padding: "6px 16px",
				borderRadius: 6,
				border: "none",
				background: "#238636",
				color: "#fff",
				cursor: o ? "default" : "pointer"
			}
		}, o ? "Saving…" : "Save"), a("button", {
			type: "button",
			onClick: e.onCancel,
			disabled: o,
			style: {
				fontSize: 13,
				padding: "6px 16px",
				borderRadius: 6,
				border: "1px solid var(--border, #30363d)",
				background: "transparent",
				color: "var(--text-primary, #c9d1d9)",
				cursor: "pointer"
			}
		}, "Cancel")));
	}
	function m(e) {
		return a("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: 8,
			padding: "10px 14px 4px",
			fontSize: 11,
			fontWeight: 700,
			textTransform: "uppercase",
			letterSpacing: .4,
			color: "var(--muted, #8b949e)"
		} }, e.title, a(s, {
			text: String(e.count),
			color: "#8b949e",
			subtle: !0
		}));
	}
	function h(e) {
		let t = a("div", { style: {
			padding: "10px 14px",
			borderBottom: "1px solid var(--border, #21262d)"
		} }, a("button", {
			type: "button",
			onClick: e.onNew,
			style: {
				fontSize: 13,
				fontWeight: 600,
				padding: "6px 14px",
				borderRadius: 6,
				border: "none",
				background: "#238636",
				color: "#fff",
				cursor: "pointer"
			}
		}, "+ New team"));
		if (e.teams.length === 0) return a("div", null, t, a(l, { text: "No team templates in ~/.zana/teams." }));
		let n = (t) => a("button", {
			type: "button",
			onClick: (n) => {
				n.stopPropagation(), e.onEdit(t);
			},
			style: {
				fontSize: 12,
				padding: "3px 10px",
				borderRadius: 6,
				border: "1px solid var(--border, #30363d)",
				background: "transparent",
				color: "var(--text-primary, #c9d1d9)",
				cursor: "pointer"
			}
		}, "Edit");
		return a("div", null, t, ...e.teams.map((t) => {
			let r = `${t.workerTotal} worker${t.workerTotal === 1 ? "" : "s"} · ${t.slots} slot${t.slots === 1 ? "" : "s"}${t.maxWorkers == null ? "" : ` · max ${t.maxWorkers}`}`, i = t.roster ? a("span", null, r, a("span", { style: {
				color: "var(--muted, #8b949e)",
				opacity: .7
			} }, `  —  ${t.roster}`)) : r;
			return a(u, {
				key: t.id,
				onClick: () => e.onOpen("team", t.id),
				left: `${t.icon ? t.icon + " " : ""}${t.name}`,
				sub: t.description ? a("span", null, a("span", { style: { display: "block" } }, t.description), a("span", { style: {
					display: "block",
					marginTop: 2
				} }, i)) : i,
				right: a("div", { style: {
					display: "flex",
					gap: 8,
					alignItems: "center"
				} }, t.autoStart ? a(s, {
					text: "auto-start",
					color: "#3fb950",
					subtle: !0
				}) : null, n(t.id))
			});
		}));
	}
	function g() {
		return {
			displayName: "",
			allowedTools: [],
			disallowedTools: []
		};
	}
	let _ = [
		"claude-opus-4-8",
		"claude-sonnet-5",
		"claude-haiku-4-5-20251001",
		"claude-fable-5"
	], v = [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	], y = [
		"default",
		"plan",
		"acceptEdits",
		"bypassPermissions"
	];
	function b(e) {
		let [r, i] = n(e.initial), [o, s] = n(!1), [c, l] = n(null), u = (e) => i((t) => ({
			...t,
			...e
		})), d = () => {
			s(!0), l(null), t.call("saveProfile", r).then((t) => {
				t.ok ? e.onSaved() : l(t.error);
			}).catch((e) => l(e instanceof Error ? e.message : String(e))).finally(() => s(!1));
		}, f = {
			fontSize: 11,
			fontWeight: 600,
			color: "var(--text-muted, #8b949e)",
			marginBottom: 4
		}, p = {
			width: "100%",
			boxSizing: "border-box",
			padding: "6px 8px",
			borderRadius: 6,
			border: "1px solid var(--border, #30363d)",
			background: "var(--bg-input, #161b22)",
			color: "var(--text-primary, #c9d1d9)",
			fontSize: 13
		}, m = (e, t) => a("div", { style: { marginBottom: 12 } }, a("div", { style: f }, e), t), h = (e, t, n) => {
			let r = e && !t.includes(e) ? [e] : [];
			return a("select", {
				value: e ?? "",
				onChange: (e) => n(e.target.value),
				style: p
			}, a("option", {
				key: "",
				value: ""
			}, "— default —"), ...[...t, ...r].map((e) => a("option", {
				key: e,
				value: e
			}, e)));
		}, g = (e, t, n) => m(e, a("textarea", {
			value: t.join("\n"),
			rows: 5,
			placeholder: "One tool per line — e.g.\nRead\nGrep\nmcp__plugin_codesearch_codesearch__*",
			onChange: (e) => n(e.target.value.split("\n")),
			style: {
				...p,
				fontFamily: "var(--font-mono, monospace)"
			}
		}));
		return a("div", { style: {
			padding: 16,
			maxWidth: 720
		} }, c ? a("div", { style: {
			color: "#f85149",
			fontSize: 12,
			marginBottom: 12
		} }, c) : null, m("Name", a("input", {
			type: "text",
			value: r.displayName,
			placeholder: "Core Architect",
			onChange: (e) => u({ displayName: e.target.value }),
			style: p
		})), a("div", { style: {
			display: "flex",
			gap: 12
		} }, a("div", { style: { width: 80 } }, m("Icon (emoji)", a("input", {
			type: "text",
			value: r.icon ?? "",
			placeholder: "📐",
			onChange: (e) => u({ icon: e.target.value }),
			style: p
		}))), a("div", { style: { flex: 1 } }, m("Category", a("input", {
			type: "text",
			value: r.category ?? "",
			placeholder: "engineering",
			onChange: (e) => u({ category: e.target.value }),
			style: p
		})))), m("Description", a("textarea", {
			value: r.description ?? "",
			rows: 2,
			onChange: (e) => u({ description: e.target.value }),
			style: p
		})), a("div", { style: {
			display: "flex",
			gap: 12
		} }, a("div", { style: { flex: 1 } }, m("Model", h(r.model, _, (e) => u({ model: e })))), a("div", { style: { flex: 1 } }, m("Effort", h(r.effortLevel, v, (e) => u({ effortLevel: e })))), a("div", { style: { flex: 1 } }, m("Permission mode", h(r.permissionMode, y, (e) => u({ permissionMode: e }))))), m("System prompt", a("textarea", {
			value: r.systemPrompt ?? "",
			rows: 8,
			onChange: (e) => u({ systemPrompt: e.target.value }),
			style: p
		})), g("Allowed tools", r.allowedTools, (e) => u({ allowedTools: e })), g("Disallowed tools", r.disallowedTools, (e) => u({ disallowedTools: e })), a("div", { style: {
			display: "flex",
			gap: 8
		} }, a("button", {
			type: "button",
			onClick: d,
			disabled: o,
			style: {
				fontSize: 13,
				fontWeight: 600,
				padding: "6px 16px",
				borderRadius: 6,
				border: "none",
				background: "#238636",
				color: "#fff",
				cursor: o ? "default" : "pointer"
			}
		}, o ? "Saving…" : "Save"), a("button", {
			type: "button",
			onClick: e.onCancel,
			disabled: o,
			style: {
				fontSize: 13,
				padding: "6px 16px",
				borderRadius: 6,
				border: "1px solid var(--border, #30363d)",
				background: "transparent",
				color: "var(--text-primary, #c9d1d9)",
				cursor: "pointer"
			}
		}, "Cancel")));
	}
	function x(e) {
		let t = a("div", { style: {
			padding: "10px 14px",
			borderBottom: "1px solid var(--border, #21262d)"
		} }, a("button", {
			type: "button",
			onClick: e.onNew,
			style: {
				fontSize: 13,
				fontWeight: 600,
				padding: "6px 14px",
				borderRadius: 6,
				border: "none",
				background: "#238636",
				color: "#fff",
				cursor: "pointer"
			}
		}, "+ New profile"));
		if (e.profiles.length === 0) return a("div", null, t, a(l, { text: "No profiles in ~/.zana/profiles." }));
		let n = (t) => a("button", {
			type: "button",
			onClick: (n) => {
				n.stopPropagation(), e.onEdit(t);
			},
			style: {
				fontSize: 12,
				padding: "3px 10px",
				borderRadius: 6,
				border: "1px solid var(--border, #30363d)",
				background: "transparent",
				color: "var(--text-primary, #c9d1d9)",
				cursor: "pointer"
			}
		}, "Edit"), r = [], i = /* @__PURE__ */ new Map();
		for (let t of e.profiles) {
			let e = t.category && t.category.trim() ? t.category : "Uncategorized", n = i.get(e);
			n || (n = [], i.set(e, n), r.push([e, n])), n.push(t);
		}
		let o = r.length > 1;
		return a("div", null, t, ...r.flatMap(([t, r]) => [o ? a(m, {
			key: `h:${t}`,
			title: t,
			count: r.length
		}) : null, ...r.map((t) => a(u, {
			key: t.id,
			onClick: () => e.onOpen("profile", t.id),
			left: `${t.icon ? t.icon + " " : ""}${t.name}`,
			sub: t.description || void 0,
			right: a("div", { style: {
				display: "flex",
				gap: 8,
				alignItems: "center"
			} }, t.model ? a(s, {
				text: t.model,
				color: "#8b949e",
				subtle: !0
			}) : null, n(t.id))
		}))]));
	}
	function S(e) {
		return e.skills.length === 0 ? a(l, { text: "No skills in ~/.zana/skills." }) : a("div", null, ...e.skills.map((t) => a(u, {
			key: t.id,
			onClick: () => e.onOpen("skill", t.id),
			left: t.name,
			sub: t.description || void 0,
			right: a("div", { style: {
				display: "flex",
				gap: 6,
				alignItems: "center"
			} }, t.type ? a(s, {
				text: t.type,
				color: "#8b949e",
				subtle: !0
			}) : null, a(s, {
				text: t.enabled ? "enabled" : "disabled",
				color: t.enabled ? "#3fb950" : "#8b949e",
				subtle: !0
			}))
		})));
	}
	function C(e) {
		return e.runs.length === 0 ? a(l, { text: "No recent agent runs in ~/.zana/runs." }) : a("div", null, ...e.runs.map((t) => a(u, {
			key: t.id,
			onClick: () => e.onOpen("run", t.id),
			left: `${t.profileIcon ? t.profileIcon + " " : ""}${t.profileName ?? t.id.slice(0, 8)}`,
			sub: [
				t.mode,
				t.model,
				t.lastAction
			].filter(Boolean).join(" · ") || void 0,
			right: a(s, {
				text: t.state,
				color: o(t.state),
				subtle: !0
			})
		})));
	}
	function w(e) {
		return e.block ? a("div", { style: {
			display: "flex",
			flexDirection: "column",
			gap: 4
		} }, a("div", { style: {
			fontSize: 11,
			fontWeight: 700,
			textTransform: "uppercase",
			letterSpacing: .4,
			color: "var(--muted, #8b949e)"
		} }, e.label), a("pre", { style: {
			margin: 0,
			padding: "10px 12px",
			borderRadius: 8,
			background: "var(--surface-2, #161b22)",
			border: "1px solid var(--border, #30363d)",
			fontSize: 12,
			lineHeight: 1.5,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			color: "var(--text, #c9d1d9)",
			maxHeight: 360,
			overflowY: "auto"
		} }, e.value)) : a("div", { style: {
			display: "flex",
			gap: 12,
			alignItems: "baseline"
		} }, a("div", { style: {
			flex: "0 0 120px",
			fontSize: 11,
			fontWeight: 700,
			textTransform: "uppercase",
			letterSpacing: .4,
			color: "var(--muted, #8b949e)"
		} }, e.label), a("div", { style: {
			flex: 1,
			minWidth: 0,
			fontSize: 13,
			wordBreak: "break-word"
		} }, e.value));
	}
	function T(e) {
		return a("div", {
			onClick: e.onClose,
			style: {
				position: "absolute",
				inset: 0,
				display: "flex",
				justifyContent: "flex-end",
				background: "rgba(1, 4, 9, 0.55)",
				zIndex: 10
			}
		}, a("div", {
			onClick: (e) => e.stopPropagation(),
			style: {
				width: "min(560px, 92%)",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: "var(--bg-base, #0d1117)",
				borderLeft: "1px solid var(--border, #30363d)",
				boxShadow: "-8px 0 24px rgba(1, 4, 9, 0.4)"
			}
		}, a("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: 10,
			padding: "12px 16px",
			borderBottom: "1px solid var(--border, #30363d)"
		} }, a("div", { style: {
			fontSize: 15,
			fontWeight: 700,
			flex: 1,
			minWidth: 0
		} }, `${e.icon ? e.icon + " " : ""}${e.title}`), a("button", {
			type: "button",
			onClick: e.onClose,
			"aria-label": "Close",
			style: {
				fontSize: 16,
				lineHeight: 1,
				padding: "4px 10px",
				borderRadius: 6,
				border: "1px solid var(--border, #30363d)",
				background: "transparent",
				color: "var(--text, #c9d1d9)",
				cursor: "pointer"
			}
		}, "✕")), a("div", { style: {
			flex: 1,
			overflowY: "auto",
			padding: 16,
			display: "flex",
			flexDirection: "column",
			gap: 14
		} }, e.error ? a("div", { style: {
			color: "#f85149",
			fontSize: 13
		} }, e.error) : e.loading || !e.detail ? a(l, { text: "Loading…" }) : e.detail.fields.length === 0 ? a(l, { text: "No further detail recorded for this item." }) : e.detail.fields.map((e, t) => a(w, {
			key: `${e.label}:${t}`,
			label: e.label,
			value: e.value,
			block: e.block
		})))));
	}
	let E = [
		{
			id: "overview",
			label: "Overview"
		},
		{
			id: "teams",
			label: "Teams"
		},
		{
			id: "profiles",
			label: "Profiles"
		},
		{
			id: "skills",
			label: "Skills"
		},
		{
			id: "runs",
			label: "Runs"
		}
	];
	function D(e) {
		let [o, s] = n(null), [c, u] = n(null), [m, _] = n(!0), [v, y] = n("overview"), [w, D] = n(null), [O, k] = n([]), [A, j] = n(!1), [M, N] = n(null), [P, F] = n(null), [I, L] = n(null), [R, z] = n(!1), [B, V] = n(null), H = i((e, n) => {
			let r = t.cache.get("overview"), i = n, a;
			if (r) {
				if (e === "team") {
					let e = r.teams.find((e) => e.id === n);
					e && (i = e.name, a = e.icon);
				} else if (e === "profile") {
					let e = r.profiles.find((e) => e.id === n);
					e && (i = e.name, a = e.icon);
				} else if (e === "skill") {
					let e = r.skills.find((e) => e.id === n);
					e && (i = e.name);
				} else {
					let e = r.runs.find((e) => e.id === n);
					e && (i = e.profileName ?? n.slice(0, 8), a = e.profileIcon);
				}
			}
			F({
				kind: e,
				id: n,
				title: i,
				icon: a
			}), L(null), V(null), z(!0), t.call("detail", e, n).then((e) => {
				e ? L(e) : V("This record could not be read (it may have been removed).");
			}).catch((e) => V(e instanceof Error ? e.message : String(e))).finally(() => z(!1));
		}, []), U = i(() => F(null), []), W = i(() => {
			_(!0), u(null), t.call("overview").then((e) => {
				s(e), t.cache.set("overview", e);
			}).catch((e) => u(e instanceof Error ? e.message : String(e))).finally(() => _(!1));
		}, []), G = i(() => {
			j(!0), t.call("listProfiles").then((e) => k(e)).catch(() => k([])).finally(() => {
				D(f()), j(!1);
			});
		}, []), K = i((e) => {
			j(!0), Promise.all([t.call("listProfiles").catch(() => []), t.call("getTeam", e)]).then(([e, t]) => {
				k(e), t ? D(t.template) : u("That team template is no longer readable.");
			}).catch((e) => u(e instanceof Error ? e.message : String(e))).finally(() => j(!1));
		}, []), q = i(() => {
			N(g());
		}, []), J = i((e) => {
			j(!0), t.call("getProfile", e).then((e) => {
				e ? N(e.template) : u("That profile is no longer readable.");
			}).catch((e) => u(e instanceof Error ? e.message : String(e))).finally(() => j(!1));
		}, []);
		r(() => {
			W();
		}, [W]);
		let Y = a("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: 12,
			padding: "12px 16px",
			borderBottom: "1px solid var(--border, #30363d)"
		} }, a("div", { style: {
			fontSize: 15,
			fontWeight: 700,
			flex: 1
		} }, "Zana — global"), t.getActiveProject() ? a("div", { style: {
			fontSize: 11,
			color: "var(--text-muted, #8b949e)"
		} }, "cross-project · ~/.zana") : null, a("button", {
			type: "button",
			onClick: W,
			disabled: m,
			style: {
				fontSize: 12,
				padding: "4px 10px",
				borderRadius: 6,
				border: "1px solid var(--border, #30363d)",
				background: "transparent",
				color: "var(--text-primary, #c9d1d9)",
				cursor: m ? "default" : "pointer"
			}
		}, m ? "Loading…" : "Refresh")), X = a("div", { style: {
			display: "flex",
			gap: 4,
			padding: "8px 12px",
			borderBottom: "1px solid var(--border, #21262d)"
		} }, ...E.map((e) => a("button", {
			key: e.id,
			type: "button",
			onClick: () => {
				D(null), N(null), y(e.id);
			},
			style: {
				fontSize: 12,
				fontWeight: 600,
				padding: "4px 12px",
				borderRadius: 6,
				border: "none",
				background: v === e.id ? "var(--bg-elevated, #21262d)" : "transparent",
				color: v === e.id ? "var(--text-primary, #c9d1d9)" : "var(--text-muted, #8b949e)",
				cursor: "pointer"
			}
		}, e.label))), Z;
		Z = m && !o ? a(l, { text: "Reading ~/.zana…" }) : c ? a("div", { style: {
			padding: 24,
			color: "#f85149",
			fontSize: 13
		} }, `Couldn't read the global Zana workspace — ${c}`) : !o || !o.present ? a(l, { text: "No global Zana workspace found at ~/.zana. Run a Zana team or create a profile to populate it." }) : v === "overview" ? a(d, { data: o }) : v === "teams" ? w ? a(p, {
			initial: w,
			profiles: O,
			onSaved: () => {
				D(null), W();
			},
			onCancel: () => D(null)
		}) : a(h, {
			teams: o.teams,
			onOpen: H,
			onNew: G,
			onEdit: K
		}) : v === "profiles" ? M ? a(b, {
			initial: M,
			onSaved: () => {
				N(null), W();
			},
			onCancel: () => N(null)
		}) : a(x, {
			profiles: o.profiles,
			onOpen: H,
			onNew: q,
			onEdit: J
		}) : v === "skills" ? a(S, {
			skills: o.skills,
			onOpen: H
		}) : a(C, {
			runs: o.runs,
			onOpen: H
		});
		let Q = o && o.warnings.length > 0 ? a("div", { style: {
			padding: "6px 16px",
			fontSize: 11,
			color: "#d29922"
		} }, `Partial read — ${o.warnings.length} file(s) skipped.`) : null;
		return a("div", { style: {
			gridColumn: "2 / -1",
			minWidth: 0,
			height: "100%",
			display: "flex",
			flexDirection: "column",
			overflow: "hidden",
			background: "var(--bg-base, #0d1117)",
			position: "relative"
		} }, Y, X, Q, a("div", { style: {
			flex: 1,
			overflowY: "auto"
		} }, Z), P ? a(T, {
			title: P.title,
			icon: P.icon,
			detail: I,
			loading: R,
			error: B,
			onClose: U
		}) : null);
	}
	return {
		panel: D,
		navBadge: (e) => {
			let t = e.cache.get("overview");
			if (!t) return null;
			let n = Object.entries(t.runStateCounts).filter(([e]) => e.toLowerCase().includes("run")).reduce((e, [, t]) => e + t, 0);
			return n > 0 ? n : null;
		}
	};
} };
//#endregion
export { e as default };
