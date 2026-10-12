import { describe, expect, it } from "vitest";
import {
  matchesAppShortcut,
  normalizeAppShortcutInputKey,
  type AppShortcutInput,
} from "./app-keybindings.js";

function input(over: Partial<AppShortcutInput>): AppShortcutInput {
  return {
    key: "",
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...over,
  };
}

describe("normalizeAppShortcutInputKey", () => {
  it("maps Option-composed bracket characters back to the physical bracket", () => {
    expect(
      normalizeAppShortcutInputKey(input({ key: "“", code: "BracketLeft", altKey: true })),
    ).toBe("[");
    expect(
      normalizeAppShortcutInputKey(input({ key: "‘", code: "BracketRight", altKey: true })),
    ).toBe("]");
  });

  it("keeps the typed key when Alt is not held", () => {
    expect(normalizeAppShortcutInputKey(input({ key: "[", code: "BracketLeft" }))).toBe("[");
  });

  it("keeps the composed key for codes it does not map", () => {
    expect(
      normalizeAppShortcutInputKey(input({ key: "≤", code: "Comma", altKey: true })),
    ).toBe("≤");
  });

  it("matches a mod+alt+[ chord typed with Option on macOS", () => {
    const shortcut = {
      key: "[",
      mod: true,
      meta: false,
      control: false,
      alt: true,
      shift: false,
    };
    expect(
      matchesAppShortcut(
        input({ key: "“", code: "BracketLeft", altKey: true, metaKey: true }),
        shortcut,
        true,
      ),
    ).toBe(true);
    expect(
      matchesAppShortcut(
        input({ key: "“", code: "BracketLeft", altKey: true, ctrlKey: true }),
        shortcut,
        true,
      ),
    ).toBe(false);
  });
});
