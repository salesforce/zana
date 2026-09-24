import { installTestPluginRuntime } from "./compat/testing-app";
import { configure } from "@testing-library/react";
import { beforeEach, vi } from "vitest";

// Layout/CSS is covered by built Electron; jsdom's style engine cannot model
// Tailwind container queries and makes role queries prohibitively expensive.
vi.mock('./styles', () => ({}));

if (typeof window !== "undefined") installTestPluginRuntime();

configure({ asyncUtilTimeout: 8_000 });

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
}

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
  if (typeof document !== "undefined") document.getElementById('tasks-styles')?.remove();
});
