import { useEffect, useState } from 'react';
import { product } from '../lib/product-client.js';

export function usePublicAppUrl(): string | undefined {
  const [url, setUrl] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    product.config.get().then((config) => {
      if (!cancelled) setUrl(config.publicAppUrl);
    }).catch(() => undefined);
    const unsub = product.config.onChanged((config) => {
      if (!cancelled) setUrl(config.publicAppUrl);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return url;
}
