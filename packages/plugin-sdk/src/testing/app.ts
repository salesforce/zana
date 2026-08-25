import { isPluginAppDefinition } from '../app.js';
import { collectPluginApp, type PluginRegistrationSet } from '../app-contract.js';

/**
 * Collect slots from a `definePluginApp` export without mounting React.
 * Authors TDD panel registration outside the running app.
 */
export function collectTestPluginApp(
  definition: unknown,
  pluginId = 'test',
  generation = 1
): PluginRegistrationSet {
  if (!isPluginAppDefinition(definition)) {
    throw new Error('expected a definePluginApp() export');
  }
  return collectPluginApp(pluginId, generation, definition);
}
