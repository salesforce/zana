'use client';

import Image from 'next/image';
import { BrowserFrame } from './BrowserFrame';
import { productShot, type ProductShotId } from '@/lib/product-shots';

interface ProductShotProps {
  id: ProductShotId;
  priority?: boolean;
  className?: string;
}

/**
 * Renders a reviewed product image when its registry entry has `src`; otherwise
 * it preserves the final layout with an explicit, easy-to-replace placeholder.
 */
export function ProductShot({ id, priority = false, className = '' }: ProductShotProps) {
  const shot = productShot(id);
  return (
    <BrowserFrame
      title={shot.title}
      badge={shot.src ? 'Product screenshot' : 'Screenshot placeholder'}
      className={`product-shot product-shot-${shot.aspectRatio} ${className}`}
      caption={
        <>
          <strong>{shot.caption}</strong>
          {!shot.src && <span className="product-shot-capture">Replace with: {shot.capture}</span>}
        </>
      }
    >
      {shot.src ? (
        <div className="product-shot-image">
          <Image src={shot.src} alt={shot.alt} fill priority={priority} sizes="(max-width: 760px) 100vw, 960px" />
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
      )}
    </BrowserFrame>
  );
}
