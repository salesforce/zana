import type {
  ZccPluginApi,
  PluginProviderUsageResult,
} from "@zana-ai/zcc-plugin-sdk/server";
export interface UsageReading {
  hostId: string;
  hostName: string;
  providerId: string;
  providerName: string;
  updatedAt: number;
  result: PluginProviderUsageResult;
  error?: string;
}
export default async function plugin(zcc: ZccPluginApi) {
  let readings = (await zcc.storage.kv.get<UsageReading[]>("readings")) ?? [];
  let pending: Promise<UsageReading[]> | null = null;
  async function refresh() {
    const [hosts, providers] = await Promise.all([
      zcc.sdk.hosts.list(),
      zcc.sdk.providers.list(),
    ]);
    const tasks = hosts.slice(0, 100).flatMap((host) =>
      providers
        .slice(0, 30)
        .map((provider) => ({ host, provider })),
    );
    const next: UsageReading[] = [];
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, tasks.length) }, async () => {
        for (;;) {
          const task = tasks[index++];
          if (!task) return;
          const { host, provider } = task;
          const old = readings.find(
            (row) => row.hostId === host.id && row.providerId === provider.id,
          );
          try {
            const result = await zcc.sdk.providers.usage({
              hostId: host.id,
              providerId: provider.id,
            });
            if (result.supported)
              next.push({
                hostId: host.id,
                hostName: host.name,
                providerId: provider.id,
                providerName: provider.displayName ?? provider.id,
                updatedAt: Date.now(),
                result,
              });
          } catch {
            if (old)
              next.push({
                ...old,
                error: "Could not refresh. Showing the last reading.",
              });
            else
              next.push({
                hostId: host.id,
                hostName: host.name,
                providerId: provider.id,
                providerName: provider.displayName ?? provider.id,
                updatedAt: 0,
                result: { supported: false },
                error: "Machine or provider unavailable",
              });
          }
        }
      }),
    );
    readings = next.sort(
      (a, b) =>
        a.hostName.localeCompare(b.hostName) ||
        a.providerName.localeCompare(b.providerName),
    );
    await zcc.storage.kv.set("readings", readings);
    return readings;
  }
  zcc.rpc.method("snapshot", () => readings);
  zcc.rpc.method("refresh", () => {
    if (!pending)
      pending = refresh().finally(() => {
        pending = null;
      });
    return pending;
  });
}
