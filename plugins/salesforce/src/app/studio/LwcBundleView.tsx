import { useEffect, useMemo, useState } from 'react';
import { Eye, Shapes } from 'lucide-react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { cachedRead, readCacheKey, rememberRead } from './read-cache.js';
import { fileRole, highlight, type SourceLang } from './bundle-format.js';
import { sketchLwc } from './lwc-sketch.js';
import { UsedByAgents } from './UsedByAgents.js';
import { STUDIO_RPC, type LwcBundleView as LwcBundleData } from '../../../lib/studio-contract.js';

/** The file strip's index for the sketch tab. */
const SKETCH = -1;

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: LwcBundleData };

/**
 * Read-only component tab: an LWC a Lightning Type renders or edits with. Shows the agents and types that reach it,
 * then the bundle's top-level files (markup, controller, styles, metadata) and a static sketch of its template.
 * A component outside the project explains itself.
 */
export function LwcBundleView({ pluginId, projectId, componentRef, usedBy, via, onOpenAgent, onOpenType }: {
  pluginId: string;
  projectId?: string;
  componentRef: string;
  usedBy?: string[];
  via?: string[];
  onOpenAgent(path: string): void;
  onOpenType(ref: string): void;
}) {
  const key = readCacheKey(pluginId, projectId, 'lwc', componentRef);
  const initial = (): Load => { const data = cachedRead<LwcBundleData>(key); return data ? { state: 'ready', data } : { state: 'loading' }; };
  const [load, setLoad] = useState<Load>(initial);
  const [file, setFile] = useState(0);
  useEffect(() => {
    let alive = true;
    // A remount keeps the last answer on screen while it reads again; a new ref starts over.
    setLoad(initial());
    Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.lwc, { ...(projectId ? { projectId } : {}), ref: componentRef }))
      .then(result => {
        const res = result as { ok?: boolean; data?: LwcBundleData; error?: string } | null;
        if (!alive) return;
        if (res?.ok && res.data) { rememberRead(key, res.data); setLoad({ state: 'ready', data: res.data }); }
        else setLoad({ state: 'error', message: res?.error || 'The component could not be read.' });
      })
      .catch(err => { if (alive) setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names exactly these inputs.
  }, [key]);

  const data = load.state === 'ready' ? load.data : null;
  const name = data?.name || componentRef.split('/').pop() || componentRef;
  const template = data?.files.find(row => !row.truncated && fileRole(row.path, name).label === 'template');
  const style = data?.files.find(row => !row.truncated && fileRole(row.path, name).label === 'styles');
  const sketch = useMemo(() => template ? sketchLwc(template.content, style?.content) : '', [template, style]);
  const shown = file === SKETCH ? undefined : data?.files[file];
  const [copied, setCopied] = useState(false);
  const copy = (content: string) => {
    void Promise.resolve(navigator.clipboard?.writeText(content)).then(() => setCopied(true), () => undefined);
  };
  useEffect(() => { setCopied(false); }, [file, key]);
  return <section className="sf-lt" data-testid="lwc-bundle-view" aria-label={`Component ${componentRef}`}>
    <header className="sf-lt-head">
      <div>
        <h2>{data?.name || componentRef}</h2>
        <div className="sf-lt-meta">
          <code>{componentRef}</code>
          <span className="sf-lt-badge">{data ? data.status === 'missing' ? 'Not in project' : 'Lightning Web Component' : 'Component'}</span>
          {data?.path && <span className="sf-lt-path" title={data.path}>{data.path}</span>}
        </div>
      </div>
    </header>
    {load.state === 'loading' && <p className="sf-lt-note">Loading…</p>}
    {load.state === 'error' && <p className="sf-lt-note is-error" role="alert">{load.message}</p>}
    {data?.message && <p className={`sf-lt-note${data.status === 'ready' ? ' is-warn' : ''}`}>{data.message}</p>}
    {((via && via.length > 0) || (usedBy && usedBy.length > 0)) && <dl className="sf-lt-rel">
      {via && via.length > 0 && <div className="sf-lt-relrow">
        <dt>Renders</dt>
        <dd className="sf-lt-chips">{via.map(ref => <button key={ref} type="button" className="sf-lt-chip" title={ref} onClick={() => onOpenType(ref)}><Shapes size={13} className="is-type" aria-hidden="true" />{ref}</button>)}</dd>
      </div>}
      {usedBy && usedBy.length > 0 && <UsedByAgents usedBy={usedBy} onOpenAgent={onOpenAgent} />}
    </dl>}
    {data && data.files.length > 0 && <div className="sf-lt-bundle">
      <div className="sf-lt-filebar" role="tablist" aria-label="Bundle files">
        {data.files.map((row, index) => {
          const role = fileRole(row.path, name);
          return <button key={row.path} type="button" role="tab" aria-selected={index === file} title={row.path} onClick={() => setFile(index)}>
            {role.ext && <span className="sf-lt-ext">{role.ext}</span>}{role.label}
          </button>;
        })}
        {sketch && <button type="button" role="tab" aria-selected={file === SKETCH} title="A static sketch of the template and styles" onClick={() => setFile(SKETCH)}>
          <Eye size={12} aria-hidden="true" />Sketch
        </button>}
        <span className="sf-lt-filebar-gap" />
        {shown && !shown.truncated && <button type="button" className="sf-lt-copy" onClick={() => copy(shown.content)}>{copied ? 'Copied' : 'Copy'}</button>}
      </div>
      {file === SKETCH && sketch && <div className="sf-lt-sketch">
        <p className="sf-lt-note">Static sketch: every branch shows once in a labelled box, bindings show as placeholders, and base components and JavaScript do not run.</p>
        <iframe title={`Sketch of ${name}`} sandbox="" srcDoc={sketch} />
      </div>}
      {shown && (shown.truncated
        ? <pre className="sf-lt-source" aria-label={`Source of ${shown.path}`}>This file is larger than 256 KB. Open it in your editor to read it.</pre>
        : <SourceView path={shown.path} content={shown.content} lang={fileRole(shown.path, name).lang} />)}
    </div>}
  </section>;
}

/** Read-only source with line numbers and light colour cues. */
function SourceView({ path, content, lang }: { path: string; content: string; lang: SourceLang }) {
  const tokens = useMemo(() => highlight(content, lang), [content, lang]);
  const lines = useMemo(() => Array.from({ length: content.split('\n').length }, (_, at) => at + 1).join('\n'), [content]);
  return <div className="sf-lt-code">
    <pre className="sf-lt-gutter" aria-hidden="true">{lines}</pre>
    <pre className="sf-lt-source" aria-label={`Source of ${path}`}>{tokens.map((token, at) => token.kind ? <span key={at} className={`tok-${token.kind}`}>{token.text}</span> : token.text)}</pre>
  </div>;
}
