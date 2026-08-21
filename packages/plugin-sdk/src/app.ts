import type { PluginAppDefinition, PluginAppSetup } from './app-contract.js';

export function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  return { __zccPluginApp: true, setup };
}

export function isPluginAppDefinition(value: unknown): value is PluginAppDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PluginAppDefinition).__zccPluginApp === true &&
    typeof (value as PluginAppDefinition).setup === 'function'
  );
}
