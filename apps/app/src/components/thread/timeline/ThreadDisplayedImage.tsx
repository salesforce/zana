import { useEffect, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { isRemoteOrBlobImageSrc, isSafeImageDataUrl, threadImageStubLabel } from './thread-inline-images.js';
import { imageContentTypeFromPath, imagePreviewSrc } from './work-row-helpers.js';

function immediateSrc(path: string): string | null {
  const trimmed = path.trim();
  if (isSafeImageDataUrl(trimmed) || isRemoteOrBlobImageSrc(trimmed)) return trimmed;
  return null;
}

export function ThreadDisplayedImage({
  path,
  threadId,
  alt,
  variant = 'view',
  onOpen
}: {
  path: string;
  threadId?: string;
  alt?: string;
  variant?: 'view' | 'thumb';
  onOpen?: (src: string, label: string) => void;
}) {
  const direct = immediateSrc(path);
  const [src, setSrc] = useState<string | null>(direct);
  const [failed, setFailed] = useState(false);
  const label = alt?.trim() || threadImageStubLabel(path);

  useEffect(() => {
    if (direct) {
      setSrc(direct);
      setFailed(false);
      return;
    }
    if (!threadId) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void product.threads.hostFileContent(threadId, path).then((file) => {
      if (cancelled) return;
      const preview = imagePreviewSrc({
        content: file.content,
        encoding: file.encoding,
        contentType: file.contentType ?? imageContentTypeFromPath(path)
      });
      if (preview) setSrc(preview);
      else setFailed(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [direct, path, threadId]);

  if (!src || failed) {
    return (
      <p className="thread-image-stub" data-testid="thread-image-stub">{label}</p>
    );
  }

  const img = (
    <img
      className={variant === 'thumb' ? undefined : 'thread-image-thumb'}
      src={src}
      alt={label}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
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
    <button type="button" className="thread-image-open" onClick={() => onOpen(src, label)}>
      {img}
    </button>
  ) : img;
}
