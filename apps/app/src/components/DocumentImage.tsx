import { useEffect, useState } from 'react';
import { product } from '../lib/product-client.js';
import { resolveDocumentImagePath } from './markdown-document-image.js';
import { isPreviewImagePath, loadFilePreview } from './thread/secondary-panel/threadSecondaryPanelLogic.js';

/** Uses the same bounded, confined readers as the file preview itself. */
export function DocumentImage({ documentPath, src, alt, title, threadId, storage = false }: {
  documentPath: string;
  src: string;
  alt: string;
  title?: string;
  threadId?: string;
  storage?: boolean;
}) {
  const path = resolveDocumentImagePath(documentPath, src);
  const [loaded, setLoaded] = useState<{ key: string; src: string } | null>(null);
  const key = JSON.stringify([path, threadId, storage]);
  useEffect(() => {
    if (!path || !isPreviewImagePath(path)) return;
    let cancelled = false;
    const reader = storage ? product.threads.storageContent : product.threads.hostFileContent;
    void loadFilePreview(product.fs.readFile, reader, threadId, path, {
      skipLocal: storage,
      readDataUrl: product.fs.readDataUrl
    }).then((result) => {
      if (!cancelled && 'content' in result && result.content.startsWith('data:image/')) {
        setLoaded({ key, src: result.content });
      }
    });
    return () => { cancelled = true; };
  }, [path, threadId, storage, key]);
  if (loaded?.key !== key) return <span title={src}>{alt}</span>;
  return <img className="inbox-md-img" src={loaded.src} alt={alt} title={title} loading="lazy" decoding="async" />;
}
