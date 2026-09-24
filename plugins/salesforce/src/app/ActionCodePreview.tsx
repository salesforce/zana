import { useEffect, useRef } from 'react';
import { PLAYGROUND_ASSET_SRC, PLAYGROUND_BRIDGE_SOURCE, readDocumentTheme, type HostToPlayground } from './playground-bridge.js';

export function ActionCodePreview({ content, language }: { content: string; language: 'apex' | 'xml' | 'json' }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef({ content, language });
  latest.current = { content, language };
  const send = () => {
    if (!ready.current) return;
    const value = latest.current;
    const index = value.language === 'apex' ? value.content.split('\n').findIndex(line => /@InvocableMethod\b/i.test(line)) : -1;
    const message: HostToPlayground = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', ...value, line: index >= 0 ? index + 1 : 1, theme: readDocumentTheme() };
    frame.current?.contentWindow?.postMessage(message, location.origin);
  };
  useEffect(send, [content, language]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.source === PLAYGROUND_BRIDGE_SOURCE && event.data?.type === 'ready') { ready.current = true; send(); }
    };
    const observer = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'setTheme', theme: readDocumentTheme() }, location.origin));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('message', listener);
    return () => { window.removeEventListener('message', listener); observer.disconnect(); };
  }, []);
  return <iframe ref={frame} className="af-action-code" title="Action implementation source" src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : `${PLAYGROUND_ASSET_SRC}?reference=1`} />;
}
