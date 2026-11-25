import { useEffect, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';

interface MemoryPage {
  memories: Array<{ id: string; name: string; summary: string; details: string }>;
  hasMore: boolean;
}

export function BotMemory({ tag, projectId }: { tag: string; projectId: string }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<MemoryPage | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    setPage(null);
    callPluginRpc('memory', 'listTagged', { tag, projectId, offset })
      .then(result => { if (live) setPage(result as MemoryPage); })
      .catch(() => { if (live) setError('Couldn’t load memories. Check that the Memory plugin is enabled and up to date.'); });
    return () => { live = false; };
  }, [tag, projectId, offset, retry]);
  return <>
    {error ? <div className="bt-row"><span role="alert">{error}</span><button className="bt-btn" onClick={() => setRetry(retry + 1)}>Retry</button></div>
      : !page ? <p className="bt-empty-line">Loading memories…</p>
      : !page.memories.length ? <p className="bt-empty-line">{offset ? 'No memories on this page.' : 'No memories yet.'}</p>
      : page.memories.map(memory => <details className="bt-memory" key={memory.id}>
          <summary><span><span className="bt-row-title">{memory.name}</span><span className="bt-sub">{memory.summary}</span></span></summary>
          <p>{memory.details}</p>
        </details>)}
    {(offset > 0 || page?.hasMore) && <div className="bt-row">
      <button className="bt-btn" disabled={!offset} onClick={() => setOffset(offset - 20)}>Previous</button>
      <button className="bt-btn" disabled={!page?.hasMore} onClick={() => setOffset(offset + 20)}>Next</button>
    </div>}
    <details className="bt-memory"><summary>CLI command</summary><code>zcc memory search {tag} --scope all</code></details>
  </>;
}
