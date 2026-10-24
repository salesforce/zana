/** An installed plugin "supports peers" when it is enabled and declares `zcc.peers`. */
export function pluginSupportsPeers(plugin: { enabled: boolean; peers?: boolean }): boolean {
  return plugin.enabled === true && plugin.peers === true;
}
