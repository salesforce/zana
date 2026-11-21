import { useEffect, useRef, useState } from 'react';
import type { FsReadResult } from '@zana-ai/zcc-domain/product';

export function MarkdownSaveRecovery({ message, read, onUseReviewed, onDiscard }: {
  message: string;
  read: () => Promise<FsReadResult>;
  onUseReviewed: (latest: FsReadResult) => void;
  onDiscard: (latest: FsReadResult) => void;
}) {
  const [latest, setLatest] = useState<FsReadResult | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <div className="md-document-conflict" role="region" aria-label="Markdown save recovery">
    <p role="alert">{message} Your draft has been kept.</p>
    {error && <p role="alert">{error}</p>}
    {!latest ? <button type="button" disabled={loading} onClick={async () => {
      setLoading(true); setError(undefined);
      try {
        const result = await read();
        if (!alive.current) return;
        if (!result.ok || result.content === undefined || !result.sha256 || result.truncated || result.binary) throw new Error(result.message ?? 'The complete latest revision is unavailable.');
        setLatest(result);
      } catch (err) { if (alive.current) setError(String(err)); }
      finally { if (alive.current) setLoading(false); }
    }}>{loading ? 'Loading latest…' : 'Review latest version'}</button> : <>
      <p>Merge the latest source into your draft before saving.</p>
      <pre aria-label="Latest saved version">{latest.content}</pre>
      <button type="button" onClick={() => onUseReviewed(latest)}>Use reviewed revision for next save</button>
      <button type="button" onClick={() => { if (window.confirm('Discard your unsaved draft and use the latest version?')) onDiscard(latest); }}>Discard draft and use latest</button>
    </>}
  </div>;
}
