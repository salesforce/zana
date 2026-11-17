import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@zana-ai/zcc-plugin-sdk/app";
import type { UsageReading } from "./server.js";
const card = {
  border: "1px solid var(--border, #393b45)",
  borderRadius: 12,
  padding: 20,
  margin: "18px 0",
  background: "var(--bg-panel, #202229)",
};
export function UsagePanel() {
  const rpc = useRpc();
  const [rows, setRows] = useState<UsageReading[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      setRows((await rpc.call("refresh")) as UsageReading[]);
    } catch {
      setError("Could not refresh usage. Try again.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    void rpc
      .call("snapshot")
      .then((result) => {
        if (active) {
          setRows(result as UsageReading[]);
          void refresh();
        }
      })
      .catch(() => {
        if (active) setError("Could not load usage.");
      });
    return () => {
      active = false;
    };
  }, [rpc]);
  return (
    <section style={{ height: "100%", overflow: "auto", padding: 28 }}>
      <div style={{ maxWidth: 760, margin: "auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1>Provider Usage</h1>
            <p style={{ color: "var(--text-muted)" }}>
              Subscription windows across your machines
            </p>
          </div>
          <button disabled={busy} onClick={() => void refresh()}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {!rows.length && (
          <p role="status">
            {busy
              ? "Loading provider usage…"
              : "No supported provider usage readings yet."}
          </p>
        )}
        {rows.map((row) => (
          <article key={`${row.hostId}:${row.providerId}`} style={card}>
            <h2 style={{ fontSize: 17 }}>
              {row.providerName}{" "}
              <small style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                · {row.hostName}
              </small>
            </h2>
            {row.error && <p role="status">{row.error}</p>}
            {row.result.supported &&
              (row.result.usage.status === "ok" ? (
                <>
                  <p>
                    {row.result.usage.planLabel} {row.result.usage.accountEmail}
                  </p>
                  {row.result.usage.windows.map((window, i) => (
                    <div key={i} style={{ margin: "18px 0" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>{window.label}</span>
                        <b>{Math.round(100 - window.usedPercent)}% remaining</b>
                      </div>
                      <meter
                        min={0}
                        max={100}
                        value={window.usedPercent}
                        aria-label={`${window.label} used`}
                        style={{ width: "100%", height: 14 }}
                      />
                      <small style={{ color: "var(--text-muted)" }}>
                        {window.resetsAt
                          ? `Resets ${new Date(window.resetsAt).toLocaleString()}`
                          : "Reset time unavailable"}
                      </small>
                    </div>
                  ))}
                </>
              ) : (
                <p>
                  {row.result.usage.status === "error"
                    ? row.result.usage.message
                    : row.result.usage.status.replaceAll("_", " ")}
                </p>
              ))}
            <small style={{ color: "var(--text-muted)" }}>
              {row.updatedAt
                ? `Updated ${new Date(row.updatedAt).toLocaleString()}`
                : "No reading available"}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "usage",
    title: "Provider Usage",
    icon: "Gauge",
    placement: "extensions",
    component: UsagePanel,
  });
  app.slots.settingsSection({
    id: "usage",
    title: "Provider Usage",
    component: UsagePanel,
  });
  app.slots.sidebarFooterAction({
    id: "usage",
    title: "Provider Usage",
    icon: "Gauge",
    run: ({ toPluginPanel }) => {
      toPluginPanel("usage");
    },
  });
});
