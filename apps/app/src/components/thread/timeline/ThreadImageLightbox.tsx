import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from '../../Modal.js';
import { ThreadDisplayedImage } from './ThreadDisplayedImage.js';
import {
  resolveLightboxSelection,
  type ThreadLightboxItem
} from './thread-image-lightbox.js';

export function ThreadImageLightbox({
  src,
  alt,
  items,
  threadId,
  onClose
}: {
  src: string;
  alt: string;
  items?: readonly ThreadLightboxItem[];
  threadId?: string;
  onClose: () => void;
}) {
  const gallery = items && items.length > 0 ? items : [{ src, alt }];
  const [selectedSrc, setSelectedSrc] = useState(src);
  useEffect(() => {
    setSelectedSrc(src);
  }, [src]);
  const current = resolveLightboxSelection(gallery, selectedSrc) ?? { src, alt };
  const index = Math.max(0, gallery.findIndex((item) => item.src === current.src));
  const showNav = gallery.length > 1;
  const title = current.alt.trim() || 'Image';

  useEffect(() => {
    if (!showNav) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSelectedSrc(gallery[(index - 1 + gallery.length) % gallery.length]!.src);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSelectedSrc(gallery[(index + 1) % gallery.length]!.src);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gallery, index, showNav]);

  return (
    <Modal
      title={title}
      onClose={onClose}
      className="thread-image-modal"
      bodyClassName="thread-image-modal-body"
    >
      <div className="thread-image-modal-stage">
        {showNav ? (
          <button
            type="button"
            className="thread-image-modal-nav is-prev"
            aria-label="Previous image"
            onClick={() => setSelectedSrc(gallery[(index - 1 + gallery.length) % gallery.length]!.src)}
          >
            <ChevronLeft size={18} />
          </button>
        ) : null}
        <ThreadDisplayedImage key={current.src} path={current.src} alt={title} threadId={threadId} variant="lightbox" />
        {showNav ? (
          <button
            type="button"
            className="thread-image-modal-nav is-next"
            aria-label="Next image"
            onClick={() => setSelectedSrc(gallery[(index + 1) % gallery.length]!.src)}
          >
            <ChevronRight size={18} />
          </button>
        ) : null}
      </div>
      {showNav ? (
        <p className="thread-image-modal-count" data-testid="thread-image-lightbox-count">
          {index + 1} of {gallery.length}
        </p>
      ) : null}
    </Modal>
  );
}
