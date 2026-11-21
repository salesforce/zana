import { useEffect, useRef, useState, type RefCallback } from 'react';
import { product } from '../../lib/product-client.js';
import MarkdownDocument from './MarkdownDocument.js';
import { recallMarkdownDraft, rememberMarkdownDraft } from './markdown-drafts.js';

interface Snapshot { content: string; sha256: string }
/** Thread workspace files only. Storage/attachment previews never acquire write authority. */
export function MarkdownFilePreview({ content, path, threadId, projectId, storage = false, revision = 0, previewRef }: {
  content: string; path: string; threadId?: string; projectId?: string | null; storage?: boolean; revision?: number; previewRef?: RefCallback<HTMLDivElement>;
}) {
  const identity = JSON.stringify(['thread-markdown', threadId, projectId, storage, path]);
  const cached = recallMarkdownDraft(identity);
  const [saved, setSaved] = useState<Snapshot | null>(() => cached?.sha256 ? { content: cached.content, sha256: cached.sha256 } : null);
  const [draft, setDraft] = useState(cached?.draft ?? content);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [reason, setReason] = useState<string | undefined>('Checking the owning checkout…');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const state = useRef({ saved, draft }); state.current = { saved, draft };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (storage || !threadId || !product.threads.readMarkdown) {
      if (!state.current.saved) setDraft(content);
      setReason(storage ? 'Thread storage is read only in this viewer.' : 'This preview has no writable checkout.');
      return;
    }
    let cancelled = false;
    void product.threads.readMarkdown(threadId, path, projectId ?? undefined).then(result => {
      if (cancelled) return;
      if (!result.ok || result.content === undefined || !result.sha256) throw new Error(result.message ?? 'This file cannot be edited.');
      const next = { content: result.content, sha256: result.sha256 };
      const current = state.current;
      if (current.saved && current.draft !== current.saved.content && current.saved.sha256 !== next.sha256) setLatest(next);
      else if (!current.saved || current.draft === current.saved.content) { setDraft(next.content); setSaved(next); }
      setReason(undefined);
    }).catch(err => { if (!cancelled) { if (state.current.saved) setError(String(err)); else setReason(String(err)); } });
    return () => { cancelled = true; };
  }, [content, path, threadId, projectId, storage, revision, refresh]);

  const save = async () => {
    if (!saved || saving || !threadId || latest) return;
    const submitted = draft;
    setSaving(true); setError(undefined);
    try {
      const result = await product.threads.writeMarkdown(threadId, { path, projectId: projectId ?? undefined, content: submitted, expectedSha256: saved.sha256 });
      if (!alive.current) return;
      if (!result.ok || !result.sha256) { setError(result.message ?? 'Save failed. Your draft has been kept.'); setRefresh(value => value + 1); return; }
      setSaved({ content: submitted, sha256: result.sha256 });
      rememberMarkdownDraft(identity, { content: submitted, draft: state.current.draft, sha256: result.sha256 });
    } catch (err) { if (alive.current) setError(`Save failed. Your draft has been kept. ${err}`); }
    finally { if (alive.current) setSaving(false); }
  };
  return <div className="md-file-preview">
    {error && <p role="alert" className="md-document-notice">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Review latest version</button></p>}
    {latest && <div className="md-document-conflict" role="region" aria-label="Markdown save conflict">
      <p>This file changed on its machine. Your draft has been kept. Review the latest source and merge changes in Source before saving.</p>
      <pre aria-label="Latest saved version">{latest.content}</pre>
      <button type="button" onClick={() => { setSaved(latest); rememberMarkdownDraft(identity, { content: latest.content, draft, sha256: latest.sha256 }); setLatest(null); setError(undefined); }}>Use reviewed revision for next save</button>
      <button type="button" onClick={() => { if (window.confirm('Discard your unsaved draft and use the latest version?')) { setSaved(latest); setDraft(latest.content); rememberMarkdownDraft(identity, { content: latest.content, draft: latest.content }); setLatest(null); setError(undefined); } }}>Discard draft and use latest</button>
    </div>}
    <MarkdownDocument value={draft} savedValue={saved?.content ?? content} documentPath={path} threadId={threadId} projectId={projectId} storage={storage} previewRef={previewRef}
      onChange={saved ? next => { setDraft(next); rememberMarkdownDraft(identity, { content: saved.content, draft: next, sha256: saved.sha256 }); } : undefined} onSave={latest ? undefined : () => void save()} saving={saving} readOnlyReason={reason} />
  </div>;
}
