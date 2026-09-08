import { describe, expect, it } from "vitest";
import {
  classifyExecutionMode,
  classifyExecutionModeOption,
  composerModeEntries,
  composerWorkModeFromNativeMode,
  isPlanExecutionMode,
  nativeModeForComposerWorkMode,
  portableWorkIntent,
} from "./execution-mode.js";

describe("classifyExecutionMode", () => {
  it("maps native ids and labels without a provider-id branch", () => {
    expect(classifyExecutionMode("plan")).toBe("plan");
    expect(classifyExecutionMode("Plan", "Plan")).toBe("plan");
    expect(classifyExecutionMode("ask")).toBe("ask");
    expect(classifyExecutionMode("agent")).toBe("execute");
    expect(classifyExecutionMode("build")).toBe("execute");
    expect(classifyExecutionMode("research", "Explore")).toBe("custom");
  });

  it("classifies picker options and plan checks", () => {
    expect(classifyExecutionModeOption({ value: "plan", name: "Plan" })).toEqual({
      id: "plan",
      label: "Plan",
      kind: "plan",
    });
    expect(isPlanExecutionMode("plan")).toBe(true);
    expect(isPlanExecutionMode("agent")).toBe(false);
    expect(isPlanExecutionMode(null)).toBe(false);
  });
});

describe("portableWorkIntent", () => {
  it("projects Cursor build+plan onto Agent | Plan and hides extra native names", () => {
    const intent = portableWorkIntent({
      acpModeOptions: [
        { value: "build", name: "Build" },
        { value: "plan", name: "Plan" },
      ],
    });
    expect(intent).toEqual({
      modes: ["agent", "plan"],
      planNativeValue: "plan",
      executeNativeValue: "build",
      usesSlashPlan: false,
    });
    expect(composerWorkModeFromNativeMode("build")).toBe("agent");
    expect(composerWorkModeFromNativeMode("plan")).toBe("plan");
    expect(nativeModeForComposerWorkMode("agent", intent)).toBe("build");
    expect(nativeModeForComposerWorkMode("plan", intent)).toBe("plan");
  });

  it("keeps native roles available through the unified picker projection", () => {
    const intent = portableWorkIntent({
      acpModeOptions: [
        { value: "plan", name: "Plan" },
        { value: "build", name: "Build" },
        { value: "reviewer", name: "Reviewer" },
        { value: "ask", name: "Ask" },
      ],
    });
    expect(intent.modes).toEqual(["agent", "plan"]);
    expect(intent.planNativeValue).toBe("plan");
    expect(intent.executeNativeValue).toBe("build");
    expect(composerModeEntries({
      acpModeOptions: [
        { value: "plan", name: "Plan" },
        { value: "build", name: "Build" },
        { value: "reviewer", name: "Reviewer" },
        { value: "ask", name: "Ask" },
      ],
    })).toEqual([
      { id: "agent", label: "Agent", kind: "execute", nativeValue: "build", usesSlashPlan: false },
      { id: "plan", label: "Plan", kind: "plan", nativeValue: "plan", usesSlashPlan: false },
      { id: "reviewer", label: "Reviewer", kind: "custom", nativeValue: "reviewer", usesSlashPlan: false },
      { id: "ask", label: "Ask", kind: "ask", nativeValue: "ask", usesSlashPlan: false },
    ]);
  });

  it("uses slash Plan only when no native plan mode exists", () => {
    expect(composerModeEntries({ acpModeOptions: [], composerActions: ["plan"] })).toEqual([
      { id: "agent", label: "Agent", kind: "execute", nativeValue: undefined, usesSlashPlan: false },
      { id: "plan", label: "Plan", kind: "plan", nativeValue: undefined, usesSlashPlan: true },
    ]);
  });

  it("falls back to /plan when the catalog has no plan-kind mode", () => {
    const intent = portableWorkIntent({
      acpModeOptions: [],
      composerActions: ["plan", "goal"],
    });
    expect(intent).toEqual({
      modes: ["agent", "plan"],
      planNativeValue: undefined,
      executeNativeValue: undefined,
      usesSlashPlan: true,
    });
    expect(nativeModeForComposerWorkMode("plan", intent)).toBeUndefined();
  });

  it("offers Agent only when there is no plan surface", () => {
    expect(
      portableWorkIntent({ acpModeOptions: [], composerActions: [] }).modes,
    ).toEqual(["agent"]);
  });
});
