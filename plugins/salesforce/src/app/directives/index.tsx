import type { PluginAppBuilder } from '@zana-ai/zcc-plugin-sdk/app';
import { AgentCard } from './AgentCard.js';
import { OperationCard } from './OperationCard.js';
import { PreviewCard } from './PreviewCard.js';

/**
 * Registers the Studio message directives. Slot ids equal the directive names the
 * host matches (`::sf-agent{path line}`, `::sf-preview{runId turn}`, `::sf-operation{id}`).
 */
export function registerStudioDirectives(app: PluginAppBuilder): void {
  app.slots.messageDirective({ id: 'sf-agent', component: AgentCard });
  app.slots.messageDirective({ id: 'sf-preview', component: PreviewCard });
  app.slots.messageDirective({ id: 'sf-operation', component: OperationCard });
}
