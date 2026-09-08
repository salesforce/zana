'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ProductMap } from '@/lib/plugin-guide/product-map';
import { slideIdFromHash, writeSlideHash } from './slide-hash';

export function PluginGuideMap(): ReactNode {
  const [initialSlideId, setInitialSlideId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const fromHash = slideIdFromHash(window.location.hash);
    if (fromHash) setInitialSlideId(fromHash);
  }, []);

  const onSlideChange = useCallback((id: string) => {
    writeSlideHash(id);
  }, []);

  return (
    <div className="plugin-guide-scroll" data-guide-stage-viewport>
      <ProductMap
        key={initialSlideId ?? 'default'}
        initialSlideId={initialSlideId}
        onSlideChange={onSlideChange}
      />
    </div>
  );
}
