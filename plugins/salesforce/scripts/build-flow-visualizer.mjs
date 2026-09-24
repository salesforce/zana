import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createWebVisualizationEngine } from '@salesforce/metadata-visualizer-web';
import { flowSnapshotFileSystem } from '../lib/flow-visualizer-filesystem.ts';

export async function buildFlowVisualizer(pluginRoot) {
  const engine = await createWebVisualizationEngine({ fileSystem: flowSnapshotFileSystem('') });
  const output = join(pluginRoot, 'flow-visualizer');
  await mkdir(output, { recursive: true });
  try {
    for (const theme of ['light', 'dark']) {
      const { bundle, error } = await engine.visualizeMetadata('flow', theme === 'light' ? { theme } : undefined);
      if (error || !bundle) throw Error(error?.message || 'Flow visualizer bundle is unavailable.');
      // Opaque-origin, read-only frame. All code/styles are bundled locally.
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`;
      // Escape in an iframe does not cancel the host's native dialog.
      const closeRelay = `<script>window.addEventListener('keydown', event => { if (event.key === 'Escape') parent.postMessage({ type: 'FLOW_PREVIEW_CLOSE' }, '*'); });</script>`;
      await writeFile(join(output, `${theme}.html`), bundle.body.replace('<head>', `<head>${csp}`).replace('</body>', `${closeRelay}</body>`));
    }
    const require = createRequire(import.meta.url);
    const packageRoot = dirname(dirname(require.resolve('@salesforce/metadata-visualizer-web')));
    await writeFile(join(output, 'LICENSE.txt'), await readFile(join(packageRoot, 'LICENSE.txt')));
  } finally { engine.dispose(); }
}
