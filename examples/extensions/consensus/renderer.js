const he = {
  activate({ React: K, host: R }) {
    const { useState: I, useEffect: H, useCallback: W, useRef: V, useMemo: q } = K, t = K.createElement;
    function J(n) {
      const e = (n || "").toLowerCase();
      return /\breject|\bblock|contre|against/.test(e) ? "reject" : e.startsWith("changes") || e.includes("condition") || e.includes("escalat") ? "conditions" : "approve";
    }
    function _(n) {
      const e = (n || "").toLowerCase();
      return /reject|block|contre|against|veto/.test(e) ? "reject" : /change|revise|rework|condition|abstain|escalat|defer|neutral/.test(e) ? "conditions" : "approve";
    }
    function G(n) {
      return (n || "").split(/[-_ ]+/).filter(Boolean).slice(0, 2).map((e) => e[0].toUpperCase()).join("");
    }
    const v = {
      approve: "#3fb950",
      reject: "#f85149",
      conditions: "#d29922"
    }, O = ["approve", "conditions", "reject"], X = { approve: "FOR", conditions: "CHANGES", reject: "AGAINST" }, Z = { approve: "APPROVED", reject: "REJECTED", conditions: "CONDITIONS" };
    function ee(n, e) {
      const o = (n || "").trim(), i = o.match(/^(.{2,32}?)\s*[—–:-]\s+(.+)$/s);
      return i ? { badge: i[1].trim().toUpperCase(), detail: i[2].trim() } : o.length <= 28 ? { badge: o.toUpperCase(), detail: "" } : { badge: Z[e], detail: o };
    }
    const te = typeof matchMedia == "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    function ne(n, e, o, i, g) {
      const f = n <= 6 ? 1 : n <= 14 ? 2 : n <= 30 ? 3 : n <= 60 ? 5 : 8, h = [];
      for (let r = 0; r < f; r++)
        h.push(e + (f === 1 ? (o - e) * 0.5 : (o - e) * (r / (f - 1))));
      const b = h.reduce((r, u) => r + u, 0), d = h.map((r) => Math.max(1, Math.round(r / b * n)));
      let p = n - d.reduce((r, u) => r + u, 0);
      for (let r = d.length - 1; p !== 0 && r >= 0; r--) {
        const u = p > 0 ? 1 : -1;
        d[r] + u >= 1 && (d[r] += u, p -= u);
      }
      const C = [];
      for (let r = 0; r < f; r++) {
        const u = d[r], E = h[r];
        for (let y = 0; y < u; y++) {
          const w = u === 1 ? 0.5 : y / (u - 1), $ = 0.05, s = Math.PI * (1 - $) - w * Math.PI * (1 - 2 * $);
          C.push({ ang: s, x: i + E * Math.cos(s), y: g - E * Math.sin(s) });
        }
      }
      return C.sort((r, u) => u.ang - r.ang), C.slice(0, n);
    }
    function M(n, e, o, i) {
      return [n + o * Math.cos(i), e - o * Math.sin(i)];
    }
    function oe(n, e, o, i, g) {
      const [f, h] = M(n, e, o, i), [b, d] = M(n, e, o, g), p = Math.abs(g - i) > Math.PI ? 1 : 0;
      return `M ${f} ${h} A ${o} ${o} 0 ${p} 1 ${b} ${d}`;
    }
    const ie = `
      .cx-seat { transition: fill .5s ease, transform .18s cubic-bezier(.2,1.5,.4,1); transform-box: fill-box; transform-origin: center; cursor: pointer; }
      .cx-seat:hover, .cx-seat:focus { transform: scale(1.5); outline: none; }
      .cx-seat.on { filter: drop-shadow(0 0 4px var(--cx-seat-color)); }
      .cx-seat.focused { stroke: var(--fg, #e6edf3); stroke-width: 2; }
      .cx-initial { pointer-events: none; opacity: 0; transition: opacity .4s ease; }
      .cx-initial.show { opacity: 1; }
      .cx-card { transition: transform .12s ease, border-color .15s ease; }
      .cx-card:hover { transform: translateY(-1px); }
      .cx-card.flash { animation: cxflash 1.2s ease; }
      @keyframes cxflash { 0% { box-shadow: 0 0 0 0 ${v.conditions}; } 25% { box-shadow: 0 0 0 3px ${v.conditions}; } 100% { box-shadow: 0 0 0 0 transparent; } }
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
      .cx-row-del:hover, .cx-row-del:focus { opacity: 1 !important; background: color-mix(in srgb, ${v.reject} 22%, transparent);
        color: ${v.reject}; outline: none; }
    `;
    function re(n, e) {
      const [o, i] = I(0), [g, f] = I(!1), h = V([]), b = W(() => {
        if (h.current.forEach((p) => clearTimeout(p)), h.current = [], i(0), f(!1), te || n === 0) {
          i(n), f(!0);
          return;
        }
        const d = n > 20 ? 45 : 85;
        for (let p = 1; p <= n; p++)
          h.current.push(
            window.setTimeout(() => i(p), 160 + (p - 1) * d)
          );
        h.current.push(window.setTimeout(() => f(!0), 160 + n * d + 200));
      }, [n]);
      return H(() => (b(), () => {
        h.current.forEach((d) => clearTimeout(d));
      }), [e]), { revealed: o, landed: g, run: b };
    }
    function se(n) {
      const { votes: e, revealed: o, winBloc: i, focusedIdx: g, onSelect: f } = n, h = 760, b = 400, d = h / 2, p = 330, C = 120, r = 300, u = e.length, E = u <= 6 ? 16 : u <= 14 ? 11 : u <= 30 ? 8 : 6, y = q(
        () => e.map((c, j) => ({ v: c, bloc: _(c.stance), oi: j })).sort((c, j) => O.indexOf(c.bloc) - O.indexOf(j.bloc)),
        [e]
      ), w = q(() => ne(u, C, r, d, p), [u]), $ = { approve: 0, conditions: 0, reject: 0 };
      y.forEach((c) => $[c.bloc]++);
      const s = y.slice(0, o).filter((c) => c.bloc === i).length, l = [], S = r + 26, m = 0.05, P = Math.PI * (1 - m), k = Math.PI * m, N = P - k;
      let A = P;
      O.forEach((c) => {
        const j = $[c] / (u || 1);
        if (j <= 0) return;
        const T = A - j * N;
        l.push(
          t("path", {
            key: `band-${c}`,
            d: oe(d, p, S, A, T),
            fill: "none",
            stroke: v[c],
            strokeWidth: 14,
            opacity: 0.85
          })
        ), A = T;
      });
      const B = P - 0.5 * N, [z, U] = M(d, p, S - 12, B), [a, x] = M(d, p, S + 12, B);
      l.push(
        t("line", { key: "tick", x1: z, y1: U, x2: a, y2: x, stroke: "var(--fg, #e6edf3)", strokeWidth: 1.5, strokeDasharray: "3 3", opacity: 0.5 })
      );
      const [L, D] = M(d, p, S + 24, B);
      return l.push(t("text", { key: "ticklabel", x: L, y: D - 2, fill: "var(--fg-dim, #8b949e)", fontSize: 9.5, textAnchor: "middle" }, "50%")), l.push(t("rect", { key: "podium", x: d - 26, y: p + 12, width: 52, height: 10, rx: 3, fill: "var(--border, #30363d)" })), y.forEach((c, j) => {
        const T = w[j];
        if (!T) return;
        const Y = j < o, ue = Y ? v[c.bloc] : "var(--seat-empty, #2d333b)", fe = g === c.oi, Q = [
          t("circle", {
            key: "c",
            cx: T.x,
            cy: T.y,
            r: E,
            className: "cx-seat" + (Y ? " on" : "") + (fe ? " focused" : ""),
            fill: ue,
            stroke: "rgba(0,0,0,.3)",
            strokeWidth: 0.5,
            tabIndex: 0,
            role: "button",
            "aria-label": `${c.v.voter}: ${c.v.stance}`,
            style: { "--cx-seat-color": v[c.bloc] },
            onClick: () => f(c.oi),
            onKeyDown: (F) => {
              (F.key === "Enter" || F.key === " ") && (F.preventDefault(), f(c.oi));
            }
          }, t("title", null, `${c.v.voter} — ${c.v.stance}`))
        ];
        E >= 11 && Q.push(
          t("text", {
            key: "t",
            x: T.x,
            y: T.y,
            className: "cx-initial" + (Y ? " show" : ""),
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 8,
            fontWeight: 700,
            fill: "rgba(0,0,0,.55)"
          }, G(c.v.voter))
        ), l.push(t("g", { key: `seat-${j}` }, ...Q));
      }), l.push(
        t("text", { key: "bignum", x: d, y: p - 22, textAnchor: "middle", fill: v[i], fontSize: 34, fontWeight: 800 }, String(s))
      ), l.push(
        t("text", { key: "bigof", x: d, y: p + 2, textAnchor: "middle", fill: "var(--fg-dim, #8b949e)", fontSize: 11, letterSpacing: 1 }, `of ${u} voters`)
      ), t(
        "svg",
        {
          viewBox: `0 0 ${h} ${b}`,
          role: "img",
          "aria-label": `Hemicycle: ${u} voters. ` + O.map((c) => `${$[c]} ${c}`).join(", "),
          style: { display: "block", width: "100%", maxWidth: 760, margin: "4px auto 0", overflow: "visible" }
        },
        ...l
      );
    }
    function ae(n) {
      const e = n.votes.map((i) => `  - ${i.voter} [${i.stance}]: ${i.rationale}`).join(`
`), o = [
        "{",
        `  "sourceId": ${JSON.stringify(n.id)},`,
        n.projectId ? `  "projectId": ${JSON.stringify(n.projectId)},` : "",
        `  "question": ${JSON.stringify(n.question)},`,
        '  "verdict": "<short head — e.g. APPROVE — followed by the decision detail>",',
        `  "synthesis": "<the judge's synthesis / ruling>",`,
        '  "roster": "<who voted / how chosen>",',
        '  "votes": [ { "voter": "<id>", "stance": "APPROVE|CHANGES|CONDITIONS|REJECT", "rationale": "<verbatim>" } ],',
        '  "dissent": ["<verbatim minority points, if any>"]',
        "}"
      ].filter((i) => i !== "").join(`
`);
      return [
        "Re-analyse a prior council decision by convening a FRESH council on the same question, then record the new verdict.",
        "",
        "QUESTION:",
        n.question,
        "",
        `PRIOR VERDICT: ${n.verdict}`,
        n.roster ? `PRIOR ROSTER: ${n.roster}` : "",
        "PRIOR VOTES:",
        e,
        n.synthesis ? `
PRIOR SYNTHESIS: ${n.synthesis}` : "",
        "",
        "STEP 1 — Run the council. Use the /zana:council skill (or the zana_deliberate MCP tool) on the QUESTION above. Let voters reach their own stances; do NOT just echo the prior verdict.",
        "",
        "STEP 2 — Record the result as a Zana artifact. Call the zana_artifact_create MCP tool with:",
        '  - type: "decision-record"',
        '  - tags: ["consensus-reanalysis"]   (REQUIRED — the Consensus panel folds in exactly this tag)',
        "  - title: a short summary of the decision",
        "  - content: a JSON string matching this shape EXACTLY:",
        "",
        o,
        "",
        "Create ONLY that one artifact as your final action. The Consensus panel will fold it in (and remove the artifact) automatically once you finish."
      ].filter((i) => i !== "").join(`
`);
    }
    function ce(n) {
      return t("span", {
        style: {
          display: "inline-block",
          padding: "1px 8px",
          borderRadius: 999,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 0.3,
          color: n.color,
          border: `1px solid ${n.color}`,
          whiteSpace: "nowrap"
        }
      }, n.text);
    }
    function le(n) {
      const { vote: e } = n, o = _(e.stance), i = v[o], g = n.flashKey === n.idx;
      return t(
        "div",
        {
          id: `cx-card-${n.recordId}-${n.idx}`,
          className: "cx-card" + (g ? " flash" : ""),
          onClick: n.onClick,
          style: {
            border: "1px solid var(--border, #30363d)",
            borderLeft: `3px solid ${i}`,
            borderRadius: 8,
            padding: "11px 13px",
            marginBottom: 0,
            background: "var(--bg-elevated, rgba(255,255,255,0.02))",
            scrollMarginTop: 16,
            cursor: "pointer"
          }
        },
        t(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
          t("span", {
            style: {
              width: 18,
              height: 18,
              borderRadius: 999,
              display: "inline-grid",
              placeItems: "center",
              fontSize: 9,
              fontWeight: 700,
              color: "#0d1117",
              background: i
            }
          }, G(e.voter)),
          t("strong", { style: { fontSize: 13 } }, e.voter),
          t("span", { style: { marginLeft: "auto" } }, t(ce, { text: e.stance.toUpperCase(), color: i }))
        ),
        t("div", { style: { fontSize: 12.5, lineHeight: 1.55, opacity: 0.92 } }, e.rationale)
      );
    }
    function de(n) {
      const { record: e, host: o, onReanalysed: i } = n, g = J(e.verdict), f = v[g], h = e.votes.length, { revealed: b, landed: d, run: p } = re(h, e.id), [C, r] = I(null), [u, E] = I(null), [y, w] = I("idle"), $ = V(null), s = V(null), l = W(async () => {
        if (y === "idle") {
          w("launching");
          try {
            const a = (o.getScopedProjectId() ? o.listProjects().find((c) => c.id === o.getScopedProjectId()) : void 0) ?? o.getActiveProject() ?? void 0, x = o.getScopedProjectId() ?? e.projectId ?? (a == null ? void 0 : a.id);
            if (!x) {
              o.toast("Re-analyse needs a project — open this decision under its project tab", "error"), w("idle");
              return;
            }
            s.current = (a == null ? void 0 : a.path) ?? null;
            const L = ae(e), D = await o.launchSession({
              projectId: x,
              title: `Re-analyse: ${e.question.slice(0, 40)}`,
              extraArgs: [L]
            });
            if (!D) {
              o.toast("Could not launch the re-analysis session", "error"), w("idle");
              return;
            }
            $.current = D.id, w("running"), o.toast("Council re-analysis launched — its verdict will appear here when it settles", "info");
          } catch (a) {
            o.toast(`Re-analyse failed: ${a instanceof Error ? a.message : String(a)}`, "error"), w("idle");
          }
        }
      }, [y, e, o]);
      H(() => y !== "running" ? void 0 : o.on("session:agentStatus", ({ sessionId: x, state: L }) => {
        if (x === $.current && (L === "idle" || L === "done")) {
          w("ingesting");
          const D = s.current ?? void 0;
          o.call("ingest", { projectPath: D }).then((c) => {
            c.ingested > 0 && o.toast(`Folded in ${c.ingested} re-analysis verdict${c.ingested > 1 ? "s" : ""}`, "info"), i();
          }).catch(() => {
          }).finally(() => {
            w("idle"), $.current = null, s.current = null;
          });
        }
      }), [y, o, i]);
      const S = W((a) => {
        r(a), E(null), window.setTimeout(() => E(a), 0);
        const x = document.getElementById(`cx-card-${e.id}-${a}`);
        x && x.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, [e.id]), m = q(
        () => e.votes.map((a) => _(a.stance)).sort((a, x) => O.indexOf(a) - O.indexOf(x)),
        [e.votes]
      ), P = { approve: 0, conditions: 0, reject: 0 };
      m.slice(0, b).forEach((a) => P[a]++);
      const k = [];
      k.push(t("h2", { key: "q", style: { fontSize: 18, margin: "0 0 14px", lineHeight: 1.4, maxWidth: 820 } }, e.question));
      const { badge: N, detail: A } = ee(e.verdict, g), B = O.map(
        (a) => t(
          "span",
          { key: a, style: { display: "inline-flex", alignItems: "center", gap: 6 } },
          t("span", { style: { width: 10, height: 10, borderRadius: 3, background: v[a], boxShadow: `0 0 6px ${v[a]}` } }),
          t("span", { style: { fontVariantNumeric: "tabular-nums" } }, String(P[a])),
          t("span", { style: { opacity: 0.85 } }, " " + X[a])
        )
      );
      k.push(
        t(
          "div",
          {
            key: "banner",
            style: {
              padding: "16px 20px",
              borderRadius: 12,
              marginBottom: 6,
              border: "1px solid var(--border, #30363d)",
              borderLeft: `5px solid ${f}`,
              background: "var(--bg-elevated, rgba(255,255,255,0.03))"
            }
          },
          // top row: BIG BADGE + tally + meta
          t(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" } },
            t(
              "div",
              {
                className: "cx-verdict" + (d ? " landed" : ""),
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 999,
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  lineHeight: 1,
                  color: f,
                  background: `color-mix(in srgb, ${f} 16%, transparent)`,
                  border: `1.5px solid ${f}`,
                  whiteSpace: "nowrap"
                }
              },
              t("span", { className: "cx-gavel" + (d ? " landed" : ""), style: { fontSize: 18 } }, "⚖️"),
              N
            ),
            t("div", {
              title: `Voter stances. The verdict is the judge's reasoned synthesis of the rationales — not a majority count, so "CHANGES" votes (qualified support) can still settle as APPROVE.`,
              style: { display: "flex", gap: 16, fontSize: 13, fontWeight: 600, cursor: "help" }
            }, ...B),
            t(
              "div",
              { style: { marginLeft: "auto", fontSize: 11, opacity: 0.6, textAlign: "right", lineHeight: 1.5, whiteSpace: "pre-line" } },
              (e.roster ? e.roster + `
` : "") + (e.settledAt ? "settled " + e.settledAt.slice(0, 10) : "")
            )
          ),
          // decision detail — the actual "what", given room to breathe
          A ? t("div", {
            style: {
              marginTop: 13,
              paddingTop: 13,
              borderTop: "1px solid var(--border, #30363d)",
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.45,
              color: "var(--fg, #e6edf3)",
              maxWidth: 820
            }
          }, A) : null
        )
      );
      const z = y !== "idle", U = y === "launching" ? "Launching…" : y === "running" ? "● Council in session…" : y === "ingesting" ? "Folding in…" : "↻ Re-analyse";
      return k.push(
        t(
          "div",
          { key: "controls", style: { display: "flex", gap: 10, alignItems: "center", margin: "16px 0 0", flexWrap: "wrap" } },
          t("button", {
            onClick: () => p(),
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
          }, "▸ Replay roll-call"),
          t("button", {
            onClick: () => void l(),
            disabled: z,
            title: "Convene a fresh council on this question and record the new verdict here",
            style: {
              font: "inherit",
              fontSize: 12,
              cursor: z ? "default" : "pointer",
              background: z ? "var(--bg-elevated, rgba(255,255,255,0.04))" : `color-mix(in srgb, ${f} 14%, transparent)`,
              color: z ? "inherit" : f,
              opacity: z ? 0.75 : 1,
              border: `1px solid ${z ? "var(--border, #30363d)" : f}`,
              borderRadius: 8,
              padding: "7px 13px",
              fontWeight: 600
            }
          }, U),
          t(
            "span",
            { style: { fontSize: 11, opacity: 0.55 } },
            y === "running" ? "watching the session — its verdict lands here when it settles" : "click a seat to read its rationale"
          )
        )
      ), k.push(
        t(
          "div",
          { key: "chamber" },
          t(se, { votes: e.votes, revealed: b, winBloc: g, focusedIdx: C, onSelect: S })
        )
      ), e.synthesis && k.push(
        t(
          "div",
          { key: "synth" },
          t("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.55, margin: "26px 0 10px", fontWeight: 600 } }, "Synthesis — the ruling"),
          t("div", { style: { fontSize: 13.5, lineHeight: 1.65, maxWidth: 760, padding: "12px 16px", borderRadius: 10, background: "var(--bg-elevated, rgba(255,255,255,0.03))", border: "1px solid var(--border, #30363d)" } }, e.synthesis)
        )
      ), k.push(
        t("div", { key: "votes-h", style: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.55, margin: "26px 0 10px", fontWeight: 600 } }, `Voters (${h}) — click a seat above`)
      ), k.push(
        t(
          "div",
          { key: "votes", style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 10 } },
          ...e.votes.map((a, x) => t(le, { key: x, vote: a, idx: x, recordId: e.id, flashKey: u, onClick: () => S(x) }))
        )
      ), e.dissent && e.dissent.length && k.push(
        t(
          "div",
          { key: "dissent", style: { marginTop: 24, maxWidth: 760 } },
          t("div", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: v.conditions, marginBottom: 10, fontWeight: 600 } }, "Minority report — dissent (verbatim)"),
          ...e.dissent.map(
            (a, x) => t("div", { key: x, style: { fontSize: 12.5, lineHeight: 1.55, opacity: 0.92, borderLeft: `2px solid ${v.conditions}`, padding: "6px 0 6px 14px", marginBottom: 8 } }, a)
          )
        )
      ), t("div", { style: { padding: "22px 30px 56px", overflowY: "auto", flex: 1, minWidth: 0 } }, ...k);
    }
    function pe(n) {
      const [e, o] = I([]), [i, g] = I(null), [f, h] = I(null), [b, d] = I(null), [p, C] = I(!0), r = W(async () => {
        C(!0), d(null);
        try {
          const s = R.getScopedProjectId() ?? void 0, l = await R.call("list", s);
          o(l), g((S) => {
            var m;
            return S ?? ((m = l[0]) == null ? void 0 : m.id) ?? null;
          });
        } catch (s) {
          d(s instanceof Error ? s.message : String(s));
        } finally {
          C(!1);
        }
      }, []);
      H(() => {
        r();
      }, [r]);
      const u = W(async (s, l) => {
        if (await R.confirm({
          title: "Delete this decision?",
          body: `"${l}"

This can't be undone.`,
          confirmLabel: "Delete",
          danger: !0
        }))
          try {
            await R.call("remove", s), g((m) => {
              var k;
              return m !== s ? m : ((k = e.filter((N) => N.id !== s)[0]) == null ? void 0 : k.id) ?? null;
            }), await r();
          } catch (m) {
            R.toast(`Delete failed: ${m instanceof Error ? m.message : String(m)}`, "error");
          }
      }, [e, r]), E = W(async () => {
        if (!(!e.length || !await R.confirm({
          title: `Delete ALL ${e.length} decision${e.length > 1 ? "s" : ""}?`,
          body: "This clears the Consensus tab and can't be undone.",
          confirmLabel: "Delete all",
          danger: !0
        })))
          try {
            const { cleared: l } = await R.call("clearAll");
            g(null), h(null), await r(), R.toast(`Cleared ${l} decision${l === 1 ? "" : "s"}`, "info");
          } catch (l) {
            R.toast(`Clear failed: ${l instanceof Error ? l.message : String(l)}`, "error");
          }
      }, [e, r]);
      H(() => {
        if (!i) {
          h(null);
          return;
        }
        let s = !1;
        return R.call("get", i).then((l) => {
          s || h(l);
        }).catch((l) => {
          s || d(l instanceof Error ? l.message : String(l));
        }), () => {
          s = !0;
        };
      }, [i]);
      const y = e.length === 0 && !p ? [t("div", { key: "empty", style: { padding: "8px 16px", fontSize: 12, opacity: 0.5 } }, "No recorded decisions yet.")] : e.map((s) => {
        const l = s.id === i, S = v[J(s.verdict)];
        return t(
          "div",
          { key: s.id, className: "cx-row" },
          t(
            "button",
            {
              onClick: () => g(s.id),
              style: {
                textAlign: "left",
                background: l ? "var(--bg-active, rgba(255,255,255,0.06))" : "none",
                border: "none",
                borderLeft: `3px solid ${l ? S : "transparent"}`,
                color: "inherit",
                cursor: "pointer",
                padding: "11px 34px 11px 16px",
                display: "block",
                width: "100%"
              }
            },
            t("div", { style: { fontSize: 12.5, lineHeight: 1.4, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } }, s.question),
            t(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center" } },
              t("span", { style: { width: 8, height: 8, borderRadius: 999, background: S, display: "inline-block", boxShadow: `0 0 6px ${S}` } }),
              t("span", { style: { fontSize: 11, opacity: 0.6 } }, `${s.voters} voters · ${(s.settledAt || "").slice(0, 10)}`)
            )
          ),
          t("button", {
            className: "cx-row-del",
            title: "Delete this decision",
            "aria-label": `Delete decision: ${s.question}`,
            onClick: (m) => {
              m.stopPropagation(), u(s.id, s.question);
            }
          }, "🗑")
        );
      }), w = t(
        "div",
        {
          style: { width: 280, minWidth: 280, borderRight: "1px solid var(--border, #30363d)", overflowY: "auto", display: "flex", flexDirection: "column" }
        },
        t(
          "div",
          { style: { padding: "14px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" } },
          t("span", { style: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.55, fontWeight: 600 } }, "Decisions"),
          t(
            "div",
            { style: { display: "flex", gap: 4, alignItems: "center" } },
            t("button", { onClick: () => void r(), title: "Refresh", style: { background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.6, fontSize: 12 } }, "⟳"),
            e.length > 0 ? t("button", {
              onClick: () => void E(),
              title: "Delete all decisions",
              style: { background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.6, fontSize: 12 }
            }, "🗑") : null
          )
        ),
        ...y
      ), $ = b ? t("div", { style: { padding: 24, color: v.reject, fontSize: 13 } }, `Error: ${b}`) : f ? t(de, { key: f.id, record: f, host: R, onReanalysed: () => void r() }) : t("div", { style: { padding: 24, opacity: 0.5, fontSize: 13 } }, p ? "Loading…" : "Select a decision.");
      return t(
        "div",
        {
          style: { gridColumn: "2 / -1", minWidth: 0, display: "flex", height: "100%", width: "100%", fontFamily: "inherit" }
        },
        t("style", null, ie),
        w,
        $
      );
    }
    return {
      panel: pe,
      commands: (n) => [
        {
          id: "refresh",
          label: "Consensus: view decisions",
          icon: "Scale",
          run: () => n.toast("Open the Consensus tab to view council decisions")
        }
      ],
      navBadge: () => null
    };
  }
};
export {
  he as default
};
