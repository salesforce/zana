import { useEffect, useRef, useState, type FormEvent } from 'react';
import { definePluginApp, useRpc, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { modelKey, noAssistant, resolveModel, type AssistantStatus, type AvailableModel, type ModelChoice, type Turn } from './assistant.js';
import { guides, MAX_QUESTION_LENGTH, searchGuides, type Guide } from './help.js';
import './panel.css';

type SearchResult = { question: string; guides: Guide[] };
type PanelSession = {
  draft: string;
  turns: Turn[];
  search: SearchResult | null;
  failed: boolean;
};

const newSession = (): PanelSession => ({ draft: '', turns: [], search: null, failed: false });
let currentSession = newSession();

function GuideDetails({ guide, open = false }: { guide: Guide; open?: boolean }) {
  return (
    <details className="ask-zana-guide" open={open}>
      <summary>{guide.title}</summary>
      <p>{guide.summary}</p>
      {guide.sections.map(({ title, steps }) => (
        <section key={title}>
          <h3>{title}</h3>
          <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </section>
      ))}
      {guide.source && <a href={guide.source.path} target="_blank" rel="noreferrer">{guide.source.label}</a>}
    </details>
  );
}

function ModelPicker({
  status, active, disabled, onSelect
}: {
  status: AssistantStatus;
  active: AvailableModel | null;
  disabled: boolean;
  onSelect: (choice: ModelChoice | null) => void;
}) {
  if (status.models.length === 0 || (status.models.length === 1 && status.defaultModel && !status.selection)) {
    return active ? <span>{active.providerLabel} · {active.modelLabel}</span> : null;
  }
  const groups = new Map<string, AvailableModel[]>();
  for (const model of status.models) {
    const group = groups.get(model.providerId) ?? [];
    group.push(model);
    groups.set(model.providerId, group);
  }
  return (
    <label className="ask-zana-model">
      <span>Model</span>
      <select
        value={status.selection ? modelKey(status.selection) : 'default'}
        disabled={disabled}
        onChange={(event) => onSelect(status.models.find((model) => modelKey(model) === event.target.value) ?? null)}
      >
        <option value="default">Use Zana default</option>
        {status.selection && !active && <option value={modelKey(status.selection)} disabled>Saved model unavailable</option>}
        {[...groups].map(([id, models]) => (
          <optgroup key={id} label={models[0].providerLabel}>
            {models.map((model) => <option key={model.modelId} value={modelKey(model)}>{model.modelLabel}</option>)}
          </optgroup>
        ))}
      </select>
      {active && <span className="ask-zana-active">{active.providerLabel} · {active.modelLabel}</span>}
    </label>
  );
}

export function AskZanaPanel() {
  const rpc = useRpc();
  const { openProviderSetup, onProviderChange, readProviderModelPreference, setPageContext } = useZccNavigate();
  const [session, setSession] = useState(currentSession);
  const [status, setStatus] = useState<AssistantStatus>(noAssistant);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsHint, setSettingsHint] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const statusRequest = useRef(0);
  const request = useRef(0);
  const previouslyUnavailable = useRef<boolean | null>(null);
  function rememberedDefault() {
    const providerId = status.defaultModel?.providerId;
    if (!providerId) return undefined;
    const offered = status.models.filter((model) => model.providerId === providerId);
    const preference = readProviderModelPreference?.(providerId, offered.map((model) => model.modelId));
    return offered.find((model) => model.modelId === preference);
  }

  const active = status.selection ? resolveModel(status) : rememberedDefault() ?? status.defaultModel;
  const canAsk = active !== null && !session.failed;
  const mode = canAsk ? 'Ask' : 'Search';

  function update(changes: Partial<PanelSession>) {
    currentSession = { ...currentSession, ...changes };
    if (mounted.current) setSession(currentSession);
  }

  async function refresh() {
    const version = ++statusRequest.current;
    try {
      const next = await rpc.call('status') as AssistantStatus;
      if (mounted.current && version === statusRequest.current) {
        const available = Boolean(resolveModel(next));
        if (available && previouslyUnavailable.current !== false && currentSession.failed) update({ failed: false });
        previouslyUnavailable.current = !available;
        setStatus(next);
      }
    } catch {
      // Bundled help is usable even while the plugin server is restarting.
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = onProviderChange?.(onFocus);
    return () => {
      mounted.current = false;
      statusRequest.current++;
      request.current++;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe?.();
    };
  }, [rpc, onProviderChange]);

  useEffect(() => {
    setPageContext?.({ title: 'Ask Zana', view: 'help' });
    return () => setPageContext?.(null);
  }, [setPageContext]);

  function openSetup() {
    if (!openProviderSetup?.()) setSettingsHint(true);
  }

  async function select(choice: ModelChoice | null) {
    setSelectionError(false);
    setSaving(true);
    try {
      const next = await rpc.call('selectModel', choice) as AssistantStatus;
      statusRequest.current++;
      if (mounted.current) setStatus(next);
      if (next.selection === null || resolveModel(next)) update({ failed: false });
    } catch {
      if (mounted.current) {
        setSelectionError(true);
        void refresh();
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function submit(value: string, retry = false) {
    const question = value.trim();
    if (!question || pending || saving) return;
    const matches = searchGuides(question);
    if (!canAsk && !retry) {
      update({ draft: active || status.selection || session.failed ? question : '', search: { question, guides: matches } });
      return;
    }
    const version = ++request.current;
    update({ draft: question, search: null, failed: false });
    setPending(true);
    try {
      const turn = await rpc.call('answer', {
        question, turns: session.turns.slice(-3), selection: status.selection,
        ...(status.selection ? {} : { preferredDefault: rememberedDefault() })
      }) as Turn | null;
      if (version !== request.current) return;
      if (turn) update({ turns: [...currentSession.turns, turn], draft: '' });
      else throw new Error('Assistant unavailable');
    } catch {
      if (version !== request.current) return;
      update({ search: { question, guides: matches }, failed: true });
      void refresh();
    } finally {
      if (mounted.current && version === request.current) setPending(false);
    }
  }

  function startOver() {
    request.current++;
    currentSession = newSession();
    setSession(currentSession);
    setPending(false);
    input.current?.focus();
  }

  const unavailable = session.failed || Boolean(status.selection && !active);
  const showExamples = session.turns.length === 0 || session.turns.at(-1)?.sourceIds.length === 0;
  return (
    <div className="ask-zana-panel">
      <main className="ask-zana-content">
        <div className="ask-zana-title">
          <h1>How can Zana help?</h1>
          {(session.turns.length > 0 || pending || session.search) &&
            <button type="button" className="ask-zana-quiet" onClick={startOver}>New conversation</button>}
        </div>
        <p className="ask-zana-intro">Find a guide, troubleshoot a connection, or explore what you can do in Zana.</p>

        {session.turns.length > 0 && (
          <div className="ask-zana-turns" aria-live="polite">
            {session.turns.map((turn, index) => (
              <article className="ask-zana-result" key={index}>
                <h2>{turn.question}</h2>
                <p className="ask-zana-answer">{turn.answer}</p>
                {turn.sourceIds.length > 0 && (
                  <div aria-label="Sources">
                    <h3>Sources</h3>
                    {turn.sourceIds.map((id) => {
                      const guide = guides.find((item) => item.id === id);
                      return guide ? <GuideDetails guide={guide} key={id} /> : null;
                    })}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        <form className="ask-zana-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(session.draft); }}>
          <div className="ask-zana-input-row">
            <input
              ref={input}
              type="text"
              value={session.draft}
              readOnly={pending}
              maxLength={MAX_QUESTION_LENGTH}
              autoComplete="off"
              aria-label={canAsk ? 'Ask a question about Zana' : 'Search Zana help'}
              placeholder={canAsk ? 'Ask a question about Zana' : 'Search Zana help'}
              onChange={(event) => update({ draft: event.target.value })}
            />
            <button className="ask-zana-primary" type="submit" disabled={!session.draft.trim() || pending || saving}>
              {mode}
            </button>
          </div>
          <div className="ask-zana-form-footer">
            <span>{canAsk ? 'Zana help with AI' : 'Built-in help'}</span>
            <ModelPicker status={status} active={active} disabled={saving} onSelect={(choice) => { void select(choice); }} />
            {!canAsk && (
              <button type="button" className="ask-zana-link" onClick={openSetup}>
                {unavailable ? 'Open provider settings' : 'Connect an AI provider'}
              </button>
            )}
          </div>
        </form>

        {settingsHint && <p className="ask-zana-status" role="status">Open Settings → AI Harness to set up a provider for this machine.</p>}
        {selectionError && <p className="ask-zana-status" role="status">Couldn’t save that model choice. Check availability and try again.</p>}
        {pending && <p className="ask-zana-status" role="status">Looking up Zana help…</p>}
        {unavailable && (
          <div className="ask-zana-status" role="status">
            <p>{status.selection && !active ? 'Your saved model is unavailable.' : 'AI couldn’t answer this question.'} You can still search Zana’s guides.</p>
            <div className="ask-zana-actions">
              {session.draft.trim() &&
                <button type="button" className="ask-zana-quiet" disabled={pending || saving} onClick={() => void submit(session.draft, true)}>Retry</button>}
              {status.selection && status.defaultModel &&
                <button type="button" className="ask-zana-quiet" disabled={saving} onClick={() => void select(null)}>Use Zana default</button>}
            </div>
          </div>
        )}

        {session.search && (
          <article className="ask-zana-result" aria-live="polite">
            <h2>{session.search.guides.length ? 'Built-in help' : 'No matching guide'}</h2>
            <p className="ask-zana-query">{session.search.question}</p>
            {session.search.guides.map((guide, index) => <GuideDetails key={guide.id} guide={guide} open={index === 0} />)}
            {session.search.guides.length === 0 && <p>Try a topic below or search for a feature by name.</p>}
          </article>
        )}

        {!pending && showExamples && (
          <div className="ask-zana-examples" role="group" aria-label="Example questions">
            {guides.map((guide) => (
              <button type="button" disabled={saving} key={guide.id} onClick={() => void submit(guide.example)}>{guide.example}</button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'Ask Zana',
    icon: 'CircleHelp',
    path: 'ask-zana',
    placement: 'sidebar',
    sidebarOrder: -10,
    component: AskZanaPanel
  });
});
