export function ThreadImageLightbox({
  src,
  alt,
  onClose
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div className="thread-image-lightbox" role="dialog" aria-label={alt}>
      <button type="button" className="thread-image-lightbox-close" onClick={onClose}>
        Close
      </button>
      <img src={src} alt={alt} />
    </div>
  );
}
