import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FolderOpen, Play, RotateCcw, Loader2 } from 'lucide-react';
import type { LlmPromptEntry, LlmProviderId, LlmRunResult } from '@shared/types';

/**
 * Providers offered in the editor, in display order. `base` is the human label;
 * whether each is *selectable* is derived at render from
 * `window.cc.llmPrompts.availableProviders()` (the ids whose API key is present
 * right now — see {@link buildProviderOptions}), so a provider becomes usable the
 * moment its key is configured, rather than a hardcoded flag. `claude-cli` is
 * always available (no key needed); `anthropic-sdk` is not implemented yet.
 */
const PROVIDER_LABELS: { id: LlmProviderId; base: string }[] = [
  { id: 'claude-cli', base: 'Claude CLI (claude --print)' },
  { id: 'anthropic-sdk', base: 'Anthropic SDK' },
  { id: 'openai', base: 'OpenAI' },
  { id: 'gemini', base: 'Gemini' }
];

/** Providers keyed by an API key — offered only when that key is configured. */
const KEY_GATED: ReadonlySet<LlmProviderId> = new Set<LlmProviderId>(['openai', 'gemini']);

/**
 * Turn the raw availability set into render-ready picker options. `claude-cli`
 * is always selectable; a key-gated provider (openai/gemini) is selectable only
 * when it reports available, otherwise it shows an honest "no API key" hint;
 * anything else (anthropic-sdk) is a not-yet-implemented "coming soon".
 */
function buildProviderOptions(
  available: ReadonlySet<LlmProviderId>
): { id: LlmProviderId; label: string; enabled: boolean }[] {
  return PROVIDER_LABELS.map(({ id, base }) => {
    const enabled = available.has(id);
    if (id === 'claude-cli') return { id, label: base, enabled: true };
    if (KEY_GATED.has(id)) {
      return { id, label: enabled ? base : `${base} — no API key`, enabled };
    }
    return { id, label: `${base} — coming soon`, enabled };
  });
}

/**
 * Settings → Prompts. Lists every registered LLM micro-call prompt (built-in +
 * user) and lets the user edit, save (shadowing a built-in), reset, and test
 * one. Mirrors the QuickPrompt-store pattern: edits write a JSON file in
 * `~/.zcc/llm-prompts/` via `window.cc.llmPrompts.*`.
 */
