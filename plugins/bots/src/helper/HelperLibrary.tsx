import { Markdown, useRealtime, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Section } from '../BotSection.js';
import { browseGuides, guideMarkdown, helpCatalog, HELPER_GUIDES_CHANGED, type HelperGuide } from './catalog.js';
import type { LegacyHelperTurn } from './shared.js';

export function HelperLibrary() {
  const rpc = useRpc();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState(helpCatalog.entries);
  const guideRequest = useRef(0);
  const [history, setHistory] = useState<LegacyHelperTurn[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const guides = browseGuides(entries, query);

  const refreshGuides = useCallback(() => {
    const request = ++guideRequest.current;
    void rpc.call('helperGuides').then(value => {
      if (request === guideRequest.current) setEntries(value as HelperGuide[]);
    }).catch(() => {
      // Keep the currently displayed guides if the RPC is unavailable.
    });
  }, [rpc]);

  useRealtime(HELPER_GUIDES_CHANGED, refreshGuides);
  useEffect(() => {
    refreshGuides();
    return () => { guideRequest.current++; };
  }, [refreshGuides]);

  useEffect(() => {
    let live = true;
    void rpc.call('helperHistory').then(value => {
      if (live) setHistory(value as LegacyHelperTurn[]);
    }).catch(() => {
      if (live) setHistoryError(true);
    });
    return () => { live = false; };
  }, [rpc]);

  return <>
    <Section label="Browse Zana guides">
      <p className="bt-empty-line">Guides for Zana {helpCatalog.version} are available offline.</p>
      <label className="bt-form-row">Search guides
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      {guides.length === 0 && <p className="bt-empty-line">No matching guides.</p>}
      {guides.map(({ id, title, guide, text, url }) => (
        <details className="bt-memory" key={id}>
          <summary>{guide} · {title}</summary>
          <Markdown content={guideMarkdown(text, url)} />
          <a href={url} target="_blank" rel="noreferrer">Read {title}</a>
        </details>
      ))}
    </Section>
    {(history.length > 0 || historyError) && <Section label="Earlier Helper conversations">
      {historyError && <p role="alert" className="bt-empty-line">Couldn’t load earlier conversations.</p>}
      {history.map(({ question, answer, attachments, sources }, index) => (
        <details className="bt-memory" key={index}>
          <summary>{question}</summary>
          {attachments?.length ? <p className="bt-note">{attachments.join(', ')}</p> : null}
          <p>{answer}</p>
          {sources?.length > 0 && <ul aria-label="Related guides">{sources.map(({ title, url }) => (
            <li key={url}><a href={url} target="_blank" rel="noreferrer">{title}</a></li>
          ))}</ul>}
        </details>
      ))}
    </Section>}
  </>;
}
