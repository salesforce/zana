import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import { TasksApp, TasksThreadPanel } from './src/app/TasksApp.js';
import { TaskDirectiveCard } from './src/app/task-directive.js';
import { TasksNavBadge } from './src/app/nav-badge.js';
import styles from './src/app/styles.css';
import kanbanCss from '@zana-ai/zcc-ui/kanban.css';

const STYLE_TAG_ID = 'tsk-plugin-styles';

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  const css = `${kanbanCss}\n${styles}`;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = css;
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}

injectStyles();

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'Tasks',
    icon: 'ListTodo',
    component: TasksApp,
    experimental_sidebarAccessory: TasksNavBadge
  });
  app.slots.threadPanelAction({
    id: 'board',
    title: 'Tasks',
    icon: 'ListTodo',
    layout: 'flush',
    scopes: ['thread', 'agent-session'],
    component: TasksThreadPanel
  });
  app.slots.messageDirective({
    id: 'task',
    component: TaskDirectiveCard
  });
  app.slots.commandPaletteAction({
    id: 'open',
    title: 'Open Tasks',
    run: (ctx) => {
      ctx.toPluginPanel('main');
    }
  });
});
