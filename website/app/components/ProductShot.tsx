'use client';

import Image from 'next/image';
import { BrowserFrame } from './BrowserFrame';
import { productShot, productShotShowsMedia, type ProductShotId } from '@/lib/product-shots';

interface ProductShotProps {
  id: ProductShotId;
  priority?: boolean;
  className?: string;
  frame?: boolean;
  /** Caption and screenshot badge under the window chrome. Default true when framed. */
  caption?: boolean;
  /** Ignore `src` and keep the capture-target placeholder. */
  placeholder?: boolean;
}

/**
 * Renders a reviewed product image when its registry entry has `src`; otherwise
 * it preserves the final layout with an explicit, easy-to-replace placeholder.
 */
export function ProductShot({
  id,
  priority = false,
  className = '',
  frame = true,
  caption = true,
  placeholder = false
}: ProductShotProps) {
  const shot = productShot(id);
  const showMedia = productShotShowsMedia(shot.src, placeholder);
  const gif = Boolean(shot.src?.toLowerCase().endsWith('.gif'));
  const media = showMedia && shot.src ? (
    <div className="product-shot-image">
      {gif ? (
        // next/image can freeze animated GIFs to the first frame.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.src} alt={shot.alt} />
      ) : (
        <Image src={shot.src} alt={shot.alt} fill priority={priority} sizes="(max-width: 760px) 100vw, 960px" />
      )}
    </div>
  ) : (
    <div className="product-shot-placeholder" aria-hidden="true">
      <div className="product-shot-placeholder-grid" />
      <div className="product-shot-placeholder-panel product-shot-placeholder-panel-main">
        <span className="product-shot-placeholder-kicker">ZANA PRODUCT SHOT</span>
        <strong>{shot.title}</strong>
        <span>Real application screenshot goes here</span>
      </div>
      <div className="product-shot-placeholder-panel product-shot-placeholder-panel-meta">
        <span>Capture target</span>
        <p>{shot.capture}</p>
      </div>
    </div>
  );

  if (!frame) {
    return <figure className={`product-shot product-shot-${shot.aspectRatio} ${className}`}>{media}</figure>;
  }

  return (
    <BrowserFrame
      title={shot.title}
      badge={caption ? (showMedia ? 'Product screenshot' : 'Screenshot placeholder') : undefined}
      className={`product-shot product-shot-${shot.aspectRatio} ${className}`}
      caption={
        caption ? (
          <>
            <strong>{shot.caption}</strong>
            {!showMedia && <span className="product-shot-capture">Replace with: {shot.capture}</span>}
          </>
        ) : undefined
      }
    >
      {media}
    </BrowserFrame>
  );
}
