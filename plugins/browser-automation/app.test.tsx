/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@zana-ai/zcc-plugin-sdk/testing/app";
import type { PreviewFrame, Session } from "./contracts.js";
import { closeLightbox } from "./lightbox-store.js";

const app = await loadPluginApp(() => import("./app.tsx"), "browser-automation");
const directive = app.messageDirectives[0]!;

afterEach(() => {
  cleanup();
  closeLightbox();
  vi.unstubAllGlobals();
});

const session: Session = {
  id: "1a12a3f1-12de-4fbb-a011-df0905678757",
  threadId: "thr_1",
  hostId: "host",
  backend: "local",
  state: "ready",
  createdAt: 1,
  expiresAt: 4_000_000_000_000,
};
const frame = (
  sequence: number,
  title = "Cart",
  url = "https://shop.test/cart?step=2",
): PreviewFrame => ({
  sequence,
  mimeType: "image/jpeg",
  data: `bytes${sequence}`,
  width: 1280,
  height: 640,
  url,
  title,
});
const hang = () => new Promise<never>(() => {});
const props = (sessionId: string = session.id) => ({
  pluginId: "browser-automation",
  attributes: { session: sessionId },
  source: `::browser-preview{session="${sessionId}"}`,
  message: {
    id: "msg_1",
    threadId: "thr_1",
    turnId: "turn_1",
    projectId: "p",
  },
  openWorkspaceFile: null,
});
const previewInputs = (slot: {
  inspection: { rpcCalls: { method: string; input: unknown }[] };
}) =>
  slot.inspection.rpcCalls
    .filter((call) => call.method === "preview")
    .map((call) => call.input);
const sizes = (slot: {
  inspection: { rpcCalls: { method: string; input: unknown }[] };
}) =>
  previewInputs(slot).map((input) =>
    typeof input === "object" && input !== null && "size" in input
      ? (input as { size: unknown }).size
      : null,
  );

describe("registration", () => {
  it("registers only the inline browser-preview directive", () => {
    expect(app.messageDirectives.map((entry) => entry.id)).toEqual([
      "browser-preview",
    ]);
    expect(app.threadPanelActions).toEqual([]);
  });
});

