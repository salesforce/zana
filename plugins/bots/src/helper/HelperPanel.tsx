import { Markdown, useRealtime, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { browseGuides, helpCatalog, type HelperGuide } from './catalog.js';
import type { HelperProfile } from './service.js';
import { HELPER_CHANGED, HELPER_NAME, MAX_HELPER_QUESTION_LENGTH } from './shared.js';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Zana Helper is temporarily unavailable.';
}

export function useHelperProfile() {
  const rpc = useRpc();
  const [profile, setProfile] = useState<HelperProfile | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const value = await rpc.call('helperProfile') as HelperProfile;
      if (request === generation.current) { setProfile(value); setError(''); }
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason));
    }
  }, [rpc]);
  useEffect(() => {
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);
  useRealtime(HELPER_CHANGED, () => void refresh());

  const setHidden = async (hidden: boolean) => {
    setSaving(true);
    setError('');
    try {
      const value = await rpc.call('helperVisibility', { hidden }) as HelperProfile;
      generation.current++;
      setProfile(value);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  return { profile, error, saving, setHidden, refresh };
}

const suggestions = [
  'How do I add a project?',
  'How do I schedule a task?',
  'Which provider does my bot use?'
];

export function HelperPanel({ helper }: { helper: ReturnType<typeof useHelperProfile> }) {
  const rpc = useRpc();
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [sendError, setSendError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);

  async function newConversation() {
    setSendError('');
    try {
      await rpc.call('helperNewConversation');
      await helper.refresh();
      field.current?.focus();
    } catch (reason) {
      setSendError(errorText(reason));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || pending.current) return;
    pending.current = true;
    setAsking(true);
    setSendError('');
    try {
      await rpc.call('helperAsk', { question: text });
      setQuestion('');
      await helper.refresh();
    } catch (reason) {
      setSendError(errorText(reason));
    } finally {
      pending.current = false;
      setAsking(false);
      field.current?.focus();
    }
  }

  return (
    <div className="bt-page">
      <header className="bt-hero">
        <div className="bt-hero-text">
          <h2>{HELPER_NAME}</h2>
          <p>Ask about Zana setup and features, or paste a prompt for feedback.</p>
        </div>
        <button type="button" className="bt-btn" disabled={helper.saving} onClick={() => void helper.setHidden(true)}>Hide Zana Helper</button>
      </header>
      {(helper.profile?.conversationTurns ?? 0) > 0 && (
        <button type="button" className="bt-btn" disabled={asking} onClick={() => void newConversation()}>
          Start a new conversation
        </button>
      )}
      <p className="bt-note">Uses the Default Project’s AI provider. Guides for Zana {helpCatalog.version} are available offline.</p>

      <div aria-live="polite">
        {helper.profile?.turns.map(({ question: asked, answer, sources }, index) => (
          <article className="bt-section" key={index}>
            {index === (helper.profile?.turns.length ?? 0) - (helper.profile?.conversationTurns ?? 0) && index > 0
              && <hr aria-label="New conversation" />}
            <h3>You</h3>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{asked}</p>
            <h3>{HELPER_NAME}</h3>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{answer}</p>
            {sources.length > 0 && <ul aria-label="Related guides">{sources.map(({ title, url }) => (
              <li key={url}><a href={url}>{title}</a></li>
            ))}</ul>}
          </article>
        ))}
      </div>
      <form className="bt-form settings-field" onSubmit={event => void submit(event)}>
        <div className="bt-row">
          {suggestions.map(suggestion => (
            <button key={suggestion} type="button" className="bt-btn" disabled={asking}
              onClick={() => { setQuestion(suggestion); field.current?.focus(); }}>{suggestion}</button>
          ))}
        </div>
        <label className="bt-form-row">Message {HELPER_NAME}
          <textarea ref={field} value={question} maxLength={MAX_HELPER_QUESTION_LENGTH} rows={3} readOnly={asking}
            onChange={event => setQuestion(event.target.value)} />
        </label>
        {sendError && <p role="alert" className="bt-alert">{sendError} You can browse the guides below.</p>}
        <div className="bt-form-footer">
          <button className="bt-btn is-primary" type="submit" disabled={asking || !question.trim()}>
            {asking ? 'Answering…' : 'Send'}
          </button>
        </div>
      </form>
      <GuideBrowser />
    </div>
  );
}

function GuideBrowser() {
  const rpc = useRpc();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState(helpCatalog.entries);
  const guides = browseGuides(entries, query);

  function onToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget !== event.target || !event.currentTarget.open) return;
    void rpc.call('helperGuides').then(value => setEntries(value as HelperGuide[])).catch(() => {
      // The bundled guides already render while the refresh is unavailable.
    });
  }

  return (
    <details className="bt-memory" onToggle={onToggle}>
      <summary>Browse Zana guides</summary>
      <label className="bt-field">Search guides
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      {guides.length === 0 && <p>No matching guides.</p>}
      {guides.map(({ id, title, guide, text, url }) => (
        <details className="bt-memory" key={id}>
          <summary>{guide} · {title}</summary>
          <Markdown content={text.replace(/\]\(\/([^\s)]+)\)/g, '](https://zana-ide.com/$1)')} />
          <a href={url}>Read {title}</a>
        </details>
      ))}
    </details>
  );
}
