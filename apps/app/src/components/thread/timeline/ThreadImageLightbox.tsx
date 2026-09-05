import { Modal } from '../../Modal.js';

export function ThreadImageLightbox({
  src,
  alt,
  onClose
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const title = alt.trim() || 'Image';
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="thread-image-modal"
      bodyClassName="thread-image-modal-body"
    >
      <img src={src} alt={title} />
    </Modal>
  );
}
