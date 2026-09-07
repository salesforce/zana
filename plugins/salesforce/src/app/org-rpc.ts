import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { parseOrgRpc, type OrgRpc } from '../../lib/org-session.js';

export async function fetchConnectedOrg(pluginId: string): Promise<OrgRpc> {
  return parseOrgRpc(await callPluginRpc(pluginId, 'org'));
}
