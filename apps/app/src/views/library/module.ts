/**
 * Docs app-module (renderer). Lives under `apps/app/src` so Vite's renderer
 * root owns the Monaco graph (workers imported from `plugins/` are served as
 * `/@fs/` and get mis-optimized). The disk package `plugins/docs` still owns
 * skills + auto-install.
 */

import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import { DocsPanel } from './DocsPanel.js';

export const docsModule: AppModule = {
  id: 'docs',
  title: 'Docs',
  icon: 'Library',
  titleLabel: 'Library',
  panel: DocsPanel,
  projectTab: {
    label: 'Library',
    icon: 'Library',
    global: true
  }
};
