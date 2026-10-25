import { expect, it } from 'vitest';
import { centerFullFlowLayout } from '../lib/flow-visualizer-bundle.js';
import { createWebVisualizationEngine } from '@salesforce/metadata-visualizer-web';
import { flowSnapshotFileSystem } from '../lib/flow-visualizer-filesystem.js';

it('uses full-layout centering without altering the rest of the official viewer', () => {
  const html = '<script>canvas({contentWidth:E==null?void 0:E.width,contentCenterX:E==null?void 0:E.spineCenterX,resetKey:"flow"})</script>';
  expect(centerFullFlowLayout(html)).toBe('<script>canvas({contentWidth:E==null?void 0:E.width,contentCenterX:void 0,resetKey:"flow"})</script>');
});
it('fails closed when an SDK upgrade changes or duplicates the integration point', () => {
  for (const html of ['', 'contentCenterX:newApi()', 'contentCenterX:E==null?void 0:E.spineCenterX,'.repeat(2)]) expect(() => centerFullFlowLayout(html)).toThrow(/adapter needs review/);
});
it('recognizes both themes from the actual pinned SDK', async () => {
  const engine = await createWebVisualizationEngine({ fileSystem: flowSnapshotFileSystem('') });
  try {
    for (const theme of ['light', 'dark'] as const) {
      const { bundle, error } = await engine.visualizeMetadata('flow', theme === 'light' ? { theme } : undefined);
      expect(error).toBeNull();
      expect(centerFullFlowLayout(bundle!.body)).toContain('contentCenterX:void 0');
    }
  } finally { engine.dispose(); }
});
