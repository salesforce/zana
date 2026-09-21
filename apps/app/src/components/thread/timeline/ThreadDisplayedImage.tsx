import { useEffect, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { isRemoteOrBlobImageSrc, isSafeImageDataUrl, threadImageStubLabel } from './thread-inline-images.js';
import { imageContentTypeFromPath, imagePreviewSrc } from './work-row-helpers.js';
import { resolveDocumentImagePath } from '../../markdown-document-image.js';

function immediateSrc(path: string): string | null {
  const trimmed = path.trim();
  if (isSafeImageDataUrl(trimmed) || isRemoteOrBlobImageSrc(trimmed)) return trimmed;
  if (/^\/api\/v1\/projects\/[^/]+\/attachments\/content\?/u.test(trimmed)) return trimmed;
  return null;
}

export function ThreadDisplayedImage({
  path,
  threadId,
  alt,
  variant = 'view',
  title,
  onOpen
}: {
  path: string;
  threadId?: string;
  alt?: string;
  variant?: 'view' | 'thumb' | 'markdown' | 'lightbox';
  title?: string;
  onOpen?: (src: string, label: string) => void;
}) {
  const direct = immediateSrc(path);
  const key = JSON.stringify([path, threadId]);
  const [loaded, setLoaded] = useState<{ key: string; src: string | null } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const src = direct ?? (loaded?.key === key ? loaded.src : null);
  const failed = failedKey === key;
  const label = alt?.trim() || threadImageStubLabel(path);

  useEffect(() => {
    if (direct) return;
    let cancelled = false;
    const read = async () => {
      const candidate = resolveDocumentImagePath('', path);
      if (!candidate) return null;
      // Desktop authorizes registered project files, including a linked image
      // in another project. Relative/remote files belong to the thread host.
      if (/^(\/|[a-z]:[/\\])/iu.test(candidate) && product.fs?.readDataUrl) {
        try {
          const local = await product.fs.readDataUrl(candidate);
          if (local.ok && local.dataUrl && isSafeImageDataUrl(local.dataUrl)) return local.dataUrl;
        } catch { /* try the thread host */ }
      }
      if (!threadId) return null;
      const file = await product.threads.hostFileContent(threadId, candidate);
      const preview = imagePreviewSrc({
        content: file.content,
        encoding: file.encoding,
        contentType: file.contentType ?? imageContentTypeFromPath(path)
      });
      return preview;
    };
    void read().then((preview) => {
      if (cancelled) return;
      setLoaded({ key, src: preview });
      if (!preview) setFailedKey(key);
    }).catch(() => {
      if (!cancelled) setFailedKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [direct, path, threadId, key]);

  if (!src || failed) {
    return (
      <span className="thread-image-stub" data-testid="thread-image-stub">
        {label}{failed ? ' — Image unavailable' : ''}
      </span>
    );
  }

  const img = (
    <img
      className={variant === 'markdown' ? 'inbox-md-img' : variant === 'view' ? 'thread-image-thumb' : undefined}
      src={src}
      alt={label}
      title={title}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onError={() => setFailedKey(key)}
    />
  );

  if (variant === 'thumb') {
    return onOpen ? (
      <button
        type="button"
        className="composer-image-thumb-preview"
        title={label}
        onClick={() => onOpen(src, label)}
      >
        {img}
      </button>
    ) : (
      <span className="composer-image-thumb-preview" title={label}>{img}</span>
    );
  }

  return onOpen ? (
    <button type="button" className={variant === 'markdown' ? 'inbox-md-img-open' : 'thread-image-open'} aria-label={`View ${label}`} onClick={() => onOpen(src, label)}>
      {img}
    </button>
  ) : img;
}
