import { afterEach, beforeEach } from "vitest";

const dom = typeof window !== "undefined";

if (dom) {
  const { cleanup, configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 4_000 });
  afterEach(() => cleanup());
  beforeEach(() => window.localStorage.clear());
  if (!Element.prototype.scrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  }
}
