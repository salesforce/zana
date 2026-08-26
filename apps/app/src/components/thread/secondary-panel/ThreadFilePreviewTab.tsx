import { useEffect, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { applyPreviewResult, loadFilePreview, previewKind } from './threadSecondaryPanelLogic.js';

export function ThreadFilePreviewView({
  path,
  content,
  error
}: {
  path: string;
  content: string;
  error: string | null;
}) {
  if (error) return <p className="thread-detail-empty">{error}</p>;
  if (previewKind(path, content) === 'image') {
    return <img className="thread-file-preview-image" src={content} alt={path} />;
  }
  return (
    <pre className="thread-file-preview" data-testid="thread-file-preview">
      {content}
    </pre>
  );
}

export function ThreadFilePreviewTab({
  threadId,
  path
}: {
  threadId?: string;
  path: string;
}) {
  const [content, setContent] = useState<string>('Loading…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFilePreview(
      product.fs.readFile,
      threadId ? product.threads.hostFileContent : undefined,
      threadId,
      path
    ).then((result) => {
      applyPreviewResult(cancelled, result, setError, setContent);
    });
    return () => { cancelled = true; };
  }, [path, threadId]);

  return <ThreadFilePreviewView path={path} content={content} error={error} />;
}
