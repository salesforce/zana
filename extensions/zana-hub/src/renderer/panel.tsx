/**
 * zana-hub — renderer panel.
 *
 * A global, cross-project dashboard for the Zana framework. Five sub-tabs:
 *   - Overview — KPI tiles (teams / profiles / skills / sprints / workers /
 *     autopilot) + a run-state breakdown.
 *   - Teams    — reusable team templates (roster size, concurrency, autostart).
 *   - Profiles — reusable launch profiles / personas.
 *   - Skills   — reusable skills (enabled state, kind, description).
 *   - Runs     — recent agent runs, newest first, with a live-state chip.
 *
 * React is INJECTED via activate({ React, host }) — we do NOT import it, and the
 * tree is built with React.createElement (JSX would compile to an import of the
 * externalized jsx-runtime, which won't resolve inside the blob-imported
 * bundle). Data comes from the extension's main module via host.call('overview').
 *
 * This is the GLOBAL companion to core's per-project "Zana" tab: that tab is one
 * project's tickets/sprints; this is the framework as a whole, read from ~/.zana.
 */
import type { RendererEntry, ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import type {
  GetProfileResult,
  GetTeamResult,
  SaveProfileResult,
  SaveTeamResult,
  ZanaDetail,
  ZanaDetailKind,
  ZanaHubOverview,
  ZanaProfileOption,
  ZanaProfileSummary,
  ZanaProfileTemplate,
  ZanaRunSummary,
  ZanaSkillSummary,
  ZanaTeamSlot,
  ZanaTeamSummary,
  ZanaTeamTemplate
} from '../shared/types.js';

/** A click on a catalog/activity row asks the panel to open this record. */
type OpenDetail = (kind: ZanaDetailKind, id: string) => void;

type Tab = 'overview' | 'teams' | 'profiles' | 'skills' | 'runs';

const entry: RendererEntry = {
  activate({ React, host }) {
    const { useState, useEffect, useCallback } = React;
    const h = React.createElement;

    // ---- tiny presentational helpers (inline styles, like consensus) --------

    /** Map a run state to an accent color. */
    function runStateColor(state: string): string {
      const s = state.toLowerCase();
      if (s.includes('run')) return '#3fb950'; // running → green
      if (s.includes('err') || s.includes('fail')) return '#f85149'; // errored → red
      if (s.includes('done') || s.includes('complete')) return '#58a6ff'; // done → blue
      return '#8b949e'; // unknown/idle → grey
    }

    function Chip(props: { text: string; color: string; subtle?: boolean }) {
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            padding: '1px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.7,
            color: props.subtle ? props.color : '#0d1117',
            background: props.subtle ? 'transparent' : props.color,
            border: `1px solid ${props.color}`,
            whiteSpace: 'nowrap'
          }
        },
        props.text
      );
    }

    /** A KPI tile for the overview grid. */
    function Tile(props: { label: string; value: number | string; hint?: string }) {
      return h(
        'div',
        {
          style: {
            flex: '1 1 130px',
            minWidth: 130,
            padding: '14px 16px',
            borderRadius: 10,
            background: 'var(--bg-elevated, #161b22)',
            border: '1px solid var(--border, #30363d)'
          }
        },
        h('div', { style: { fontSize: 26, fontWeight: 700, lineHeight: 1.1 } }, String(props.value)),
        h('div', { style: { fontSize: 12, color: 'var(--text-muted, #8b949e)', marginTop: 4 } }, props.label),
        props.hint
          ? h('div', { style: { fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 2 } }, props.hint)
          : null
      );
    }

    function SectionEmpty(props: { text: string }) {
      return h(
        'div',
        { style: { padding: 24, color: 'var(--text-muted, #8b949e)', fontSize: 13 } },
        props.text
      );
    }

    function Row(props: { left: unknown; right?: unknown; sub?: unknown; onClick?: () => void }) {
      const [hover, setHover] = useState(false);
      const clickable = !!props.onClick;
      return h(
        'div',
        {
          onClick: props.onClick,
          onMouseEnter: clickable ? () => setHover(true) : undefined,
          onMouseLeave: clickable ? () => setHover(false) : undefined,
          role: clickable ? 'button' : undefined,
          tabIndex: clickable ? 0 : undefined,
          onKeyDown: clickable
            ? (e: { key: string; preventDefault: () => void }) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onClick!();
                }
              }
            : undefined,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border, #21262d)',
            cursor: clickable ? 'pointer' : 'default',
            background: hover ? 'var(--surface-2, #161b22)' : 'transparent'
          }
        },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, props.left as never),
          props.sub
            ? h('div', { style: { fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 2 } }, props.sub as never)
            : null
        ),
        props.right ? h('div', { style: { flexShrink: 0 } }, props.right as never) : null,
        clickable
          ? h('div', { style: { flexShrink: 0, color: 'var(--muted, #8b949e)', fontSize: 14, opacity: hover ? 1 : 0.4 } }, '›')
          : null
      );
    }

    // ---- sub-tab views ------------------------------------------------------

    function OverviewView(props: { data: ZanaHubOverview }) {
      const d = props.data;
      const stateEntries = Object.entries(d.runStateCounts).sort((a, b) => b[1] - a[1]);
      return h(
        'div',
        { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 18 } },
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 12 } },
          h(Tile, { label: 'Teams', value: d.teams.length }),
          h(Tile, { label: 'Profiles', value: d.profiles.length }),
          h(Tile, { label: 'Skills', value: d.skills.length }),
          h(Tile, { label: 'Sprints', value: d.sprints.length }),
          h(Tile, { label: 'Workers', value: d.workerCount }),
          h(Tile, { label: 'Autopilot goals', value: d.autopilotGoalCount })
        ),
        h(
          'div',
          null,
          h(
            'div',
            { style: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted, #8b949e)', marginBottom: 8 } },
            'Agent runs'
          ),
          stateEntries.length === 0
            ? h(SectionEmpty, { text: 'No agent runs recorded yet.' })
            : h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                ...stateEntries.map(([state, count]) =>
                  h(Chip, { key: state, text: `${state} · ${count}`, color: runStateColor(state), subtle: true })
                )
              )
        )
      );
    }

    /** Empty template for a brand-new team. */
    function emptyTemplate(): ZanaTeamTemplate {
      return { name: '', slots: [{ profileId: '', quantity: 1 }] };
    }

    /**
     * Full-template editor. Binds to a local ZanaTeamTemplate; on Save calls
     * saveTeam and, on success, invokes onSaved() (parent re-reads overview and
     * returns to list mode). Profiles feed the slot/orchestrator dropdowns; any
     * referenced-but-unknown profileId gets a synthetic option so it round-trips.
     */
    function TeamEditorView(props: {
      initial: ZanaTeamTemplate;
      profiles: ZanaProfileOption[];
      onSaved: () => void;
      onCancel: () => void;
    }) {
      const [t, setT] = useState<ZanaTeamTemplate>(props.initial);
      const [saving, setSaving] = useState(false);
      const [err, setErr] = useState<string | null>(null);

      const set = (patch: Partial<ZanaTeamTemplate>) => setT((prev) => ({ ...prev, ...patch }));
      const setSlot = (i: number, patch: Partial<ZanaTeamSlot>) =>
        setT((prev) => ({ ...prev, slots: prev.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
      const addSlot = () => setT((prev) => ({ ...prev, slots: [...prev.slots, { profileId: '', quantity: 1 }] }));
      const removeSlot = (i: number) =>
        setT((prev) => ({ ...prev, slots: prev.slots.filter((_, j) => j !== i) }));

      // Build the profile option set, injecting a synthetic entry for any
      // referenced profileId that isn't a known profile file (e.g. UUIDs).
      const known = new Set(props.profiles.map((p) => p.id));
      const referenced = [t.orchestratorProfileId, ...t.slots.map((s) => s.profileId)].filter(
        (id): id is string => !!id && !known.has(id)
      );
      const options: ZanaProfileOption[] = [
        ...props.profiles,
        ...referenced.map((id) => ({ id, displayName: `⚠ unknown: ${id}` }))
      ];

      const save = () => {
        setSaving(true);
        setErr(null);
        host
          .call<SaveTeamResult>('saveTeam', t)
          .then((res) => {
            if (res.ok) props.onSaved();
            else setErr(res.error);
          })
          .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
          .finally(() => setSaving(false));
      };

      const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #8b949e)', marginBottom: 4 };
      const inputStyle = {
        width: '100%',
        boxSizing: 'border-box' as const,
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--border, #30363d)',
        background: 'var(--bg-input, #161b22)',
        color: 'var(--text-primary, #c9d1d9)',
        fontSize: 13
      };
      const field = (label: string, control: unknown) =>
        h('div', { style: { marginBottom: 12 } }, h('div', { style: labelStyle }, label), control as never);

      const profileSelect = (value: string | undefined, onChange: (v: string) => void, allowEmpty: boolean) =>
        h(
          'select',
          {
            value: value ?? '',
            onChange: (e: { target: { value: string } }) => onChange(e.target.value),
            style: inputStyle
          },
          allowEmpty ? h('option', { key: '', value: '' }, '— select profile —') : null,
          ...options.map((p) => h('option', { key: p.id, value: p.id }, p.displayName))
        );

      return h(
        'div',
        { style: { padding: 16, maxWidth: 720 } },
        err ? h('div', { style: { color: '#f85149', fontSize: 12, marginBottom: 12 } }, err) : null,
        field(
          'Name',
          h('input', {
            type: 'text',
            value: t.name,
            placeholder: 'Backend Squad',
            onChange: (e: { target: { value: string } }) => set({ name: e.target.value }),
            style: inputStyle
          })
        ),
        field(
          'Icon (emoji)',
          h('input', {
            type: 'text',
            value: t.icon ?? '',
            placeholder: '⚙️',
            onChange: (e: { target: { value: string } }) => set({ icon: e.target.value }),
            style: { ...inputStyle, width: 80 }
          })
        ),
        field(
          'Description',
          h('textarea', {
            value: t.description ?? '',
            rows: 2,
            onChange: (e: { target: { value: string } }) => set({ description: e.target.value }),
            style: inputStyle
          })
        ),
        field('Orchestrator', profileSelect(t.orchestratorProfileId, (v) => set({ orchestratorProfileId: v }), true)),
        // Slots
        h('div', { style: labelStyle }, 'Roster slots'),
        ...t.slots.map((s, i) =>
          h(
            'div',
            { key: String(i), style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
            h('div', { style: { flex: 1 } }, profileSelect(s.profileId, (v) => setSlot(i, { profileId: v }), true)),
            h('input', {
              type: 'number',
              min: 1,
              value: s.quantity,
              onChange: (e: { target: { value: string } }) =>
                setSlot(i, { quantity: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }),
              style: { ...inputStyle, width: 72 }
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: () => removeSlot(i),
                disabled: t.slots.length <= 1,
                style: {
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #30363d)',
                  background: 'transparent',
                  color: 'var(--text-muted, #8b949e)',
                  cursor: t.slots.length <= 1 ? 'default' : 'pointer'
                }
              },
              'Remove'
            )
          )
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: addSlot,
            style: {
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px dashed var(--border, #30363d)',
              background: 'transparent',
              color: 'var(--text-primary, #c9d1d9)',
              cursor: 'pointer',
              marginBottom: 12
            }
          },
          '+ Add slot'
        ),
        field(
          'Initial prompt',
          h('textarea', {
            value: t.initialPrompt ?? '',
            rows: 6,
            onChange: (e: { target: { value: string } }) => set({ initialPrompt: e.target.value }),
            style: inputStyle
          })
        ),
        field(
          'Max concurrent workers',
          h('input', {
            type: 'number',
            min: 1,
            value: t.maxConcurrentWorkers ?? '',
            placeholder: 'default: total slots',
            onChange: (e: { target: { value: string } }) => {
              const v = parseInt(e.target.value, 10);
              set({ maxConcurrentWorkers: Number.isInteger(v) && v >= 1 ? v : undefined });
            },
            style: { ...inputStyle, width: 120 }
          })
        ),
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 } },
          h('input', {
            type: 'checkbox',
            checked: t.autoStart === true,
            onChange: (e: { target: { checked: boolean } }) => set({ autoStart: e.target.checked })
          }),
          'Auto-start'
        ),
        // Actions
        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(
            'button',
            {
              type: 'button',
              onClick: save,
              disabled: saving,
              style: {
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                background: '#238636',
                color: '#fff',
                cursor: saving ? 'default' : 'pointer'
              }
            },
            saving ? 'Saving…' : 'Save'
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: props.onCancel,
              disabled: saving,
              style: {
                fontSize: 13,
                padding: '6px 16px',
                borderRadius: 6,
                border: '1px solid var(--border, #30363d)',
                background: 'transparent',
                color: 'var(--text-primary, #c9d1d9)',
                cursor: 'pointer'
              }
            },
            'Cancel'
          )
        )
      );
    }

    function GroupHead(props: { title: string; count: number }) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px 4px',
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            color: 'var(--muted, #8b949e)'
          }
        },
        props.title,
        h(Chip, { text: String(props.count), color: '#8b949e', subtle: true })
      );
    }

    function TeamsView(props: {
      teams: ZanaTeamSummary[];
      onOpen: OpenDetail;
      onNew: () => void;
      onEdit: (id: string) => void;
    }) {
      const newBtn = h(
        'div',
        { style: { padding: '10px 14px', borderBottom: '1px solid var(--border, #21262d)' } },
        h(
          'button',
          {
            type: 'button',
            onClick: props.onNew,
            style: {
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#238636',
              color: '#fff',
              cursor: 'pointer'
            }
          },
          '+ New team'
        )
      );
      if (props.teams.length === 0) {
        return h('div', null, newBtn, h(SectionEmpty, { text: 'No team templates in ~/.zana/teams.' }));
      }
      // The Edit button lives inside a clickable Row, so it must swallow the click
      // (stopPropagation) to open the editor WITHOUT also firing the row's detail.
      const editBtn = (id: string) =>
        h(
          'button',
          {
            type: 'button',
            onClick: (e: { stopPropagation: () => void }) => {
              e.stopPropagation();
              props.onEdit(id);
            },
            style: {
              fontSize: 12,
              padding: '3px 10px',
              borderRadius: 6,
              border: '1px solid var(--border, #30363d)',
              background: 'transparent',
              color: 'var(--text-primary, #c9d1d9)',
              cursor: 'pointer'
            }
          },
          'Edit'
        );
      return h(
        'div',
        null,
        newBtn,
        ...props.teams.map((t) => {
          // Meta line: headcount, then optional roster preview, then description.
          const head = `${t.workerTotal} worker${t.workerTotal === 1 ? '' : 's'} · ${t.slots} slot${t.slots === 1 ? '' : 's'}${t.maxWorkers != null ? ` · max ${t.maxWorkers}` : ''}`;
          const sub = t.roster
            ? h(
                'span',
                null,
                head,
                h('span', { style: { color: 'var(--muted, #8b949e)', opacity: 0.7 } }, `  —  ${t.roster}`)
              )
            : head;
          return h(Row, {
            key: t.id,
            onClick: () => props.onOpen('team', t.id),
            left: `${t.icon ? t.icon + ' ' : ''}${t.name}`,
            sub: t.description
              ? h('span', null, h('span', { style: { display: 'block' } }, t.description), h('span', { style: { display: 'block', marginTop: 2 } }, sub as never))
              : sub,
            right: h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              t.autoStart ? h(Chip, { text: 'auto-start', color: '#3fb950', subtle: true }) : null,
              editBtn(t.id)
            )
          });
        })
      );
    }

    /** Empty template for a brand-new profile. */
    function emptyProfile(): ZanaProfileTemplate {
      return { displayName: '', allowedTools: [], disallowedTools: [] };
    }

    // Fixed option sets for the profile editor selects. The current stored value
    // is always kept selectable (see keepable()) so an unusual value round-trips.
    const MODEL_OPTIONS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-fable-5'];
    const EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'];
    const PERMISSION_OPTIONS = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];

    /**
     * Full profile editor. Binds to a local ZanaProfileTemplate; on Save calls
     * saveProfile and, on success, invokes onSaved() (parent re-reads overview
     * and returns to list mode). Tool lists edit as one-per-line textareas.
     */
    function ProfileEditorView(props: {
      initial: ZanaProfileTemplate;
      onSaved: () => void;
      onCancel: () => void;
    }) {
      const [p, setP] = useState<ZanaProfileTemplate>(props.initial);
      const [saving, setSaving] = useState(false);
      const [err, setErr] = useState<string | null>(null);

      const set = (patch: Partial<ZanaProfileTemplate>) => setP((prev) => ({ ...prev, ...patch }));

      const save = () => {
        setSaving(true);
        setErr(null);
        host
          .call<SaveProfileResult>('saveProfile', p)
          .then((res) => {
            if (res.ok) props.onSaved();
            else setErr(res.error);
          })
          .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
          .finally(() => setSaving(false));
      };

      const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #8b949e)', marginBottom: 4 };
      const inputStyle = {
        width: '100%',
        boxSizing: 'border-box' as const,
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--border, #30363d)',
        background: 'var(--bg-input, #161b22)',
        color: 'var(--text-primary, #c9d1d9)',
        fontSize: 13
      };
      const field = (label: string, control: unknown) =>
        h('div', { style: { marginBottom: 12 } }, h('div', { style: labelStyle }, label), control as never);

      // A <select> whose current value is always an option (even if not in the
      // preset list), with an empty "— default —" choice.
      const optionSelect = (value: string | undefined, opts: string[], onChange: (v: string) => void) => {
        const keepable = value && !opts.includes(value) ? [value] : [];
        return h(
          'select',
          {
            value: value ?? '',
            onChange: (e: { target: { value: string } }) => onChange(e.target.value),
            style: inputStyle
          },
          h('option', { key: '', value: '' }, '— default —'),
          ...[...opts, ...keepable].map((o) => h('option', { key: o, value: o }, o))
        );
      };

      const toolsField = (label: string, value: string[], onChange: (v: string[]) => void) =>
        field(
          label,
          h('textarea', {
            value: value.join('\n'),
            rows: 5,
            placeholder: 'One tool per line — e.g.\nRead\nGrep\nmcp__plugin_codesearch_codesearch__*',
            onChange: (e: { target: { value: string } }) => onChange(e.target.value.split('\n')),
            style: { ...inputStyle, fontFamily: 'var(--font-mono, monospace)' }
          })
        );

      return h(
        'div',
        { style: { padding: 16, maxWidth: 720 } },
        err ? h('div', { style: { color: '#f85149', fontSize: 12, marginBottom: 12 } }, err) : null,
        field(
          'Name',
          h('input', {
            type: 'text',
            value: p.displayName,
            placeholder: 'Core Architect',
            onChange: (e: { target: { value: string } }) => set({ displayName: e.target.value }),
            style: inputStyle
          })
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 12 } },
          h('div', { style: { width: 80 } }, field(
            'Icon (emoji)',
            h('input', {
              type: 'text',
              value: p.icon ?? '',
              placeholder: '📐',
              onChange: (e: { target: { value: string } }) => set({ icon: e.target.value }),
              style: inputStyle
            })
          )),
          h('div', { style: { flex: 1 } }, field(
            'Category',
            h('input', {
              type: 'text',
              value: p.category ?? '',
              placeholder: 'engineering',
              onChange: (e: { target: { value: string } }) => set({ category: e.target.value }),
              style: inputStyle
            })
          ))
        ),
        field(
          'Description',
          h('textarea', {
            value: p.description ?? '',
            rows: 2,
            onChange: (e: { target: { value: string } }) => set({ description: e.target.value }),
            style: inputStyle
          })
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 12 } },
          h('div', { style: { flex: 1 } }, field('Model', optionSelect(p.model, MODEL_OPTIONS, (v) => set({ model: v })))),
          h('div', { style: { flex: 1 } }, field('Effort', optionSelect(p.effortLevel, EFFORT_OPTIONS, (v) => set({ effortLevel: v })))),
          h('div', { style: { flex: 1 } }, field('Permission mode', optionSelect(p.permissionMode, PERMISSION_OPTIONS, (v) => set({ permissionMode: v }))))
        ),
        field(
          'System prompt',
          h('textarea', {
            value: p.systemPrompt ?? '',
            rows: 8,
            onChange: (e: { target: { value: string } }) => set({ systemPrompt: e.target.value }),
            style: inputStyle
          })
        ),
        toolsField('Allowed tools', p.allowedTools, (v) => set({ allowedTools: v })),
        toolsField('Disallowed tools', p.disallowedTools, (v) => set({ disallowedTools: v })),
        // Actions
        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(
            'button',
            {
              type: 'button',
              onClick: save,
              disabled: saving,
              style: {
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                background: '#238636',
                color: '#fff',
                cursor: saving ? 'default' : 'pointer'
              }
            },
            saving ? 'Saving…' : 'Save'
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: props.onCancel,
              disabled: saving,
              style: {
                fontSize: 13,
                padding: '6px 16px',
                borderRadius: 6,
                border: '1px solid var(--border, #30363d)',
                background: 'transparent',
                color: 'var(--text-primary, #c9d1d9)',
                cursor: 'pointer'
              }
            },
            'Cancel'
          )
        )
      );
    }

    function ProfilesView(props: {
      profiles: ZanaProfileSummary[];
      onOpen: OpenDetail;
      onNew: () => void;
      onEdit: (id: string) => void;
    }) {
      const newBtn = h(
        'div',
        { style: { padding: '10px 14px', borderBottom: '1px solid var(--border, #21262d)' } },
        h(
          'button',
          {
            type: 'button',
            onClick: props.onNew,
            style: {
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#238636',
              color: '#fff',
              cursor: 'pointer'
            }
          },
          '+ New profile'
        )
      );
      if (props.profiles.length === 0) {
        return h('div', null, newBtn, h(SectionEmpty, { text: 'No profiles in ~/.zana/profiles.' }));
      }
      // Edit button inside a clickable Row — swallow the click so it opens the
      // editor without also firing the row's detail drawer.
      const editBtn = (id: string) =>
        h(
          'button',
          {
            type: 'button',
            onClick: (e: { stopPropagation: () => void }) => {
              e.stopPropagation();
              props.onEdit(id);
            },
            style: {
              fontSize: 12,
              padding: '3px 10px',
              borderRadius: 6,
              border: '1px solid var(--border, #30363d)',
              background: 'transparent',
              color: 'var(--text-primary, #c9d1d9)',
              cursor: 'pointer'
            }
          },
          'Edit'
        );
      // Group by category (stable, first-seen order), like core's per-project gallery.
      const groups: Array<[string, ZanaProfileSummary[]]> = [];
      const index = new Map<string, ZanaProfileSummary[]>();
      for (const p of props.profiles) {
        const key = p.category && p.category.trim() ? p.category : 'Uncategorized';
        let bucket = index.get(key);
        if (!bucket) {
          bucket = [];
          index.set(key, bucket);
          groups.push([key, bucket]);
        }
        bucket.push(p);
      }
      const multi = groups.length > 1;
      return h(
        'div',
        null,
        newBtn,
        ...groups.flatMap(([cat, items]) => [
          multi ? h(GroupHead, { key: `h:${cat}`, title: cat, count: items.length }) : null,
          ...items.map((p) =>
            h(Row, {
              key: p.id,
              onClick: () => props.onOpen('profile', p.id),
              left: `${p.icon ? p.icon + ' ' : ''}${p.name}`,
              sub: p.description || undefined,
              right: h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                p.model ? h(Chip, { text: p.model, color: '#8b949e', subtle: true }) : null,
                editBtn(p.id)
              )
            })
          )
        ])
      );
    }

    function SkillsView(props: { skills: ZanaSkillSummary[]; onOpen: OpenDetail }) {
      if (props.skills.length === 0) return h(SectionEmpty, { text: 'No skills in ~/.zana/skills.' });
      return h(
        'div',
        null,
        ...props.skills.map((s) =>
          h(Row, {
            key: s.id,
            onClick: () => props.onOpen('skill', s.id),
            left: s.name,
            sub: s.description || undefined,
            right: h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              s.type ? h(Chip, { text: s.type, color: '#8b949e', subtle: true }) : null,
              h(Chip, {
                text: s.enabled ? 'enabled' : 'disabled',
                color: s.enabled ? '#3fb950' : '#8b949e',
                subtle: true
              })
            )
          })
        )
      );
    }

    function RunsView(props: { runs: ZanaRunSummary[]; onOpen: OpenDetail }) {
      if (props.runs.length === 0) return h(SectionEmpty, { text: 'No recent agent runs in ~/.zana/runs.' });
      return h(
        'div',
        null,
        ...props.runs.map((r) =>
          h(Row, {
            key: r.id,
            onClick: () => props.onOpen('run', r.id),
            left: `${r.profileIcon ? r.profileIcon + ' ' : ''}${r.profileName ?? r.id.slice(0, 8)}`,
            sub: [r.mode, r.model, r.lastAction].filter(Boolean).join(' · ') || undefined,
            right: h(Chip, { text: r.state, color: runStateColor(r.state), subtle: true })
          })
        )
      );
    }

    // ---- detail drawer ------------------------------------------------------

    /** One labelled field inside the detail drawer (inline or a text block). */
    function DetailField(props: { label: string; value: string; block?: boolean }) {
      if (props.block) {
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h(
            'div',
            { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted, #8b949e)' } },
            props.label
          ),
          h(
            'pre',
            {
              style: {
                margin: 0,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--surface-2, #161b22)',
                border: '1px solid var(--border, #30363d)',
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--text, #c9d1d9)',
                maxHeight: 360,
                overflowY: 'auto'
              }
            },
            props.value
          )
        );
      }
      return h(
        'div',
        { style: { display: 'flex', gap: 12, alignItems: 'baseline' } },
        h(
          'div',
          { style: { flex: '0 0 120px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted, #8b949e)' } },
          props.label
        ),
        h('div', { style: { flex: 1, minWidth: 0, fontSize: 13, wordBreak: 'break-word' } }, props.value)
      );
    }

    /**
     * A right-hand slide-over that shows the FULL record for a clicked row.
     * `detail` is null while the on-demand `detail` call is in flight (we show a
     * spinner line); `notFound` covers a record that couldn't be read.
     */
    function DetailDrawer(props: {
      title: string;
      icon?: string;
      detail: ZanaDetail | null;
      loading: boolean;
      error: string | null;
      onClose: () => void;
    }) {
      // Full-height overlay: a scrim that closes on click + a panel on the right.
      return h(
        'div',
        {
          onClick: props.onClose,
          style: {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(1, 4, 9, 0.55)',
            zIndex: 10
          }
        },
        h(
          'div',
          {
            onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
            style: {
              width: 'min(560px, 92%)',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-base, #0d1117)',
              borderLeft: '1px solid var(--border, #30363d)',
              boxShadow: '-8px 0 24px rgba(1, 4, 9, 0.4)'
            }
          },
          // Drawer header.
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 16px',
                borderBottom: '1px solid var(--border, #30363d)'
              }
            },
            h('div', { style: { fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0 } }, `${props.icon ? props.icon + ' ' : ''}${props.title}`),
            h(
              'button',
              {
                type: 'button',
                onClick: props.onClose,
                'aria-label': 'Close',
                style: {
                  fontSize: 16,
                  lineHeight: 1,
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #30363d)',
                  background: 'transparent',
                  color: 'var(--text, #c9d1d9)',
                  cursor: 'pointer'
                }
              },
              '✕'
            )
          ),
          // Drawer body.
          h(
            'div',
            { style: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 } },
            props.error
              ? h('div', { style: { color: '#f85149', fontSize: 13 } }, props.error)
              : props.loading || !props.detail
                ? h(SectionEmpty, { text: 'Loading…' })
                : props.detail.fields.length === 0
                  ? h(SectionEmpty, { text: 'No further detail recorded for this item.' })
                  : props.detail.fields.map((f, i) =>
                      h(DetailField, { key: `${f.label}:${i}`, label: f.label, value: f.value, block: f.block })
                    )
          )
        )
      );
    }

    // ---- the panel ----------------------------------------------------------

    const TABS: Array<{ id: Tab; label: string }> = [
      { id: 'overview', label: 'Overview' },
      { id: 'teams', label: 'Teams' },
      { id: 'profiles', label: 'Profiles' },
      { id: 'skills', label: 'Skills' },
      { id: 'runs', label: 'Runs' }
    ];

    function Panel(_props: { host: ModuleHost }) {
      const [data, setData] = useState<ZanaHubOverview | null>(null);
      const [error, setError] = useState<string | null>(null);
      const [loading, setLoading] = useState(true);
      const [tab, setTab] = useState<Tab>('overview');

      // Team editor: null = list mode; otherwise the template being edited
      // ('new' seeds an empty one). Profiles are loaded lazily when it opens.
      const [editing, setEditing] = useState<ZanaTeamTemplate | null>(null);
      const [profiles, setProfiles] = useState<ZanaProfileOption[]>([]);
      const [editLoading, setEditLoading] = useState(false);

      // Profile editor: null = list mode; otherwise the template being edited.
      const [editingProfile, setEditingProfile] = useState<ZanaProfileTemplate | null>(null);

      // Detail drawer: the row the user clicked (kind + label for an instant
      // header) plus the on-demand-loaded full record.
      const [selected, setSelected] = useState<{ kind: ZanaDetailKind; id: string; title: string; icon?: string } | null>(null);
      const [detail, setDetail] = useState<ZanaDetail | null>(null);
      const [detailLoading, setDetailLoading] = useState(false);
      const [detailError, setDetailError] = useState<string | null>(null);

      const openDetail = useCallback<OpenDetail>((kind, id) => {
        // Look up a friendly label from the already-loaded summary so the drawer
        // header shows a name immediately, before the detail call resolves.
        const cached = host.cache.get<ZanaHubOverview>('overview');
        let title = id;
        let icon: string | undefined;
        if (cached) {
          if (kind === 'team') {
            const t = cached.teams.find((x) => x.id === id);
            if (t) { title = t.name; icon = t.icon; }
          } else if (kind === 'profile') {
            const p = cached.profiles.find((x) => x.id === id);
            if (p) { title = p.name; icon = p.icon; }
          } else if (kind === 'skill') {
            const s = cached.skills.find((x) => x.id === id);
            if (s) title = s.name;
          } else {
            const r = cached.runs.find((x) => x.id === id);
            if (r) { title = r.profileName ?? id.slice(0, 8); icon = r.profileIcon; }
          }
        }
        setSelected({ kind, id, title, icon });
        setDetail(null);
        setDetailError(null);
        setDetailLoading(true);
        host
          .call<ZanaDetail | null>('detail', kind, id)
          .then((d) => {
            if (d) setDetail(d);
            else setDetailError('This record could not be read (it may have been removed).');
          })
          .catch((e) => setDetailError(e instanceof Error ? e.message : String(e)))
          .finally(() => setDetailLoading(false));
      }, []);

      const closeDetail = useCallback(() => setSelected(null), []);

      const load = useCallback(() => {
        setLoading(true);
        setError(null);
        host
          .call<ZanaHubOverview>('overview')
          .then((d) => {
            setData(d);
            // Stash for the sidebar nav badge (running-agents count), which is
            // synchronous and can't call main itself.
            host.cache.set('overview', d);
          })
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setLoading(false));
      }, []);

      const openNew = useCallback(() => {
        setEditLoading(true);
        host
          .call<ZanaProfileOption[]>('listProfiles')
          .then((ps) => setProfiles(ps))
          .catch(() => setProfiles([]))
          .finally(() => {
            setEditing(emptyTemplate());
            setEditLoading(false);
          });
      }, []);

      const openEdit = useCallback((id: string) => {
        setEditLoading(true);
        Promise.all([
          host.call<ZanaProfileOption[]>('listProfiles').catch(() => [] as ZanaProfileOption[]),
          host.call<GetTeamResult | null>('getTeam', id)
        ])
          .then(([ps, res]) => {
            setProfiles(ps);
            if (res) setEditing(res.template);
            else setError('That team template is no longer readable.');
          })
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setEditLoading(false));
      }, []);

      const openNewProfile = useCallback(() => {
        setEditingProfile(emptyProfile());
      }, []);

      const openEditProfile = useCallback((id: string) => {
        setEditLoading(true);
        host
          .call<GetProfileResult | null>('getProfile', id)
          .then((res) => {
            if (res) setEditingProfile(res.template);
            else setError('That profile is no longer readable.');
          })
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setEditLoading(false));
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      // Header: title + refresh.
      const header = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border, #30363d)'
          }
        },
        h('div', { style: { fontSize: 15, fontWeight: 700, flex: 1 } }, 'Zana — global'),
        host.getActiveProject()
          ? h('div', { style: { fontSize: 11, color: 'var(--text-muted, #8b949e)' } }, 'cross-project · ~/.zana')
          : null,
        h(
          'button',
          {
            type: 'button',
            onClick: load,
            disabled: loading,
            style: {
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border, #30363d)',
              background: 'transparent',
              color: 'var(--text-primary, #c9d1d9)',
              cursor: loading ? 'default' : 'pointer'
            }
          },
          loading ? 'Loading…' : 'Refresh'
        )
      );

      // Tab strip. Switching tabs also drops any open editor so a stale form
      // never bleeds across tabs.
      const tabBar = h(
        'div',
        { style: { display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border, #21262d)' } },
        ...TABS.map((t) =>
          h(
            'button',
            {
              key: t.id,
              type: 'button',
              onClick: () => {
                setEditing(null);
                setEditingProfile(null);
                setTab(t.id);
              },
              style: {
                fontSize: 12,
                fontWeight: 600,
                padding: '4px 12px',
                borderRadius: 6,
                border: 'none',
                background: tab === t.id ? 'var(--bg-elevated, #21262d)' : 'transparent',
                color: tab === t.id ? 'var(--text-primary, #c9d1d9)' : 'var(--text-muted, #8b949e)',
                cursor: 'pointer'
              }
            },
            t.label
          )
        )
      );

      let body: unknown;
      if (loading && !data) {
        body = h(SectionEmpty, { text: 'Reading ~/.zana…' });
      } else if (error) {
        body = h(
          'div',
          { style: { padding: 24, color: '#f85149', fontSize: 13 } },
          `Couldn't read the global Zana workspace — ${error}`
        );
      } else if (!data || !data.present) {
        body = h(
          SectionEmpty,
          { text: 'No global Zana workspace found at ~/.zana. Run a Zana team or create a profile to populate it.' }
        );
      } else if (tab === 'overview') {
        body = h(OverviewView, { data });
      } else if (tab === 'teams') {
        body = editing
          ? h(TeamEditorView, {
              initial: editing,
              profiles,
              onSaved: () => {
                setEditing(null);
                load(); // refresh the list + nav badge
              },
              onCancel: () => setEditing(null)
            })
          : h(TeamsView, {
              teams: data.teams,
              onOpen: openDetail,
              onNew: openNew,
              onEdit: openEdit
            });
      } else if (tab === 'profiles') {
        body = editingProfile
          ? h(ProfileEditorView, {
              initial: editingProfile,
              onSaved: () => {
                setEditingProfile(null);
                load(); // refresh the list
              },
              onCancel: () => setEditingProfile(null)
            })
          : h(ProfilesView, {
              profiles: data.profiles,
              onOpen: openDetail,
              onNew: openNewProfile,
              onEdit: openEditProfile
            });
      } else if (tab === 'skills') {
        body = h(SkillsView, { skills: data.skills, onOpen: openDetail });
      } else {
        body = h(RunsView, { runs: data.runs, onOpen: openDetail });
      }

      // Partial-read hint.
      const warnBar =
        data && data.warnings.length > 0
          ? h(
              'div',
              { style: { padding: '6px 16px', fontSize: 11, color: '#d29922' } },
              `Partial read — ${data.warnings.length} file(s) skipped.`
            )
          : null;

      return h(
        'div',
        {
          style: {
            // The app shell is a 3-column CSS grid (nav · list · content). A
            // module panel must span the content area explicitly — exactly like
            // core's .cu-panel (`grid-column: 2 / -1`) — or it collapses into a
            // single auto-sized track (the cramped middle column bug).
            gridColumn: '2 / -1',
            minWidth: 0,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--bg-base, #0d1117)',
            // Anchor for the absolutely-positioned detail drawer overlay.
            position: 'relative'
          }
        },
        header,
        tabBar,
        warnBar,
        h('div', { style: { flex: 1, overflowY: 'auto' } }, body as never),
        selected
          ? h(DetailDrawer, {
              title: selected.title,
              icon: selected.icon,
              detail,
              loading: detailLoading,
              error: detailError,
              onClose: closeDetail
            })
          : null
      );
    }

    return {
      panel: Panel,
      // Sidebar badge: running agents (read from the last overview the panel
      // stashed). Cheap + synchronous — null when nothing is running.
      navBadge: (hostArg: ModuleHost) => {
        const cached = hostArg.cache.get<ZanaHubOverview>('overview');
        if (!cached) return null;
        const running = Object.entries(cached.runStateCounts)
          .filter(([state]) => state.toLowerCase().includes('run'))
          .reduce((n, [, c]) => n + c, 0);
        return running > 0 ? running : null;
      }
    };
  }
};

export default entry;
