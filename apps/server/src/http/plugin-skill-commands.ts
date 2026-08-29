export interface PluginSkillSnapshotRow {
  id: string;
  name: string;
  enabled: boolean;
  skillNames?: readonly string[];
}

export function enabledPluginSkillCatalog(
  snapshot: readonly PluginSkillSnapshotRow[]
): Array<{ pluginId: string; name: string; skillNames: string[] }> {
  return snapshot
    .filter((row) => row.enabled && (row.skillNames?.length ?? 0) > 0)
    .map((row) => ({
      pluginId: row.id,
      name: row.name,
      skillNames: [...(row.skillNames ?? [])]
    }));
}

export function pluginSkillCommandRows(snapshot: readonly PluginSkillSnapshotRow[]) {
  return enabledPluginSkillCatalog(snapshot).flatMap((row) =>
    row.skillNames.map((name) => ({
      id: `plugin:${row.pluginId}:${name}`,
      name: name.startsWith('/') ? name : `/${name}`,
      description: row.name,
      pluginId: row.pluginId
    }))
  );
}
