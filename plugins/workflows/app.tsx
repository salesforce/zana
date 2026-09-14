import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import {
  WorkflowPreviewDirective,
  WorkflowRunPanel,
  WorkflowStatusBanner,
  WORKFLOW_PANEL_ACTION_ID
} from './src/app/workflow-ui.js';
import styles from './src/app/styles.css';

const STYLE_TAG_ID = 'wf-plugin-styles';

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = styles;
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = styles;
  document.head.appendChild(tag);
}

injectStyles();

export default definePluginApp((app) => {
  app.composer.customize({
    id: 'workflow-status',
    scopes: ['thread'],
    banners: [{ id: 'active-runs', chrome: 'bare', component: WorkflowStatusBanner }]
  });
  app.slots.messageDirective({
    id: 'workflow-preview',
    component: WorkflowPreviewDirective
  });
  app.slots.threadPanelAction({
    id: WORKFLOW_PANEL_ACTION_ID,
    title: 'Workflow run',
    icon: 'GitBranch',
    component: WorkflowRunPanel,
    layout: 'flush'
  });
});
