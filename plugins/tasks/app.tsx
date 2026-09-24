import './styles';
import { definePluginApp } from "./compat/app";
import { TasksAppShell } from "./shell/app-shell.js";
import { TasksSidebarAccessory } from "./shell/sidebar-accessory.js";
import { TasksNavigationPanel } from "./shell/navigation-panel.js";
import { TaskDirectiveCard, TaskEmbedPanel } from "./views/embed/index.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    path: "tasks",
    component: (props) => <div className="bb-tasks" style={{ display: "flex", height: "100%", minWidth: 0, overflow: "hidden" }}><aside style={{ width: 240, flexShrink: 0, overflow: "auto", borderRight: "1px solid var(--border)" }}><TasksNavigationPanel {...props} /></aside><main style={{ flex: 1, minWidth: 0 }}><TasksAppShell {...props} /></main></div>,
    experimental_sidebarAccessory: TasksSidebarAccessory,

  });
  app.slots.threadPanelAction({
    id: "task",
    title: "Task",
    icon: "ListTodo",
    component: (props) => <div className="bb-tasks" style={{ height: "100%" }}><TaskEmbedPanel {...props} /></div>,
  });
  app.slots.messageDirective({ id: "task", component: (props) => <div className="bb-tasks"><TaskDirectiveCard {...props} /></div> });
});
