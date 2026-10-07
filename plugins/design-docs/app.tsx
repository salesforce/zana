import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import { DOC_PANEL_ACTION } from './src/app/Agents.js';
import { DirectiveCard, NAV_PATH, NavPanel, ProjectTab, ThreadPanel, saveMessageAsDoc } from './src/app/slots.js';
import { DESIGN_DOCS_STYLES } from './src/app/styles.js';

const STYLE_TAG_ID = 'design-docs-plugin-styles';

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = DESIGN_DOCS_STYLES;
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = DESIGN_DOCS_STYLES;
  document.head.appendChild(tag);
}

injectStyles();

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'design-docs',
    title: 'Design Docs',
    icon: 'DraftingCompass',
    path: NAV_PATH,
    component: NavPanel
  });
  app.slots.projectTab({
    id: 'design',
    label: 'Design',
    icon: 'DraftingCompass',
    header: 'custom',
    component: ProjectTab
  });
  app.slots.messageDirective({
    id: 'design-doc',
    component: DirectiveCard
  });
  app.slots.threadPanelAction({
    id: DOC_PANEL_ACTION,
    title: 'Design doc',
    icon: 'DraftingCompass',
    layout: 'flush',
    scopes: ['thread', 'agent-session'],
    component: ThreadPanel
  });
  app.slots.messageAction({
    id: 'save-design-doc',
    title: 'Save as design doc',
    icon: 'FilePlus',
    run: saveMessageAsDoc
  });
});
