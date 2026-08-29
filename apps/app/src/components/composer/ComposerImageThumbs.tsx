import { X } from 'lucide-react';

export interface ComposerImageThumb {
  id: string;
  name: string;
  src: string;
}

export function ComposerImageThumbs({
  images,
  onRemove,
  onOpen
}: {
  images: readonly ComposerImageThumb[];
  onRemove?: (id: string) => void;
  onOpen?: (image: ComposerImageThumb) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="composer-image-thumbs" aria-label="Attached images">
      {images.map((image) => (
        <div key={image.id} className="composer-image-thumb">
          {onOpen ? (
            <button
              type="button"
              className="composer-image-thumb-preview"
              title={image.name}
              onClick={() => onOpen(image)}
            >
              <img src={image.src} alt={image.name} loading="lazy" decoding="async" />
            </button>
          ) : (
            <span className="composer-image-thumb-preview" title={image.name}>
              <img src={image.src} alt={image.name} loading="lazy" decoding="async" />
            </span>
          )}
          {onRemove ? (
            <button
              type="button"
              className="composer-image-thumb-remove"
              aria-label={`Remove ${image.name}`}
              onClick={() => onRemove(image.id)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
