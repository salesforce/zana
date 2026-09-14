import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import { DocDirectiveCard } from './src/app/DocDirectiveCard.js';
import { DocumentPanel } from './src/app/DocumentPanel.js';
import { DocsOpener } from './src/app/DocsOpener.js';
import { DOCS_PLUGIN_STYLES } from './src/app/styles.js';

const STYLE_TAG_ID = 'docs-plugin-styles';

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = DOCS_PLUGIN_STYLES;
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = DOCS_PLUGIN_STYLES;
  document.head.appendChild(tag);
}

injectStyles();

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: 'md',
    title: 'Docs',
    extensions: ['md', 'mdx'],
    component: DocsOpener
  });
  app.slots.messageDirective({
    id: 'doc',
    component: DocDirectiveCard
  });
  app.slots.threadPanelAction({
    id: 'document',
    title: 'Document',
    icon: 'Library',
    layout: 'flush',
    scopes: ['thread', 'agent-session'],
    component: DocumentPanel
  });
});