describe("inline browser preview", () => {
  it("rejects a malformed session attribute without calling the server", async () => {
    const slot = renderSlot(directive, props("not-a-session"), { rpc: {} });
    expect((await slot.findByRole("alert")).textContent).toMatch(
      /valid session attribute/,
    );
    expect(slot.inspection.rpcCalls).toEqual([]);
  });

  it("streams frames by resuming from the last sequence", async () => {
    let polls = 0;
    let deliverFirst!: () => void;
    const firstRequested = new Promise<void>((resolve) => {
      deliverFirst = resolve;
    });
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: async () => {
          polls += 1;
          if (polls === 1) {
            await firstRequested;
            return { session, frame: frame(4) };
          }
          if (polls === 2) return { session, frame: frame(5, "Checkout") };
          return hang();
        },
      },
    });
    expect(await slot.findByRole("status")).toBeTruthy();
    expect(slot.getByText("Connecting")).toBeTruthy();
    deliverFirst();
    const first = await slot.findByAltText("Live view of Cart");
    expect(first.getAttribute("src")).toBe("data:image/jpeg;base64,bytes4");
    expect(slot.getByText("shop.test/cart")).toBeTruthy();
    expect(slot.getByText("Live")).toBeTruthy();
    const second = await slot.findByAltText(
      "Live view of Checkout",
      {},
      { timeout: 3_000 },
    );
    expect(second.getAttribute("src")).toBe("data:image/jpeg;base64,bytes5");
    await waitFor(() =>
      expect(previewInputs(slot)).toEqual(
        [0, 4, 5].map((afterSequence) => ({
          threadId: "thr_1",
          sessionId: session.id,
          afterSequence,
          size: "thumbnail",
        })),
      ),
    );
  });

  it("labels pages that have no web address without dumping their URL", async () => {
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: () => ({
          session,
          frame: frame(1, "", "data:text/html,%3Ch1%3Every-long-inline-page"),
        }),
      },
    });
    await slot.findByAltText("Live view of Headless browser");
    expect(slot.getByText("data:")).toBeTruthy();
    expect(slot.queryByText(/very-long-inline-page/)).toBeNull();
  });

  it("does not repeat the address as the title of a blank page", async () => {
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: () => ({
          session,
          frame: frame(1, "about:blank", "about:blank"),
        }),
      },
    });
    await slot.findByAltText("Live view of Headless browser");
    expect(slot.getAllByText("about:blank")).toHaveLength(1);
  });

  it("stops polling while collapsed", async () => {
    let polls = 0;
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: () => {
          polls += 1;
          return { session, frame: frame(polls) };
        },
      },
    });
    await slot.findByAltText("Live view of Cart");
    fireEvent.click(slot.getByRole("button", { name: /^Browser preview:/ }));
    expect(slot.queryByRole("img")).toBeNull();
    const settled = polls;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(polls).toBe(settled);
    fireEvent.click(slot.getByRole("button", { name: /^Browser preview:/ }));
    await waitFor(() => expect(polls).toBeGreaterThan(settled));
  });

  it("stops polling while scrolled out of view", async () => {
    const observers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    let polls = 0;
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: () => {
          polls += 1;
          return { session, frame: frame(polls) };
        },
      },
    });
    await slot.findByAltText("Live view of Cart");
    expect(observers).toHaveLength(1);
    act(() => observers[0]!([{ isIntersecting: false }]));
    const settled = polls;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(polls).toBe(settled);
    expect(slot.getByRole("img")).toBeTruthy();
    act(() => observers[0]!([{ isIntersecting: true }]));
    await waitFor(() => expect(polls).toBeGreaterThan(settled));
  });

  it("keeps the last view when the session ends and stops asking", async () => {
    let polls = 0;
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: () => {
          polls += 1;
          return polls === 1
            ? { session, frame: frame(1) }
            : { session: { ...session, state: "closed" }, frame: null };
        },
      },
    });
    const last = await slot.findByAltText(
      "Last view of Cart",
      {},
      { timeout: 3_000 },
    );
    expect(last.getAttribute("src")).toBe("data:image/jpeg;base64,bytes1");
    expect(slot.getByText("Ended")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(polls).toBe(2);
    expect(
      slot.getByRole("button", { name: "Expand browser preview" }),
    ).toBeTruthy();
  });

  it("shows only a closed header for a session that ended before it was viewed", async () => {
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: () => ({
          session: { ...session, state: "closed" },
          frame: null,
        }),
      },
    });
    await slot.findByText("Ended");
    expect(slot.queryByRole("img")).toBeNull();
    expect(slot.queryByRole("status")).toBeNull();
    expect(
      slot.queryByRole("button", { name: "Expand browser preview" }),
    ).toBeNull();
  });

  it("never previews the in-app desktop browser", async () => {
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: () => ({
          session: { ...session, backend: "desktop" },
          frame: null,
        }),
      },
    });
    await slot.findByText("Unavailable");
    expect(slot.queryByRole("img")).toBeNull();
    expect(previewInputs(slot)).toHaveLength(1);
  });

  it("gives up on a session it can never read, such as one copied into a fork", async () => {
    vi.useFakeTimers();
    try {
      const slot = renderSlot(directive, props(), {
        rpc: {
          preview: () => {
            throw new Error("Session does not belong to this thread");
          },
        },
      });
      for (let attempt = 0; attempt < 8; attempt++)
        await act(() => vi.advanceTimersByTimeAsync(16_000));
      expect(slot.getByText("Unavailable")).toBeTruthy();
      expect(previewInputs(slot)).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("expanded browser preview", () => {
  it("opens from the card frame, streams full size, and hands back on close", async () => {
    let polls = 0;
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: (input) => {
          polls += 1;
          const full =
            typeof input === "object" &&
            input !== null &&
            (input as { size?: unknown }).size === "full";
          return {
            session,
            frame: frame(polls, full ? "Full size" : "Thumbnail"),
          };
        },
      },
    });
    await slot.findByAltText("Live view of Thumbnail");
    expect(slot.queryByRole("dialog")).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "Expand browser preview" }));
    const dialog = await slot.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.querySelector("img")!.getAttribute("alt")).toBe(
        "Live view of Full size",
      ),
    );
    expect(dialog.textContent).toContain("shop.test/cart");
    expect(dialog.textContent).toContain("Live");
    await waitFor(() => expect(sizes(slot)).toContain("full"));

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    const resumedAt = polls;
    await waitFor(() => expect(polls).toBeGreaterThan(resumedAt));
    await waitFor(() =>
      expect(sizes(slot).at(-1)).toBe("thumbnail"),
    );
  });

  it("keeps the last view when the session ends while expanded", async () => {
    let polls = 0;
    const slot = renderSlot(directive, props(), {
      rpc: {
        preview: (input) => {
          polls += 1;
          const full =
            typeof input === "object" &&
            input !== null &&
            (input as { size?: unknown }).size === "full";
          if (full) return { session: { ...session, state: "closed" }, frame: null };
          return { session, frame: frame(polls) };
        },
      },
    });
    await slot.findByAltText("Live view of Cart");
    fireEvent.click(slot.getByRole("button", { name: "Expand browser preview" }));
    const dialog = await slot.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Ended"));
    expect(dialog.querySelector("img")!.getAttribute("alt")).toBe(
      "Last view of Cart",
    );
  });
});
