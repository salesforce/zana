import { AppWindow } from 'lucide-react';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { product } from '../../lib/product-client.js';

export function NewWindowButton({ projectId }: { projectId?: string }) {
  if (!hasDesktopBridge()) return null;
  return (
    <button type="button" className="sidebar-utility-button" title="New Window" aria-label="New Window"
      onClick={() => void product.windows.openNew(projectId)}>
      <AppWindow size={18} aria-hidden="true" />
    </button>
  );
}
