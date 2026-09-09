import { useMemo, useState, type FormEvent } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@zana-ai/zcc-plugin-sdk/app";
import {
  PI_EXTENSION_UI_RENDERER_ID,
  piExtensionUiPayloadDataSchema,
  type PiExtensionUiMethod,
} from "./src/extension-ui-contract.js";

/**
 * The Pi mark, drawn inline so `currentColor` resolves against the app theme.
 * The manifest's `branding.icon` SVG is fetched through `<img>`, a separate
 * document where `currentColor` is black — invisible on dark themes.
 */
function PiIcon({ className }: { className?: string }) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      viewBox="100 100 600 600"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <title>Pi</title>
      <path
        d="
        M165.29 165.29
        H517.36
        V400
        H400
        V517.36
        H282.65
        V634.72
        H165.29
        Z
        M282.65 282.65
        V400
        H400
        V282.65
        Z
      "
      />
      <path d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </svg>
  );
}

interface ParsedRequest {
  requestId: string;
  method: PiExtensionUiMethod;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
}

function parseRequest(payload: unknown): ParsedRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const direct = piExtensionUiPayloadDataSchema.safeParse(payload);
  if (direct.success) return direct.data;
  const data = (payload as { data?: unknown }).data;
  const wrapped = piExtensionUiPayloadDataSchema.safeParse(data);
  return wrapped.success ? wrapped.data : null;
}

function ExtensionUiInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const request = useMemo(
    () => parseRequest(interaction.payload),
    [interaction.payload],
  );
  const [text, setText] = useState(request?.prefill ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!request) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0 }}>This request could not be displayed.</p>
        <button type="button" onClick={() => void cancel()}>
          Cancel
        </button>
      </div>
    );
  }

  const finish = (value: unknown) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await submit(value as never);
      } catch {
      } finally {
        setBusy(false);
      }
    })();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (request.method === "confirm") return;
    if (request.method === "select") {
      if (selected !== null) finish(selected);
      return;
    }
    finish(text);
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 8 }}>
      {request.message ? <p style={{ margin: 0 }}>{request.message}</p> : null}
      {request.method === "select" ? (
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          {(request.options ?? []).map((option) => (
            <label
              key={option}
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}
            >
              <input
                type="radio"
                name={request.requestId}
                checked={selected === option}
                onChange={() => setSelected(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {request.method === "input" ? (
        <input
          type="text"
          value={text}
          placeholder={request.placeholder}
          autoFocus
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      ) : null}
      {request.method === "editor" ? (
        <textarea
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          style={{ minHeight: 128, fontFamily: "monospace" }}
        />
      ) : null}
      {request.method === "confirm" ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" disabled={busy} onClick={() => finish(false)}>
            No
          </button>
          <button type="button" disabled={busy} onClick={() => finish(true)}>
            Yes
          </button>
        </div>
      ) : null}
      {request.method !== "confirm" ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button type="button" disabled={busy} onClick={() => void cancel()}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || (request.method === "select" && selected === null)}
          >
            Submit
          </button>
        </div>
      ) : null}
    </form>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_providerIcon({
    providerId: "pi",
    icon: PiIcon,
  });
  app.slots.pendingInteraction({
    id: PI_EXTENSION_UI_RENDERER_ID,
    component: ExtensionUiInteraction,
  });
});
