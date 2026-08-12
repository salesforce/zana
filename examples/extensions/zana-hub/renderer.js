const ye = {
  activate({ React: H, host: w }) {
    const { useState: b, useEffect: q, useCallback: W } = H, e = H.createElement;
    function V(o) {
      const t = o.toLowerCase();
      return t.includes("run") ? "#3fb950" : t.includes("err") || t.includes("fail") ? "#f85149" : t.includes("done") || t.includes("complete") ? "#58a6ff" : "#8b949e";
    }
    function N(o) {
      return e(
        "span",
        {
          style: {
            display: "inline-block",
            padding: "1px 8px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.7,
            color: o.subtle ? o.color : "#0d1117",
            background: o.subtle ? "transparent" : o.color,
            border: `1px solid ${o.color}`,
            whiteSpace: "nowrap"
          }
        },
        o.text
      );
    }
    function B(o) {
      return e(
        "div",
        {
          style: {
            flex: "1 1 130px",
            minWidth: 130,
            padding: "14px 16px",
            borderRadius: 10,
            background: "var(--bg-elevated, #161b22)",
            border: "1px solid var(--border, #30363d)"
          }
        },
        e("div", { style: { fontSize: 26, fontWeight: 700, lineHeight: 1.1 } }, String(o.value)),
        e("div", { style: { fontSize: 12, color: "var(--text-muted, #8b949e)", marginTop: 4 } }, o.label),
        o.hint ? e("div", { style: { fontSize: 11, color: "var(--text-muted, #8b949e)", marginTop: 2 } }, o.hint) : null
      );
    }
    function E(o) {
      return e(
        "div",
        { style: { padding: 24, color: "var(--text-muted, #8b949e)", fontSize: 13 } },
        o.text
      );
    }
    function M(o) {
      const [t, s] = b(!1), l = !!o.onClick;
      return e(
        "div",
        {
          onClick: o.onClick,
          onMouseEnter: l ? () => s(!0) : void 0,
          onMouseLeave: l ? () => s(!1) : void 0,
          role: l ? "button" : void 0,
          tabIndex: l ? 0 : void 0,
          onKeyDown: l ? (a) => {
            (a.key === "Enter" || a.key === " ") && (a.preventDefault(), o.onClick());
          } : void 0,
          style: {
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border, #21262d)",
            cursor: l ? "pointer" : "default",
            background: t ? "var(--surface-2, #161b22)" : "transparent"
          }
        },
        e(
          "div",
          { style: { flex: 1, minWidth: 0 } },
          e("div", { style: { fontSize: 13, fontWeight: 600 } }, o.left),
          o.sub ? e("div", { style: { fontSize: 11, color: "var(--text-muted, #8b949e)", marginTop: 2 } }, o.sub) : null
        ),
        o.right ? e("div", { style: { flexShrink: 0 } }, o.right) : null,
        l ? e("div", { style: { flexShrink: 0, color: "var(--muted, #8b949e)", fontSize: 14, opacity: t ? 1 : 0.4 } }, "›") : null
      );
    }
    function Z(o) {
      const t = o.data, s = Object.entries(t.runStateCounts).sort((l, a) => a[1] - l[1]);
      return e(
        "div",
        { style: { padding: 16, display: "flex", flexDirection: "column", gap: 18 } },
        e(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: 12 } },
          e(B, { label: "Teams", value: t.teams.length }),
          e(B, { label: "Profiles", value: t.profiles.length }),
          e(B, { label: "Skills", value: t.skills.length }),
          e(B, { label: "Sprints", value: t.sprints.length }),
          e(B, { label: "Workers", value: t.workerCount }),
          e(B, { label: "Autopilot goals", value: t.autopilotGoalCount })
        ),
        e(
          "div",
          null,
          e(
            "div",
            { style: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted, #8b949e)", marginBottom: 8 } },
            "Agent runs"
          ),
          s.length === 0 ? e(E, { text: "No agent runs recorded yet." }) : e(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
            ...s.map(
              ([l, a]) => e(N, { key: l, text: `${l} · ${a}`, color: V(l), subtle: !0 })
            )
          )
        )
      );
    }
    function G() {
      return { name: "", slots: [{ profileId: "", quantity: 1 }] };
    }
    function Y(o) {
      const [t, s] = b(o.initial), [l, a] = b(!1), [y, g] = b(null), r = (n) => s((u) => ({ ...u, ...n })), c = (n, u) => s((z) => ({ ...z, slots: z.slots.map((S, A) => A === n ? { ...S, ...u } : S) })), $ = () => s((n) => ({ ...n, slots: [...n.slots, { profileId: "", quantity: 1 }] })), m = (n) => s((u) => ({ ...u, slots: u.slots.filter((z, S) => S !== n) })), k = new Set(o.profiles.map((n) => n.id)), P = [t.orchestratorProfileId, ...t.slots.map((n) => n.profileId)].filter(
        (n) => !!n && !k.has(n)
      ), O = [
        ...o.profiles,
        ...P.map((n) => ({ id: n, displayName: `⚠ unknown: ${n}` }))
      ], i = () => {
        a(!0), g(null), w.call("saveTeam", t).then((n) => {
          n.ok ? o.onSaved() : g(n.error);
        }).catch((n) => g(n instanceof Error ? n.message : String(n))).finally(() => a(!1));
      }, x = { fontSize: 11, fontWeight: 600, color: "var(--text-muted, #8b949e)", marginBottom: 4 }, v = {
        width: "100%",
        boxSizing: "border-box",
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid var(--border, #30363d)",
        background: "var(--bg-input, #161b22)",
        color: "var(--text-primary, #c9d1d9)",
        fontSize: 13
      }, h = (n, u) => e("div", { style: { marginBottom: 12 } }, e("div", { style: x }, n), u), C = (n, u, z) => e(
        "select",
        {
          value: n ?? "",
          onChange: (S) => u(S.target.value),
          style: v
        },
        e("option", { key: "", value: "" }, "— select profile —"),
        ...O.map((S) => e("option", { key: S.id, value: S.id }, S.displayName))
      );
      return e(
        "div",
        { style: { padding: 16, maxWidth: 720 } },
        y ? e("div", { style: { color: "#f85149", fontSize: 12, marginBottom: 12 } }, y) : null,
        h(
          "Name",
          e("input", {
            type: "text",
            value: t.name,
            placeholder: "Backend Squad",
            onChange: (n) => r({ name: n.target.value }),
            style: v
          })
        ),
        h(
          "Icon (emoji)",
          e("input", {
            type: "text",
            value: t.icon ?? "",
            placeholder: "⚙️",
            onChange: (n) => r({ icon: n.target.value }),
            style: { ...v, width: 80 }
          })
        ),
        h(
          "Description",
          e("textarea", {
            value: t.description ?? "",
            rows: 2,
            onChange: (n) => r({ description: n.target.value }),
            style: v
          })
        ),
        h("Orchestrator", C(t.orchestratorProfileId, (n) => r({ orchestratorProfileId: n }))),
        // Slots
        e("div", { style: x }, "Roster slots"),
        ...t.slots.map(
          (n, u) => e(
            "div",
            { key: String(u), style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 } },
            e("div", { style: { flex: 1 } }, C(n.profileId, (z) => c(u, { profileId: z }))),
            e("input", {
              type: "number",
              min: 1,
              value: n.quantity,
              onChange: (z) => c(u, { quantity: Math.max(1, parseInt(z.target.value || "1", 10) || 1) }),
              style: { ...v, width: 72 }
            }),
            e(
              "button",
              {
                type: "button",
                onClick: () => m(u),
                disabled: t.slots.length <= 1,
                style: {
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border, #30363d)",
                  background: "transparent",
                  color: "var(--text-muted, #8b949e)",
                  cursor: t.slots.length <= 1 ? "default" : "pointer"
                }
              },
              "Remove"
            )
          )
        ),
        e(
          "button",
          {
            type: "button",
            onClick: $,
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
          },
          "+ Add slot"
        ),
        h(
          "Initial prompt",
          e("textarea", {
            value: t.initialPrompt ?? "",
            rows: 6,
            onChange: (n) => r({ initialPrompt: n.target.value }),
            style: v
          })
        ),
        h(
          "Max concurrent workers",
          e("input", {
            type: "number",
            min: 1,
            value: t.maxConcurrentWorkers ?? "",
            placeholder: "default: total slots",
            onChange: (n) => {
              const u = parseInt(n.target.value, 10);
              r({ maxConcurrentWorkers: Number.isInteger(u) && u >= 1 ? u : void 0 });
            },
            style: { ...v, width: 120 }
          })
        ),
        e(
          "label",
          { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 16 } },
          e("input", {
            type: "checkbox",
            checked: t.autoStart === !0,
            onChange: (n) => r({ autoStart: n.target.checked })
          }),
          "Auto-start"
        ),
        // Actions
        e(
          "div",
          { style: { display: "flex", gap: 8 } },
          e(
            "button",
            {
              type: "button",
              onClick: i,
              disabled: l,
              style: {
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 16px",
                borderRadius: 6,
                border: "none",
                background: "#238636",
                color: "#fff",
                cursor: l ? "default" : "pointer"
              }
            },
            l ? "Saving…" : "Save"
          ),
          e(
            "button",
            {
              type: "button",
              onClick: o.onCancel,
              disabled: l,
              style: {
                fontSize: 13,
                padding: "6px 16px",
                borderRadius: 6,
                border: "1px solid var(--border, #30363d)",
                background: "transparent",
                color: "var(--text-primary, #c9d1d9)",
                cursor: "pointer"
              }
            },
            "Cancel"
          )
        )
      );
    }
    function K(o) {
      return e(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px 4px",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: "var(--muted, #8b949e)"
          }
        },
        o.title,
        e(N, { text: String(o.count), color: "#8b949e", subtle: !0 })
      );
    }
    function U(o) {
      const t = e(
        "div",
        { style: { padding: "10px 14px", borderBottom: "1px solid var(--border, #21262d)" } },
        e(
          "button",
          {
            type: "button",
            onClick: o.onNew,
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
          },
          "+ New team"
        )
      );
      if (o.teams.length === 0)
        return e("div", null, t, e(E, { text: "No team templates in ~/.zana/teams." }));
      const s = (l) => e(
        "button",
        {
          type: "button",
          onClick: (a) => {
            a.stopPropagation(), o.onEdit(l);
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
        },
        "Edit"
      );
      return e(
        "div",
        null,
        t,
        ...o.teams.map((l) => {
          const a = `${l.workerTotal} worker${l.workerTotal === 1 ? "" : "s"} · ${l.slots} slot${l.slots === 1 ? "" : "s"}${l.maxWorkers != null ? ` · max ${l.maxWorkers}` : ""}`, y = l.roster ? e(
            "span",
            null,
            a,
            e("span", { style: { color: "var(--muted, #8b949e)", opacity: 0.7 } }, `  —  ${l.roster}`)
          ) : a;
          return e(M, {
            key: l.id,
            onClick: () => o.onOpen("team", l.id),
            left: `${l.icon ? l.icon + " " : ""}${l.name}`,
            sub: l.description ? e("span", null, e("span", { style: { display: "block" } }, l.description), e("span", { style: { display: "block", marginTop: 2 } }, y)) : y,
            right: e(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center" } },
              l.autoStart ? e(N, { text: "auto-start", color: "#3fb950", subtle: !0 }) : null,
              s(l.id)
            )
          });
        })
      );
    }
    function J() {
      return { displayName: "", allowedTools: [], disallowedTools: [] };
    }
    const Q = ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-fable-5"], X = ["low", "medium", "high", "xhigh", "max"], ee = ["default", "plan", "acceptEdits", "bypassPermissions"];
    function te(o) {
      const [t, s] = b(o.initial), [l, a] = b(!1), [y, g] = b(null), r = (i) => s((x) => ({ ...x, ...i })), c = () => {
        a(!0), g(null), w.call("saveProfile", t).then((i) => {
          i.ok ? o.onSaved() : g(i.error);
        }).catch((i) => g(i instanceof Error ? i.message : String(i))).finally(() => a(!1));
      }, $ = { fontSize: 11, fontWeight: 600, color: "var(--text-muted, #8b949e)", marginBottom: 4 }, m = {
        width: "100%",
        boxSizing: "border-box",
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid var(--border, #30363d)",
        background: "var(--bg-input, #161b22)",
        color: "var(--text-primary, #c9d1d9)",
        fontSize: 13
      }, k = (i, x) => e("div", { style: { marginBottom: 12 } }, e("div", { style: $ }, i), x), P = (i, x, v) => {
        const h = i && !x.includes(i) ? [i] : [];
        return e(
          "select",
          {
            value: i ?? "",
            onChange: (C) => v(C.target.value),
            style: m
          },
          e("option", { key: "", value: "" }, "— default —"),
          ...[...x, ...h].map((C) => e("option", { key: C, value: C }, C))
        );
      }, O = (i, x, v) => k(
        i,
        e("textarea", {
          value: x.join(`
`),
          rows: 5,
          placeholder: `One tool per line — e.g.
Read
Grep
mcp__plugin_codesearch_codesearch__*`,
          onChange: (h) => v(h.target.value.split(`
`)),
          style: { ...m, fontFamily: "var(--font-mono, monospace)" }
        })
      );
      return e(
        "div",
        { style: { padding: 16, maxWidth: 720 } },
        y ? e("div", { style: { color: "#f85149", fontSize: 12, marginBottom: 12 } }, y) : null,
        k(
          "Name",
          e("input", {
            type: "text",
            value: t.displayName,
            placeholder: "Core Architect",
            onChange: (i) => r({ displayName: i.target.value }),
            style: m
          })
        ),
        e(
          "div",
          { style: { display: "flex", gap: 12 } },
          e("div", { style: { width: 80 } }, k(
            "Icon (emoji)",
            e("input", {
              type: "text",
              value: t.icon ?? "",
              placeholder: "📐",
              onChange: (i) => r({ icon: i.target.value }),
              style: m
            })
          )),
          e("div", { style: { flex: 1 } }, k(
            "Category",
            e("input", {
              type: "text",
              value: t.category ?? "",
              placeholder: "engineering",
              onChange: (i) => r({ category: i.target.value }),
              style: m
            })
          ))
        ),
        k(
          "Description",
          e("textarea", {
            value: t.description ?? "",
            rows: 2,
            onChange: (i) => r({ description: i.target.value }),
            style: m
          })
        ),
        e(
          "div",
          { style: { display: "flex", gap: 12 } },
          e("div", { style: { flex: 1 } }, k("Model", P(t.model, Q, (i) => r({ model: i })))),
          e("div", { style: { flex: 1 } }, k("Effort", P(t.effortLevel, X, (i) => r({ effortLevel: i })))),
          e("div", { style: { flex: 1 } }, k("Permission mode", P(t.permissionMode, ee, (i) => r({ permissionMode: i }))))
        ),
        k(
          "System prompt",
          e("textarea", {
            value: t.systemPrompt ?? "",
            rows: 8,
            onChange: (i) => r({ systemPrompt: i.target.value }),
            style: m
          })
        ),
        O("Allowed tools", t.allowedTools, (i) => r({ allowedTools: i })),
        O("Disallowed tools", t.disallowedTools, (i) => r({ disallowedTools: i })),
        // Actions
        e(
          "div",
          { style: { display: "flex", gap: 8 } },
          e(
            "button",
            {
              type: "button",
              onClick: c,
              disabled: l,
              style: {
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 16px",
                borderRadius: 6,
                border: "none",
                background: "#238636",
                color: "#fff",
                cursor: l ? "default" : "pointer"
              }
            },
            l ? "Saving…" : "Save"
          ),
          e(
            "button",
            {
              type: "button",
              onClick: o.onCancel,
              disabled: l,
              style: {
                fontSize: 13,
                padding: "6px 16px",
                borderRadius: 6,
                border: "1px solid var(--border, #30363d)",
                background: "transparent",
                color: "var(--text-primary, #c9d1d9)",
                cursor: "pointer"
              }
            },
            "Cancel"
          )
        )
      );
    }
    function oe(o) {
      const t = e(
        "div",
        { style: { padding: "10px 14px", borderBottom: "1px solid var(--border, #21262d)" } },
        e(
          "button",
          {
            type: "button",
            onClick: o.onNew,
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
          },
          "+ New profile"
        )
      );
      if (o.profiles.length === 0)
        return e("div", null, t, e(E, { text: "No profiles in ~/.zana/profiles." }));
      const s = (g) => e(
        "button",
        {
          type: "button",
          onClick: (r) => {
            r.stopPropagation(), o.onEdit(g);
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
        },
        "Edit"
      ), l = [], a = /* @__PURE__ */ new Map();
      for (const g of o.profiles) {
        const r = g.category && g.category.trim() ? g.category : "Uncategorized";
        let c = a.get(r);
        c || (c = [], a.set(r, c), l.push([r, c])), c.push(g);
      }
      const y = l.length > 1;
      return e(
        "div",
        null,
        t,
        ...l.flatMap(([g, r]) => [
          y ? e(K, { key: `h:${g}`, title: g, count: r.length }) : null,
          ...r.map(
            (c) => e(M, {
              key: c.id,
              onClick: () => o.onOpen("profile", c.id),
              left: `${c.icon ? c.icon + " " : ""}${c.name}`,
              sub: c.description || void 0,
              right: e(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center" } },
                c.model ? e(N, { text: c.model, color: "#8b949e", subtle: !0 }) : null,
                s(c.id)
              )
            })
          )
        ])
      );
    }
    function le(o) {
      return o.skills.length === 0 ? e(E, { text: "No skills in ~/.zana/skills." }) : e(
        "div",
        null,
        ...o.skills.map(
          (t) => e(M, {
            key: t.id,
            onClick: () => o.onOpen("skill", t.id),
            left: t.name,
            sub: t.description || void 0,
            right: e(
              "div",
              { style: { display: "flex", gap: 6, alignItems: "center" } },
              t.type ? e(N, { text: t.type, color: "#8b949e", subtle: !0 }) : null,
              e(N, {
                text: t.enabled ? "enabled" : "disabled",
                color: t.enabled ? "#3fb950" : "#8b949e",
                subtle: !0
              })
            )
          })
        )
      );
    }
    function ne(o) {
      return o.runs.length === 0 ? e(E, { text: "No recent agent runs in ~/.zana/runs." }) : e(
        "div",
        null,
        ...o.runs.map(
          (t) => e(M, {
            key: t.id,
            onClick: () => o.onOpen("run", t.id),
            left: `${t.profileIcon ? t.profileIcon + " " : ""}${t.profileName ?? t.id.slice(0, 8)}`,
            sub: [t.mode, t.model, t.lastAction].filter(Boolean).join(" · ") || void 0,
            right: e(N, { text: t.state, color: V(t.state), subtle: !0 })
          })
        )
      );
    }
    function ie(o) {
      return o.block ? e(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 4 } },
        e(
          "div",
          { style: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted, #8b949e)" } },
          o.label
        ),
        e(
          "pre",
          {
            style: {
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
            }
          },
          o.value
        )
      ) : e(
        "div",
        { style: { display: "flex", gap: 12, alignItems: "baseline" } },
        e(
          "div",
          { style: { flex: "0 0 120px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted, #8b949e)" } },
          o.label
        ),
        e("div", { style: { flex: 1, minWidth: 0, fontSize: 13, wordBreak: "break-word" } }, o.value)
      );
    }
    function re(o) {
      return e(
        "div",
        {
          onClick: o.onClose,
          style: {
            position: "absolute",
            inset: 0,
            display: "flex",
            justifyContent: "flex-end",
            background: "rgba(1, 4, 9, 0.55)",
            zIndex: 10
          }
        },
        e(
          "div",
          {
            onClick: (t) => t.stopPropagation(),
            style: {
              width: "min(560px, 92%)",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-base, #0d1117)",
              borderLeft: "1px solid var(--border, #30363d)",
              boxShadow: "-8px 0 24px rgba(1, 4, 9, 0.4)"
            }
          },
          // Drawer header.
          e(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                borderBottom: "1px solid var(--border, #30363d)"
              }
            },
            e("div", { style: { fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0 } }, `${o.icon ? o.icon + " " : ""}${o.title}`),
            e(
              "button",
              {
                type: "button",
                onClick: o.onClose,
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
              },
              "✕"
            )
          ),
          // Drawer body.
          e(
            "div",
            { style: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 } },
            o.error ? e("div", { style: { color: "#f85149", fontSize: 13 } }, o.error) : o.loading || !o.detail ? e(E, { text: "Loading…" }) : o.detail.fields.length === 0 ? e(E, { text: "No further detail recorded for this item." }) : o.detail.fields.map(
              (t, s) => e(ie, { key: `${t.label}:${s}`, label: t.label, value: t.value, block: t.block })
            )
          )
        )
      );
    }
    const ae = [
      { id: "overview", label: "Overview" },
      { id: "teams", label: "Teams" },
      { id: "profiles", label: "Profiles" },
      { id: "skills", label: "Skills" },
      { id: "runs", label: "Runs" }
    ];
    function de(o) {
      const [t, s] = b(null), [l, a] = b(null), [y, g] = b(!0), [r, c] = b("overview"), [$, m] = b(null), [k, P] = b([]), [O, i] = b(!1), [x, v] = b(null), [h, C] = b(null), [n, u] = b(null), [z, S] = b(!1), [A, F] = b(null), _ = W((d, f) => {
        const T = w.cache.get("overview");
        let L = f, j;
        if (T)
          if (d === "team") {
            const p = T.teams.find((R) => R.id === f);
            p && (L = p.name, j = p.icon);
          } else if (d === "profile") {
            const p = T.profiles.find((R) => R.id === f);
            p && (L = p.name, j = p.icon);
          } else if (d === "skill") {
            const p = T.skills.find((R) => R.id === f);
            p && (L = p.name);
          } else {
            const p = T.runs.find((R) => R.id === f);
            p && (L = p.profileName ?? f.slice(0, 8), j = p.profileIcon);
          }
        C({ kind: d, id: f, title: L, icon: j }), u(null), F(null), S(!0), w.call("detail", d, f).then((p) => {
          p ? u(p) : F("This record could not be read (it may have been removed).");
        }).catch((p) => F(p instanceof Error ? p.message : String(p))).finally(() => S(!1));
      }, []), se = W(() => C(null), []), D = W(() => {
        g(!0), a(null), w.call("overview").then((d) => {
          s(d), w.cache.set("overview", d);
        }).catch((d) => a(d instanceof Error ? d.message : String(d))).finally(() => g(!1));
      }, []), ce = W(() => {
        i(!0), w.call("listProfiles").then((d) => P(d)).catch(() => P([])).finally(() => {
          m(G()), i(!1);
        });
      }, []), ue = W((d) => {
        i(!0), Promise.all([
          w.call("listProfiles").catch(() => []),
          w.call("getTeam", d)
        ]).then(([f, T]) => {
          P(f), T ? m(T.template) : a("That team template is no longer readable.");
        }).catch((f) => a(f instanceof Error ? f.message : String(f))).finally(() => i(!1));
      }, []), fe = W(() => {
        v(J());
      }, []), pe = W((d) => {
        i(!0), w.call("getProfile", d).then((f) => {
          f ? v(f.template) : a("That profile is no longer readable.");
        }).catch((f) => a(f instanceof Error ? f.message : String(f))).finally(() => i(!1));
      }, []);
      q(() => {
        D();
      }, [D]);
      const ge = e(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border, #30363d)"
          }
        },
        e("div", { style: { fontSize: 15, fontWeight: 700, flex: 1 } }, "Zana — global"),
        w.getActiveProject() ? e("div", { style: { fontSize: 11, color: "var(--text-muted, #8b949e)" } }, "cross-project · ~/.zana") : null,
        e(
          "button",
          {
            type: "button",
            onClick: D,
            disabled: y,
            style: {
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--border, #30363d)",
              background: "transparent",
              color: "var(--text-primary, #c9d1d9)",
              cursor: y ? "default" : "pointer"
            }
          },
          y ? "Loading…" : "Refresh"
        )
      ), be = e(
        "div",
        { style: { display: "flex", gap: 4, padding: "8px 12px", borderBottom: "1px solid var(--border, #21262d)" } },
        ...ae.map(
          (d) => e(
            "button",
            {
              key: d.id,
              type: "button",
              onClick: () => {
                m(null), v(null), c(d.id);
              },
              style: {
                fontSize: 12,
                fontWeight: 600,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                background: r === d.id ? "var(--bg-elevated, #21262d)" : "transparent",
                color: r === d.id ? "var(--text-primary, #c9d1d9)" : "var(--text-muted, #8b949e)",
                cursor: "pointer"
              }
            },
            d.label
          )
        )
      );
      let I;
      y && !t ? I = e(E, { text: "Reading ~/.zana…" }) : l ? I = e(
        "div",
        { style: { padding: 24, color: "#f85149", fontSize: 13 } },
        `Couldn't read the global Zana workspace — ${l}`
      ) : !t || !t.present ? I = e(
        E,
        { text: "No global Zana workspace found at ~/.zana. Run a Zana team or create a profile to populate it." }
      ) : r === "overview" ? I = e(Z, { data: t }) : r === "teams" ? I = $ ? e(Y, {
        initial: $,
        profiles: k,
        onSaved: () => {
          m(null), D();
        },
        onCancel: () => m(null)
      }) : e(U, {
        teams: t.teams,
        onOpen: _,
        onNew: ce,
        onEdit: ue
      }) : r === "profiles" ? I = x ? e(te, {
        initial: x,
        onSaved: () => {
          v(null), D();
        },
        onCancel: () => v(null)
      }) : e(oe, {
        profiles: t.profiles,
        onOpen: _,
        onNew: fe,
        onEdit: pe
      }) : r === "skills" ? I = e(le, { skills: t.skills, onOpen: _ }) : I = e(ne, { runs: t.runs, onOpen: _ });
      const ve = t && t.warnings.length > 0 ? e(
        "div",
        { style: { padding: "6px 16px", fontSize: 11, color: "#d29922" } },
        `Partial read — ${t.warnings.length} file(s) skipped.`
      ) : null;
      return e(
        "div",
        {
          style: {
            // The app shell is a 3-column CSS grid (nav · list · content). A
            // module panel must span the content area explicitly — exactly like
            // core's .cu-panel (`grid-column: 2 / -1`) — or it collapses into a
            // single auto-sized track (the cramped middle column bug).
            gridColumn: "2 / -1",
            minWidth: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--bg-base, #0d1117)",
            // Anchor for the absolutely-positioned detail drawer overlay.
            position: "relative"
          }
        },
        ge,
        be,
        ve,
        e("div", { style: { flex: 1, overflowY: "auto" } }, I),
        h ? e(re, {
          title: h.title,
          icon: h.icon,
          detail: n,
          loading: z,
          error: A,
          onClose: se
        }) : null
      );
    }
    return {
      panel: de,
      // Sidebar badge: running agents (read from the last overview the panel
      // stashed). Cheap + synchronous — null when nothing is running.
      navBadge: (o) => {
        const t = o.cache.get("overview");
        if (!t) return null;
        const s = Object.entries(t.runStateCounts).filter(([l]) => l.toLowerCase().includes("run")).reduce((l, [, a]) => l + a, 0);
        return s > 0 ? s : null;
      }
    };
  }
};
export {
  ye as default
};
