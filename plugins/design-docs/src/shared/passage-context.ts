import type { ContextReference } from '@zana-ai/zcc-plugin-sdk/app';
import { PLUGIN_ID } from './contract.js';

export function passageContext(docId: string, path: string, text: string): ContextReference {
  return { version: 1, label: `${path.split('/').pop() || path} (selection)`, text,
    source: { kind: 'plugin', pluginId: PLUGIN_ID, resourceId: docId, path } };
}
