import { createWebVisualizationEngine } from '@salesforce/metadata-visualizer-web';
import { XMLBuilder, XMLValidator } from 'fast-xml-parser';
import { ACTION_SOURCE_CAP, type ActionSource } from './action-source.js';
import { parseActionTarget } from './agent-action-model.js';
import { flowSnapshotFileSystem } from './flow-visualizer-filesystem.js';

export interface FlowVisualization { data: unknown; fileName: string }

/** Tooling API objects and local XML enter the same official parser. */
export function flowSnapshotXml(source: ActionSource): string {
  const clean = (value: unknown, depth = 0): unknown => {
    if (depth > 40) throw Error('This Flow is nested too deeply to preview.');
    if (value == null) return undefined;
    if (Array.isArray(value)) return value.map(item => clean(item, depth + 1)).filter(item => item !== undefined);
    if (typeof value !== 'object') return value;
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor', 'prototype'].includes(key)) throw Error('This Flow contains an unsupported metadata key.');
      result[key] = clean(child, depth + 1);
    }
    return result;
  };
  const xml = source.flow
    ? new XMLBuilder({ ignoreAttributes: true }).build({ Flow: clean(source.flow) })
    : source.content ?? '';
  if (Buffer.byteLength(xml, 'utf8') > ACTION_SOURCE_CAP) throw Error('This Flow exceeds the 750 KB preview limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw Error('This Flow XML cannot be previewed safely.');
  // Bound parser work before handing the snapshot to the SDK.
  let depth = 0, count = 0;
  for (const match of xml.matchAll(/<\/?[A-Za-z][^>]*>/g)) {
    const tag = match[0];
    if (++count > 25_000) throw Error('This Flow has too many metadata elements to preview.');
    if (tag.startsWith('</')) depth--;
    else if (!tag.endsWith('/>') && ++depth > 40) throw Error('This Flow is nested too deeply to preview.');
  }
  return xml;
}

export async function visualizeFlowSnapshot(source: ActionSource): Promise<FlowVisualization> {
  const target = parseActionTarget(source.target);
  if (target?.kind !== 'flow' || source.status !== 'ready') throw Error('Choose an available Flow implementation.');
  const fileName = `${target.name}.flow-meta.xml`;
  const xml = flowSnapshotXml(source);
  const engine = await createWebVisualizationEngine({ fileSystem: flowSnapshotFileSystem(xml, fileName) });
  try {
    const outcome = await engine.getParsedMetadata(`/flow-preview/${fileName}`);
    if (!outcome.result || outcome.error) throw Error('The Salesforce visualizer could not parse this Flow. Open Source to inspect its metadata.');
    // Never serialize the SDK result itself: it also holds plugin instances and services.
    const data = outcome.result.data as { nodes?: unknown[]; edges?: unknown[] };
    if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) throw Error('The Salesforce visualizer returned an unsupported Flow model.');
    if (data.nodes.length > 500 || data.edges.length > 1_000 || Buffer.byteLength(JSON.stringify(data)) > 2_000_000) {
      throw Error('This Flow is too large for the interactive viewer. Use the basic map or Source.');
    }
    return { data, fileName };
  } finally { engine.dispose(); }
}
