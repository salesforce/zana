/**
 * Consensus — renderer panel.
 *
 * A master/detail viewer for settled council decisions, rendered as a
 * parliamentary "Assemblée" hemicycle: a left rail of records, and a detail
 * pane where each decision becomes a vote scene — voters as seats in a
 * semicircle colored by stance, a live tally that ticks up during a roll-call
 * reveal, the verdict proclaimed in a banner, the judge's synthesis, every
 * voter's rationale, and any verbatim dissent (the minority report).
 *
 * React is INJECTED via activate({ React, host }) — do not import it, and build
 * the tree with React.createElement (JSX would compile to an import of the
 * externalized runtime). SVG is emitted the same way: h('svg', …), h('circle', …).
 * Data comes from the extension's main module via host.call('list' | 'get').
 */
import type { RendererEntry, ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';

interface ListItem {
  id: string;
  question: string;
  verdict: string;
  voters: number;
  settledAt: string;
}
interface Vote {
  voter: string;
  stance: string;
  rationale: string;
}
interface Record {
  id: string;
  projectId?: string;
  question: string;
  verdict: string;
  synthesis?: string;
  votes: Vote[];
  dissent?: string[];
  settledAt: string;
  roster?: string;
}

type Bloc = 'approve' | 'reject' | 'conditions';

const entry: RendererEntry = {
  activate({ React, host }) {
    const { useState, useEffect, useCallback, useRef, useMemo } = React;
    const h = React.createElement;

    // ---- stance / verdict classification (mirrors the main module vocab) ----
    //
    // Three blocs: approve (green), CHANGES/qualified (amber), reject (red).
    // CHANGES is deliberately NOT red: a "changes requested" stance is qualified
    // SUPPORT, not opposition, so it must not read as a vote against the outcome
    // (that made a "1 for / 2 against → APPROVED" tally look self-contradictory).
    // Only an explicit reject/block/against lands in the red bloc.
    function verdictKind(verdict: string): Bloc {
      const v = (verdict || '').toLowerCase();
      if (/\breject|\bblock|contre|against/.test(v)) return 'reject';
      if (v.startsWith('changes') || v.includes('condition') || v.includes('escalat')) return 'conditions';
      return 'approve';
    }
    function classify(stance: string): Bloc {
      const v = (stance || '').toLowerCase();
      if (/reject|block|contre|against|veto/.test(v)) return 'reject';
      if (/change|revise|rework|condition|abstain|escalat|defer|neutral/.test(v)) return 'conditions';
      return 'approve';
    }
    function initials(name: string): string {
      return (name || '')
        .split(/[-_ ]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0].toUpperCase())
        .join('');
    }

    const KIND_COLOR: { [k in Bloc]: string } = {
      approve: '#3fb950',
      reject: '#f85149',
      conditions: '#d29922',
    };
    const BLOC_ORDER: Bloc[] = ['approve', 'conditions', 'reject'];
    const STANCE_LABEL: { [k in Bloc]: string } = { approve: 'FOR', conditions: 'CHANGES', reject: 'AGAINST' };
    const KIND_WORD: { [k in Bloc]: string } = { approve: 'APPROVED', reject: 'REJECTED', conditions: 'CONDITIONS' };

    // Split a verdict like "APPROVE — Option C (static feeds…)" into a short badge
    // word (the head, before the dash) and the decision detail (the tail). Falls back
    // to the verdict-kind word when the text has no natural head to lift out.
    function splitVerdict(verdict: string, kind: Bloc): { badge: string; detail: string } {
      const s = (verdict || '').trim();
      const m = s.match(/^(.{2,32}?)\s*[—–:-]\s+(.+)$/s);
      if (m) return { badge: m[1].trim().toUpperCase(), detail: m[2].trim() };
      if (s.length <= 28) return { badge: s.toUpperCase(), detail: '' };
      return { badge: KIND_WORD[kind], detail: s };
    }

    const prefersReducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- hemicycle geometry (pure) ----
    interface Slot { ang: number; x: number; y: number; }
    function seatLayout(n: number, rInner: number, rOuter: number, cx: number, cy: number): Slot[] {
      const rows = n <= 6 ? 1 : n <= 14 ? 2 : n <= 30 ? 3 : n <= 60 ? 5 : 8;
      const radii: number[] = [];
      for (let i = 0; i < rows; i++) {
        radii.push(rInner + (rows === 1 ? (rOuter - rInner) * 0.5 : (rOuter - rInner) * (i / (rows - 1))));
      }
      const wSum = radii.reduce((a, b) => a + b, 0);
      const counts = radii.map((w) => Math.max(1, Math.round((w / wSum) * n)));
      let drift = n - counts.reduce((a, b) => a + b, 0);
      for (let i = counts.length - 1; drift !== 0 && i >= 0; i--) {
        const step = drift > 0 ? 1 : -1;
        if (counts[i] + step >= 1) { counts[i] += step; drift -= step; }
      }
      const slots: Slot[] = [];
      for (let ri = 0; ri < rows; ri++) {
        const cnt = counts[ri], r = radii[ri];
        for (let s = 0; s < cnt; s++) {
          const t = cnt === 1 ? 0.5 : s / (cnt - 1);
          const pad = 0.05;
          const ang = Math.PI * (1 - pad) - t * Math.PI * (1 - 2 * pad);
          slots.push({ ang, x: cx + r * Math.cos(ang), y: cy - r * Math.sin(ang) });
        }
      }
      slots.sort((a, b) => b.ang - a.ang);
      return slots.slice(0, n);
    }
    function polar(cx: number, cy: number, r: number, a: number): [number, number] {
      return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    }
    function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
      const [x0, y0] = polar(cx, cy, r, a0);
      const [x1, y1] = polar(cx, cy, r, a1);
      const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    }

    // one <style> block for keyframes + seat transitions (inline styles can't do @keyframes)
    const STYLE = `
      .cx-seat { transition: fill .5s ease, transform .18s cubic-bezier(.2,1.5,.4,1); transform-box: fill-box; transform-origin: center; cursor: pointer; }
      .cx-seat:hover, .cx-seat:focus { transform: scale(1.5); outline: none; }
      .cx-seat.on { filter: drop-shadow(0 0 4px var(--cx-seat-color)); }
      .cx-seat.focused { stroke: var(--fg, #e6edf3); stroke-width: 2; }
      .cx-initial { pointer-events: none; opacity: 0; transition: opacity .4s ease; }
      .cx-initial.show { opacity: 1; }
      .cx-card { transition: transform .12s ease, border-color .15s ease; }
      .cx-card:hover { transform: translateY(-1px); }
      .cx-card.flash { animation: cxflash 1.2s ease; }
      @keyframes cxflash { 0% { box-shadow: 0 0 0 0 ${KIND_COLOR.conditions}; } 25% { box-shadow: 0 0 0 3px ${KIND_COLOR.conditions}; } 100% { box-shadow: 0 0 0 0 transparent; } }
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
      .cx-row-del:hover, .cx-row-del:focus { opacity: 1 !important; background: color-mix(in srgb, ${KIND_COLOR.reject} 22%, transparent);
        color: ${KIND_COLOR.reject}; outline: none; }
    `;

    // ---- roll-call hook: reveal seats one-by-one, then "land" the verdict ----
    function useRollCall(total: number, key: string) {
      const [revealed, setRevealed] = useState(0);
      const [landed, setLanded] = useState(false);
      const timers = useRef<number[]>([]);

      const run = useCallback(() => {
        timers.current.forEach((t) => clearTimeout(t));
        timers.current = [];
        setRevealed(0);
        setLanded(false);
        if (prefersReducedMotion || total === 0) {
          setRevealed(total);
          setLanded(true);
          return;
        }
        const step = total > 20 ? 45 : 85;
        for (let i = 1; i <= total; i++) {
          timers.current.push(
            window.setTimeout(() => setRevealed(i), 160 + (i - 1) * step)
          );
        }
        timers.current.push(window.setTimeout(() => setLanded(true), 160 + total * step + 200));
      }, [total]);

      // auto-run on record change
      useEffect(() => {
        run();
        return () => { timers.current.forEach((t) => clearTimeout(t)); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key]);

      return { revealed, landed, run };
    }

    // ---- Hemicycle SVG ----
    function Hemicycle(props: {
      votes: Vote[];
      revealed: number;
      winBloc: Bloc;
      focusedIdx: number | null;
      onSelect: (originalIdx: number) => void;
    }) {
      const { votes, revealed, winBloc, focusedIdx, onSelect } = props;
      const W = 760, H = 400, cx = W / 2, cy = 330, rInner = 120, rOuter = 300;
      const n = votes.length;
      const seatR = n <= 6 ? 16 : n <= 14 ? 11 : n <= 30 ? 8 : 6;

      // order voters by bloc so blocs cluster left->right; keep original index
      const ordered = useMemo(
        () =>
          votes
            .map((v, i) => ({ v, bloc: classify(v.stance), oi: i }))
            .sort((a, b) => BLOC_ORDER.indexOf(a.bloc) - BLOC_ORDER.indexOf(b.bloc)),
        [votes]
      );
      const slots = useMemo(() => seatLayout(n, rInner, rOuter, cx, cy), [n]);

      const counts: { [k in Bloc]: number } = { approve: 0, conditions: 0, reject: 0 };
      ordered.forEach((o) => counts[o.bloc]++);
      const liveWin = ordered.slice(0, revealed).filter((o) => o.bloc === winBloc).length;

      const kids: ReturnType<typeof h>[] = [];

      // proportion arc bands (background meter)
      const bandR = rOuter + 26, pad = 0.05;
      const a0 = Math.PI * (1 - pad), a1 = Math.PI * pad, span = a0 - a1;
      let cursor = a0;
      BLOC_ORDER.forEach((b) => {
        const frac = counts[b] / (n || 1);
        if (frac <= 0) return;
        const next = cursor - frac * span;
        kids.push(
          h('path', {
            key: `band-${b}`,
            d: arcPath(cx, cy, bandR, cursor, next),
            fill: 'none',
            stroke: KIND_COLOR[b],
            strokeWidth: 14,
            opacity: 0.85,
          })
        );
        cursor = next;
      });

      // 50% majority tick
      const majAng = a0 - 0.5 * span;
      const [mx0, my0] = polar(cx, cy, bandR - 12, majAng);
      const [mx1, my1] = polar(cx, cy, bandR + 12, majAng);
      kids.push(
        h('line', { key: 'tick', x1: mx0, y1: my0, x2: mx1, y2: my1, stroke: 'var(--fg, #e6edf3)', strokeWidth: 1.5, strokeDasharray: '3 3', opacity: 0.5 })
      );
      const [lx, ly] = polar(cx, cy, bandR + 24, majAng);
      kids.push(h('text', { key: 'ticklabel', x: lx, y: ly - 2, fill: 'var(--fg-dim, #8b949e)', fontSize: 9.5, textAnchor: 'middle' }, '50%'));

      // podium
      kids.push(h('rect', { key: 'podium', x: cx - 26, y: cy + 12, width: 52, height: 10, rx: 3, fill: 'var(--border, #30363d)' }));

      // seats
      ordered.forEach((o, idx) => {
        const p = slots[idx];
        if (!p) return;
        const on = idx < revealed;
        const color = on ? KIND_COLOR[o.bloc] : 'var(--seat-empty, #2d333b)';
        const focused = focusedIdx === o.oi;
        const g: ReturnType<typeof h>[] = [
          h('circle', {
            key: 'c',
            cx: p.x, cy: p.y, r: seatR,
            className: 'cx-seat' + (on ? ' on' : '') + (focused ? ' focused' : ''),
            fill: color,
            stroke: 'rgba(0,0,0,.3)', strokeWidth: 0.5,
            tabIndex: 0, role: 'button',
            'aria-label': `${o.v.voter}: ${o.v.stance}`,
            style: { ['--cx-seat-color' as any]: KIND_COLOR[o.bloc] },
            onClick: () => onSelect(o.oi),
            onKeyDown: (e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(o.oi); } },
          }, h('title', null, `${o.v.voter} — ${o.v.stance}`)),
        ];
        if (seatR >= 11) {
          g.push(
            h('text', {
              key: 't',
              x: p.x, y: p.y,
              className: 'cx-initial' + (on ? ' show' : ''),
              textAnchor: 'middle', dominantBaseline: 'central',
              fontSize: 8, fontWeight: 700, fill: 'rgba(0,0,0,.55)',
            }, initials(o.v.voter))
          );
        }
        kids.push(h('g', { key: `seat-${idx}` }, ...g));
      });

      // center readout — running count of the winning bloc
      kids.push(
        h('text', { key: 'bignum', x: cx, y: cy - 22, textAnchor: 'middle', fill: KIND_COLOR[winBloc], fontSize: 34, fontWeight: 800 }, String(liveWin))
      );
      kids.push(
        h('text', { key: 'bigof', x: cx, y: cy + 2, textAnchor: 'middle', fill: 'var(--fg-dim, #8b949e)', fontSize: 11, letterSpacing: 1 }, `of ${n} voters`)
      );

      return h(
        'svg',
        {
          viewBox: `0 0 ${W} ${H}`,
          role: 'img',
          'aria-label': `Hemicycle: ${n} voters. ` + BLOC_ORDER.map((b) => `${counts[b]} ${b}`).join(', '),
          style: { display: 'block', width: '100%', maxWidth: 760, margin: '4px auto 0', overflow: 'visible' },
        },
        ...kids
      );
    }

    // The opening prompt for the spawned re-analysis session. It tells the agent
    // to convene a FRESH council on the same question, then record its settled
    // verdict as a ZANA ARTIFACT (tagged `consensus-reanalysis`) whose JSON
    // content matches the exact shape `ingest`/`toRecord` expects. The panel
    // folds new artifacts in — and removes each after — over the zana MCP surface.
    function buildReanalysisPrompt(record: Record): string {
      const priorVotes = record.votes
        .map((v) => `  - ${v.voter} [${v.stance}]: ${v.rationale}`)
        .join('\n');
      const payloadShape = [
        `{`,
        `  "sourceId": ${JSON.stringify(record.id)},`,
        record.projectId ? `  "projectId": ${JSON.stringify(record.projectId)},` : '',
        `  "question": ${JSON.stringify(record.question)},`,
        `  "verdict": "<short head — e.g. APPROVE — followed by the decision detail>",`,
        `  "synthesis": "<the judge's synthesis / ruling>",`,
        `  "roster": "<who voted / how chosen>",`,
        `  "votes": [ { "voter": "<id>", "stance": "APPROVE|CHANGES|CONDITIONS|REJECT", "rationale": "<verbatim>" } ],`,
        `  "dissent": ["<verbatim minority points, if any>"]`,
        `}`,
      ]
        .filter((l) => l !== '')
        .join('\n');
      return [
        `Re-analyse a prior council decision by convening a FRESH council on the same question, then record the new verdict.`,
        ``,
        `QUESTION:`,
        record.question,
        ``,
        `PRIOR VERDICT: ${record.verdict}`,
        record.roster ? `PRIOR ROSTER: ${record.roster}` : '',
        `PRIOR VOTES:`,
        priorVotes,
        record.synthesis ? `\nPRIOR SYNTHESIS: ${record.synthesis}` : '',
        ``,
        `STEP 1 — Run the council. Use the /zana:council skill (or the zana_deliberate MCP tool) on the QUESTION above. Let voters reach their own stances; do NOT just echo the prior verdict.`,
        ``,
        `STEP 2 — Record the result as a Zana artifact. Call the zana_artifact_create MCP tool with:`,
        `  - type: "decision-record"`,
        `  - tags: ["consensus-reanalysis"]   (REQUIRED — the Consensus panel folds in exactly this tag)`,
        `  - title: a short summary of the decision`,
        `  - content: a JSON string matching this shape EXACTLY:`,
        ``,
        payloadShape,
        ``,
        `Create ONLY that one artifact as your final action. The Consensus panel will fold it in (and remove the artifact) automatically once you finish.`,
      ]
        .filter((l) => l !== '')
        .join('\n');
    }

    function Chip(props: { text: string; color: string }) {
      return h('span', {
        style: {
          display: 'inline-block', padding: '1px 8px', borderRadius: 999,
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
          color: props.color, border: `1px solid ${props.color}`, whiteSpace: 'nowrap',
        },
      }, props.text);
    }

    function VoteCard(props: { vote: Vote; idx: number; recordId: string; flashKey: number | null; onClick: () => void }) {
      const { vote } = props;
      const bloc = classify(vote.stance);
      const color = KIND_COLOR[bloc];
      const flashing = props.flashKey === props.idx;
      return h(
        'div',
        {
          id: `cx-card-${props.recordId}-${props.idx}`,
          className: 'cx-card' + (flashing ? ' flash' : ''),
          onClick: props.onClick,
          style: {
            border: '1px solid var(--border, #30363d)', borderLeft: `3px solid ${color}`,
            borderRadius: 8, padding: '11px 13px', marginBottom: 0,
            background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
            scrollMarginTop: 16, cursor: 'pointer',
          },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
          h('span', {
            style: {
              width: 18, height: 18, borderRadius: 999, display: 'inline-grid', placeItems: 'center',
              fontSize: 9, fontWeight: 700, color: '#0d1117', background: color,
            },
          }, initials(vote.voter)),
          h('strong', { style: { fontSize: 13 } }, vote.voter),
          h('span', { style: { marginLeft: 'auto' } }, h(Chip, { text: vote.stance.toUpperCase(), color }))
        ),
        h('div', { style: { fontSize: 12.5, lineHeight: 1.55, opacity: 0.92 } }, vote.rationale)
      );
    }

    function Detail(props: { record: Record; host: ModuleHost; onReanalysed: () => void }) {
      const { record, host, onReanalysed } = props;
      const kind = verdictKind(record.verdict);
      const accent = KIND_COLOR[kind];
      const total = record.votes.length;
      const { revealed, landed, run } = useRollCall(total, record.id);
      const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
      const [flashKey, setFlashKey] = useState<number | null>(null);
      // Re-analysis: 'idle' | 'launching' | 'running' (agent session live) | 'ingesting'
      const [reState, setReState] = useState<'idle' | 'launching' | 'running' | 'ingesting'>('idle');
      const reSessionId = useRef<string | null>(null);
      // The project path the re-analysis ran under, captured at launch so ingest
      // targets the SAME zana workspace the spawned agent wrote its artifact into
      // (an advisory hint main realpath-confines — Rules 1/2).
      const reProjectPath = useRef<string | null>(null);

      // Spawn a fresh council for THIS decision. The extension can't run a
      // council itself (the rich per-voter rationales + synthesis it needs live
      // only in the council TRANSCRIPT, not the zana deliberation record), so it
      // launches a Claude session pre-seeded to convene one and record its
      // settled verdict as a zana artifact, which `ingest` folds back in over the
      // zana MCP surface once the session goes idle.
      const reanalyse = useCallback(async () => {
        if (reState !== 'idle') return;
        setReState('launching');
        try {
          const project =
            (host.getScopedProjectId()
              ? host.listProjects().find((p) => p.id === host.getScopedProjectId())
              : undefined) ?? host.getActiveProject() ?? undefined;
          const projectId = host.getScopedProjectId() ?? record.projectId ?? project?.id;
          if (!projectId) {
            host.toast('Re-analyse needs a project — open this decision under its project tab', 'error');
            setReState('idle');
            return;
          }
          reProjectPath.current = project?.path ?? null;
          const prompt = buildReanalysisPrompt(record);
          // Bare `claude` profile (no persona) — the agent needs the council skill
          // AND the zana MCP tools (to create the verdict artifact), so we don't
          // pin the read-only orchestrator persona.
          const res = await host.launchSession({
            projectId,
            title: `Re-analyse: ${record.question.slice(0, 40)}`,
            extraArgs: [prompt],
          });
          if (!res) {
            host.toast('Could not launch the re-analysis session', 'error');
            setReState('idle');
            return;
          }
          reSessionId.current = res.id;
          setReState('running');
          host.toast('Council re-analysis launched — its verdict will appear here when it settles', 'info');
        } catch (e) {
          host.toast(`Re-analyse failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
          setReState('idle');
        }
      }, [reState, record, host]);

      // When the re-analysis session goes idle/done, fold in any new verdict
      // artifact and refresh the list. `blocked` means it's waiting on a
      // permission prompt (e.g. to create the artifact) — leave it to the user,
      // don't ingest yet. Ingest scopes to the project the session ran under so
      // it reads the same zana workspace the agent wrote into.
      useEffect(() => {
        if (reState !== 'running') return;
        const off = host.on('session:agentStatus', ({ sessionId, state }) => {
          if (sessionId !== reSessionId.current) return;
          if (state === 'idle' || state === 'done') {
            setReState('ingesting');
            const projectPath = reProjectPath.current ?? undefined;
            void host.call<{ ingested: number }>('ingest', { projectPath })
              .then((r) => {
                if (r.ingested > 0) host.toast(`Folded in ${r.ingested} re-analysis verdict${r.ingested > 1 ? 's' : ''}`, 'info');
                onReanalysed();
              })
              .catch(() => {})
              .finally(() => { setReState('idle'); reSessionId.current = null; reProjectPath.current = null; });
          }
        });
        return off;
      }, [reState, host, onReanalysed]);

      const select = useCallback((oi: number) => {
        setFocusedIdx(oi);
        setFlashKey(null);
        // force re-trigger of the flash animation
        window.setTimeout(() => setFlashKey(oi), 0);
        const card = document.getElementById(`cx-card-${record.id}-${oi}`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, [record.id]);

      // live tally from revealed seats (ordered by bloc, so just count blocs among revealed)
      const orderedBlocs = useMemo(
        () => record.votes.map((v) => classify(v.stance)).sort((a, b) => BLOC_ORDER.indexOf(a) - BLOC_ORDER.indexOf(b)),
        [record.votes]
      );
      const live: { [k in Bloc]: number } = { approve: 0, conditions: 0, reject: 0 };
      orderedBlocs.slice(0, revealed).forEach((b) => live[b]++);

      const children: ReturnType<typeof h>[] = [];

      // ---- TITLE section: the question ----
      children.push(h('h2', { key: 'q', style: { fontSize: 18, margin: '0 0 14px', lineHeight: 1.4, maxWidth: 820 } }, record.question));

      // banner: a big verdict BADGE on the left, tally + meta on the right,
      // and the decision detail as its own line below.
      const { badge, detail } = splitVerdict(record.verdict, kind);
      const tallyEls = BLOC_ORDER.map((b) =>
        h('span', { key: b, style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { width: 10, height: 10, borderRadius: 3, background: KIND_COLOR[b], boxShadow: `0 0 6px ${KIND_COLOR[b]}` } }),
          h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, String(live[b])),
          h('span', { style: { opacity: 0.85 } }, ' ' + STANCE_LABEL[b])
        )
      );
      children.push(
        h('div', {
          key: 'banner',
          style: {
            padding: '16px 20px', borderRadius: 12, marginBottom: 6,
            border: '1px solid var(--border, #30363d)', borderLeft: `5px solid ${accent}`,
            background: 'var(--bg-elevated, rgba(255,255,255,0.03))',
          },
        },
          // top row: BIG BADGE + tally + meta
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' } },
            h('div', {
              className: 'cx-verdict' + (landed ? ' landed' : ''),
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 999,
                fontSize: 17, fontWeight: 800, letterSpacing: 0.6, lineHeight: 1,
                color: accent, background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                border: `1.5px solid ${accent}`, whiteSpace: 'nowrap',
              },
            },
              h('span', { className: 'cx-gavel' + (landed ? ' landed' : ''), style: { fontSize: 18 } }, '⚖️'),
              badge
            ),
            h('div', {
              title: 'Voter stances. The verdict is the judge\'s reasoned synthesis of the rationales — not a majority count, so "CHANGES" votes (qualified support) can still settle as APPROVE.',
              style: { display: 'flex', gap: 16, fontSize: 13, fontWeight: 600, cursor: 'help' },
            }, ...tallyEls),
            h('div', { style: { marginLeft: 'auto', fontSize: 11, opacity: 0.6, textAlign: 'right', lineHeight: 1.5, whiteSpace: 'pre-line' } },
              (record.roster ? record.roster + '\n' : '') + (record.settledAt ? 'settled ' + record.settledAt.slice(0, 10) : ''))
          ),
          // decision detail — the actual "what", given room to breathe
          detail
            ? h('div', {
                style: {
                  marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--border, #30363d)',
                  fontSize: 15, fontWeight: 600, lineHeight: 1.45, color: 'var(--fg, #e6edf3)', maxWidth: 820,
                },
              }, detail)
            : null
        )
      );

      // controls
      const reBusy = reState !== 'idle';
      const reLabel =
        reState === 'launching' ? 'Launching…'
        : reState === 'running' ? '● Council in session…'
        : reState === 'ingesting' ? 'Folding in…'
        : '↻ Re-analyse';
      children.push(
        h('div', { key: 'controls', style: { display: 'flex', gap: 10, alignItems: 'center', margin: '16px 0 0', flexWrap: 'wrap' } },
          h('button', {
            onClick: () => run(),
            style: {
              font: 'inherit', fontSize: 12, cursor: 'pointer', background: 'var(--bg-elevated, rgba(255,255,255,0.04))',
              color: 'inherit', border: '1px solid var(--border, #30363d)', borderRadius: 8, padding: '7px 13px',
            },
          }, '▸ Replay roll-call'),
          h('button', {
            onClick: () => void reanalyse(),
            disabled: reBusy,
            title: 'Convene a fresh council on this question and record the new verdict here',
            style: {
              font: 'inherit', fontSize: 12, cursor: reBusy ? 'default' : 'pointer',
              background: reBusy ? 'var(--bg-elevated, rgba(255,255,255,0.04))' : `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: reBusy ? 'inherit' : accent, opacity: reBusy ? 0.75 : 1,
              border: `1px solid ${reBusy ? 'var(--border, #30363d)' : accent}`, borderRadius: 8, padding: '7px 13px',
              fontWeight: 600,
            },
          }, reLabel),
          h('span', { style: { fontSize: 11, opacity: 0.55 } },
            reState === 'running' ? 'watching the session — its verdict lands here when it settles' : 'click a seat to read its rationale')
        )
      );

      // chamber
      children.push(
        h('div', { key: 'chamber' },
          h(Hemicycle, { votes: record.votes, revealed, winBloc: kind, focusedIdx, onSelect: select })
        )
      );

      // synthesis
      if (record.synthesis) {
        children.push(
          h('div', { key: 'synth' },
            h('div', { style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.55, margin: '26px 0 10px', fontWeight: 600 } }, 'Synthesis — the ruling'),
            h('div', { style: { fontSize: 13.5, lineHeight: 1.65, maxWidth: 760, padding: '12px 16px', borderRadius: 10, background: 'var(--bg-elevated, rgba(255,255,255,0.03))', border: '1px solid var(--border, #30363d)' } }, record.synthesis)
          )
        );
      }

      // vote cards
      children.push(
        h('div', { key: 'votes-h', style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.55, margin: '26px 0 10px', fontWeight: 600 } }, `Voters (${total}) — click a seat above`)
      );
      children.push(
        h('div', { key: 'votes', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 } },
          ...record.votes.map((v, i) => h(VoteCard, { key: i, vote: v, idx: i, recordId: record.id, flashKey, onClick: () => select(i) }))
        )
      );

      // dissent
      if (record.dissent && record.dissent.length) {
        children.push(
          h('div', { key: 'dissent', style: { marginTop: 24, maxWidth: 760 } },
            h('div', { style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: KIND_COLOR.conditions, marginBottom: 10, fontWeight: 600 } }, 'Minority report — dissent (verbatim)'),
            ...record.dissent.map((d, i) =>
              h('div', { key: i, style: { fontSize: 12.5, lineHeight: 1.55, opacity: 0.92, borderLeft: `2px solid ${KIND_COLOR.conditions}`, padding: '6px 0 6px 14px', marginBottom: 8 } }, d)
            )
          )
        );
      }

      return h('div', { style: { padding: '22px 30px 56px', overflowY: 'auto', flex: 1, minWidth: 0 } }, ...children);
    }

    function Panel(_props: { host: ModuleHost }) {
      const [items, setItems] = useState<ListItem[]>([]);
      const [selectedId, setSelectedId] = useState<string | null>(null);
      const [record, setRecord] = useState<Record | null>(null);
      const [error, setError] = useState<string | null>(null);
      const [loading, setLoading] = useState(true);

      const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const scopedProjectId = host.getScopedProjectId() ?? undefined;
          const list = await host.call<ListItem[]>('list', scopedProjectId);
          setItems(list);
          setSelectedId((cur) => cur ?? (list[0]?.id ?? null));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { void refresh(); }, [refresh]);

      // Delete one decision. Advances the selection off the deleted row so the
      // detail pane doesn't dangle on a now-gone record.
      const removeOne = useCallback(async (id: string, question: string) => {
        // W1-5: host-rendered confirm (theme + a11y), replacing window.confirm.
        const ok = await host.confirm({
          title: 'Delete this decision?',
          body: `"${question}"\n\nThis can't be undone.`,
          confirmLabel: 'Delete',
          danger: true
        });
        if (!ok) return;
        try {
          await host.call('remove', id);
          setSelectedId((cur) => {
            if (cur !== id) return cur;
            const rest = items.filter((it) => it.id !== id);
            return rest[0]?.id ?? null;
          });
          await refresh();
        } catch (e) {
          host.toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }
      }, [items, refresh]);

      // Wipe every decision.
      const clearAll = useCallback(async () => {
        if (!items.length) return;
        // W1-5: host-rendered confirm (theme + a11y), replacing window.confirm.
        const ok = await host.confirm({
          title: `Delete ALL ${items.length} decision${items.length > 1 ? 's' : ''}?`,
          body: `This clears the Consensus tab and can't be undone.`,
          confirmLabel: 'Delete all',
          danger: true
        });
        if (!ok) return;
        try {
          const { cleared } = await host.call<{ cleared: number }>('clearAll');
          setSelectedId(null);
          setRecord(null);
          await refresh();
          host.toast(`Cleared ${cleared} decision${cleared === 1 ? '' : 's'}`, 'info');
        } catch (e) {
          host.toast(`Clear failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }
      }, [items, refresh]);

      useEffect(() => {
        if (!selectedId) { setRecord(null); return; }
        let cancelled = false;
        void host.call<Record | null>('get', selectedId)
          .then((r) => { if (!cancelled) setRecord(r); })
          .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
        return () => { cancelled = true; };
      }, [selectedId]);

      // rail
      const railItems =
        items.length === 0 && !loading
          ? [h('div', { key: 'empty', style: { padding: '8px 16px', fontSize: 12, opacity: 0.5 } }, 'No recorded decisions yet.')]
          : items.map((it) => {
              const active = it.id === selectedId;
              const color = KIND_COLOR[verdictKind(it.verdict)];
              return h('div', { key: it.id, className: 'cx-row' },
                h('button', {
                  onClick: () => setSelectedId(it.id),
                  style: {
                    textAlign: 'left',
                    background: active ? 'var(--bg-active, rgba(255,255,255,0.06))' : 'none',
                    border: 'none', borderLeft: `3px solid ${active ? color : 'transparent'}`,
                    color: 'inherit', cursor: 'pointer', padding: '11px 34px 11px 16px', display: 'block', width: '100%',
                  },
                },
                  h('div', { style: { fontSize: 12.5, lineHeight: 1.4, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, it.question),
                  h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    h('span', { style: { width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block', boxShadow: `0 0 6px ${color}` } }),
                    h('span', { style: { fontSize: 11, opacity: 0.6 } }, `${it.voters} voters · ${(it.settledAt || '').slice(0, 10)}`)
                  )
                ),
                h('button', {
                  className: 'cx-row-del',
                  title: 'Delete this decision',
                  'aria-label': `Delete decision: ${it.question}`,
                  onClick: (e: any) => { e.stopPropagation(); void removeOne(it.id, it.question); },
                }, '🗑')
              );
            });

      const rail = h('div', {
        style: { width: 280, minWidth: 280, borderRight: '1px solid var(--border, #30363d)', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
      },
        h('div', { style: { padding: '14px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          h('span', { style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.55, fontWeight: 600 } }, 'Decisions'),
          h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h('button', { onClick: () => void refresh(), title: 'Refresh', style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.6, fontSize: 12 } }, '⟳'),
            items.length > 0
              ? h('button', {
                  onClick: () => void clearAll(),
                  title: 'Delete all decisions',
                  style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.6, fontSize: 12 },
                }, '🗑')
              : null
          )
        ),
        ...railItems
      );

      const detail = error
        ? h('div', { style: { padding: 24, color: KIND_COLOR.reject, fontSize: 13 } }, `Error: ${error}`)
        : record
          ? h(Detail, { key: record.id, record, host, onReanalysed: () => void refresh() })
          : h('div', { style: { padding: 24, opacity: 0.5, fontSize: 13 } }, loading ? 'Loading…' : 'Select a decision.');

      return h('div', {
        style: { gridColumn: '2 / -1', minWidth: 0, display: 'flex', height: '100%', width: '100%', fontFamily: 'inherit' },
      },
        h('style', null, STYLE),
        rail,
        detail
      );
    }

    return {
      panel: Panel,
      commands: (host2: ModuleHost) => [
        {
          id: 'refresh',
          label: 'Consensus: view decisions',
          icon: 'Scale',
          run: () => host2.toast('Open the Consensus tab to view council decisions'),
        },
      ],
      navBadge: () => null,
    };
  },
};

export default entry;
