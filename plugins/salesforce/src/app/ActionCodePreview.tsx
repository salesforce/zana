import { useEffect, useRef } from 'react';
import { PLAYGROUND_ASSET_SRC, PLAYGROUND_BRIDGE_SOURCE, readDocumentTheme, type HostToPlayground, type ReferenceLanguage } from './playground-bridge.js';

/** Read-only Monaco for source beside an agent; `line` reveals a line, else Apex opens at its @InvocableMethod. */
export function ActionCodePreview({ content, language, line, title = 'Action implementation source', className = 'af-action-code' }: {
  content: string; language: ReferenceLanguage; line?: number; title?: string; className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef({ content, language, line });
  latest.current = { content, language, line };
  const send = () => {
    if (!ready.current) return;
    const { content: text, language: lang, line: target } = latest.current;
    const index = lang === 'apex' ? text.split('\n').findIndex(row => /@InvocableMethod\b/i.test(row)) : -1;
    const message: HostToPlayground = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', content: text, language: lang, line: target ?? (index >= 0 ? index + 1 : 1), theme: readDocumentTheme() };
    frame.current?.contentWindow?.postMessage(message, location.origin);
  };
  useEffect(send, [content, language, line]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.source === PLAYGROUND_BRIDGE_SOURCE && event.data?.type === 'ready') { ready.current = true; send(); }
    };
    const observer = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'setTheme', theme: readDocumentTheme() }, location.origin));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('message', listener);
    return () => { window.removeEventListener('message', listener); observer.disconnect(); };
  }, []);
  return <iframe ref={frame} className={className} title={title} src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : `${PLAYGROUND_ASSET_SRC}?reference=1`} />;
}
