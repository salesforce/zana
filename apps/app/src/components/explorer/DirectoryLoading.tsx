import { useEffect, useState } from 'react';
import { DelayedStencilList } from '../ui/Skeleton.js';
import { DIRECTORY_SLOW_MS } from './useDirectoryLoader.js';

export function DirectoryLoading({ label = 'Loading files', slow: explicitSlow }: { label?: string; slow?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (explicitSlow !== undefined) return;
    const timer = setTimeout(() => setSlow(true), DIRECTORY_SLOW_MS);
    return () => clearTimeout(timer);
  }, [explicitSlow]);
  const isSlow = explicitSlow ?? slow;
  return isSlow ? (
    <div className="tree-loading">
      <p role="status">Taking longer than expected</p>
    </div>
  ) : <DelayedStencilList label={label} className="tree-loading" />;
}
