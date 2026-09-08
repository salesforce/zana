import { createHash } from "node:crypto";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@zana-ai/zcc-host-daemon-contract";

type StableJsonValue =
  | string
  | number
  | boolean
  | null
  | StableJsonValue[]
  | { [key: string]: StableJsonValue };

function toStableJsonValue(value: unknown): StableJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
    );
  }
  throw new Error(`Cannot fingerprint value of type ${typeof value}.`);
}

function fingerprintStableJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(toStableJsonValue(value)))
    .digest("hex")
    .slice(0, 16);
}

export function fingerprintAcpLaunchSpec(
  spec: HostDaemonAcpLaunchSpec,
): string {
  return fingerprintStableJson(normalizeHostDaemonAcpLaunchSpec(spec));
}

export { bridgeLaunchProcessKey } from "./bridge-launch-process-key.js";