export function PromptsTab() {
  const [prompts, setPrompts] = useState<LlmPromptEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LlmPromptEntry | null>(null);
  const [testVars, setTestVars] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<LlmRunResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Provider ids usable right now (API key present). claude-cli is always in
  // the set; openai/gemini join it when their key is configured.
  const [availableProviders, setAvailableProviders] = useState<ReadonlySet<LlmProviderId>>(
    () => new Set<LlmProviderId>(['claude-cli'])
  );

  // Load + subscribe to registry changes.
  useEffect(() => {
    let active = true;
    window.cc.llmPrompts
      .list()
      .then((list) => {
        if (!active) return;
        setPrompts(list);
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(() => {});
    window.cc.llmPrompts
      .availableProviders()
      .then((ids) => {
        if (active) setAvailableProviders(new Set(ids));
      })
      .catch(() => {});
    const off = window.cc.llmPrompts.onChanged((list) => setPrompts(list));
    return () => {
      active = false;
      off();
    };
  }, []);

  const providerOptions = useMemo(
    () => buildProviderOptions(availableProviders),
    [availableProviders]
  );

  const selected = useMemo(
    () => prompts.find((p) => p.id === selectedId) ?? null,
    [prompts, selectedId]
  );

  // The {{placeholders}} the live template actually references — these are the
  // inputs Test must collect. Derived from the draft so editing the template
  // updates the fields immediately. A template with no placeholders → [].
  const templateVars = useMemo(
    () => extractVars(draft?.userTemplate ?? ''),
    [draft?.userTemplate]
  );

  // Reset the draft + test panel whenever the selected entry changes (by id or
  // because the registry pushed a new version after a save/reset).
  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
    setTestResult(null);
    setSaved(false);
    setSaveError(null);
    // Seed each placeholder with a sensible sample so Test works out of the box.
    if (selected) {
      const next: Record<string, string> = {};
      for (const v of extractVars(selected.userTemplate)) next[v] = SAMPLE_VARS[v] ?? '';
      setTestVars(next);
    } else {
      setTestVars({});
    }
  }, [selected]);

  const dirty =
    !!draft && !!selected && JSON.stringify(stripSource(draft)) !== JSON.stringify(stripSource(selected));

  const onSave = async () => {
    if (!draft) return;
    setSaveError(null);
    try {
      await window.cc.llmPrompts.save(draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      // Write-time validation (e.g. an unusable model) rejects the invoke —
      // surface it instead of silently swallowing a failed save.
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const onReset = async () => {
    if (!draft) return;
    try {
      await window.cc.llmPrompts.delete(draft.id);
    } catch {
      /* noop */
    }
  };

  const onTest = async () => {
    if (!draft) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Persist first so the registry runs exactly what's on screen, then test.
      if (dirty) await window.cc.llmPrompts.save(draft);
      const r = await window.cc.llmPrompts.test(draft.id, testVars);
      setTestResult(r);
    } catch (err) {
      setTestResult({
        ok: false,
        text: '',
        error: err instanceof Error ? err.message : String(err),
        provider: draft.provider ?? 'claude-cli',
        ms: 0
      });
    } finally {
      setTesting(false);
    }
  };

  const isUserShadowed = selected?.source === 'user';
  const isBuiltinId = (selectedId ?? '').startsWith('builtin:');

  return (
    <div className="prompts-tab">
      <section className="settings-section">
        <h3>Prompts</h3>
        <p className="settings-help settings-section-help">
          Reusable LLM micro-calls the app runs — like a sub-agent: a prompt in, one answer out.
          The <code>tab-namer</code> prompt names a tab from your first instruction. Edits are
          saved to <code>~/.zcc/llm-prompts/</code>; built-ins are customized by shadowing,
          and Reset removes the shadow.
        </p>
        <div className="prompts-tab-layout">
          <ul className="prompts-list">
            {prompts.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`prompts-list-item ${p.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <span className="prompts-list-label">{p.label}</span>
                  <span className={`prompts-badge prompts-badge--${p.source ?? 'builtin'}`}>
                    {p.source === 'user' ? 'custom' : 'built-in'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="prompts-editor">
            {!draft ? (
              <p className="settings-help">Select a prompt to view and edit it.</p>
            ) : (
              <>
                <PField label="Label">
                  <input
                    type="text"
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    spellCheck={false}
                  />
                </PField>

                <PField label="Description" help="Optional — shown to you, not the model.">
                  <input
                    type="text"
                    value={draft.description ?? ''}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    spellCheck={false}
                  />
                </PField>

                <div className="prompts-row">
                  <PField label="Provider">
                    <select
                      value={draft.provider ?? 'claude-cli'}
                      onChange={(e) =>
                        setDraft({ ...draft, provider: e.target.value as LlmProviderId })
                      }
                    >
                      {providerOptions.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.enabled}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </PField>
                  <PField label="Model" help="Alias (haiku/sonnet/opus) or full id. Blank = default.">
                    <input
                      type="text"
                      value={draft.model ?? ''}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                      placeholder="haiku"
                      spellCheck={false}
                    />
                  </PField>
                </div>

                <PField label="System prompt" help="The instruction sent to the model.">
                  <textarea
                    rows={4}
                    value={draft.systemPrompt}
                    onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                    spellCheck={false}
                  />
                </PField>

                <PField
                  label="User template"
                  help="The user turn. {{prompt}} is filled with the first instruction."
                >
                  <textarea
                    rows={3}
                    value={draft.userTemplate}
                    onChange={(e) => setDraft({ ...draft, userTemplate: e.target.value })}
                    spellCheck={false}
                  />
                </PField>

                <div className="prompts-row">
                  <PField label="Max output chars">
                    <input
                      type="number"
                      min={1}
                      value={draft.maxOutputChars ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          maxOutputChars: e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                    />
                  </PField>
                  <PField label="Timeout (ms)">
                    <input
                      type="number"
                      min={1}
                      value={draft.timeoutMs ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          timeoutMs: e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                    />
                  </PField>
                </div>

                <div className="prompts-actions">
                  <button type="button" className="btn primary" disabled={!dirty} onClick={onSave}>
                    {saved ? 'Saved' : 'Save'}
                  </button>
                  {(isUserShadowed || !isBuiltinId) && (
                    <button type="button" className="btn" onClick={onReset} title={isBuiltinId ? 'Reset to the shipped default' : 'Delete this prompt'}>
                      <RotateCcw size={13} />
                      {isBuiltinId ? 'Reset to default' : 'Delete'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => window.cc.llmPrompts.revealDir().catch(() => {})}
                  >
                    <FolderOpen size={13} />
                    Reveal folder
                  </button>
                </div>

                {saveError && (
                  <p className="prompts-test-error" role="alert">
                    Couldn’t save: {saveError}
                  </p>
                )}

                <div className="prompts-test">
                  {templateVars.length === 0 ? (
                    <p className="settings-help">
                      This template has no <code>{'{{placeholders}}'}</code> to fill — Test runs it
                      as-is.
                    </p>
                  ) : (
                    templateVars.map((v) => (
                      <PField
                        key={v}
                        label={`Test input — {{${v}}}`}
                        help={VAR_HELP[v]}
                      >
                        <textarea
                          rows={2}
                          value={testVars[v] ?? ''}
                          onChange={(e) =>
                            setTestVars((prev) => ({ ...prev, [v]: e.target.value }))
                          }
                          spellCheck={false}
                        />
                      </PField>
                    ))
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={testing || templateVars.some((v) => !(testVars[v] ?? '').trim())}
                    onClick={onTest}
                  >
                    {testing ? <Loader2 size={13} className="prompts-spin" /> : <Play size={13} />}
                    {testing ? 'Running…' : 'Test'}
                  </button>
                  {testResult && (
                    <div
                      className={`prompts-test-result ${testResult.ok ? 'ok' : 'err'}`}
                    >
                      {testResult.ok ? (
                        <>
                          <div className="prompts-test-output">{testResult.text || '(empty output)'}</div>
                          <div className="prompts-test-meta">
                            {testResult.provider}
                            {testResult.model ? ` · ${testResult.model}` : ''} · {testResult.ms}ms
                          </div>
                        </>
                      ) : (
                        <div className="prompts-test-error">{testResult.error ?? 'failed'}</div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Pull the distinct `{{var}}` placeholder names out of a user template, in
 * first-seen order. Mirrors the main-process fillTemplate regex so the Test
 * panel asks for exactly the vars the run will substitute (e.g. tab-namer uses
 * {{prompt}}, idle-triage/close-summary use {{lastTurn}}). Whitespace inside
 * the braces is tolerated: `{{ prompt }}`.
 */
function extractVars(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) seen.add(m[1]);
  return [...seen];
}

/** Sample values used to seed the Test inputs so they work out of the box. */
const SAMPLE_VARS: Record<string, string> = {
  prompt: 'Fix the login redirect bug on mobile Safari',
  lastTurn:
    "I've finished refactoring the auth module and all tests pass. Let me know if you'd like me to open a PR."
};

/** Per-variable hint shown under its Test input. */
const VAR_HELP: Record<string, string> = {
  prompt: 'The first instruction the session was given.',
  lastTurn: 'The last message the agent wrote — what idle-triage classifies.'
};

/** Local field wrapper matching the settings CSS classes (helpers aren't exported). */
function PField({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-field">
      <label>
        <span className="settings-label">{label}</span>
        {children}
      </label>
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}

/** Drop the loader-only `source` field before a dirty-comparison. */
function stripSource(e: LlmPromptEntry): Omit<LlmPromptEntry, 'source'> {
  const { source: _source, ...rest } = e;
  return rest;
}
