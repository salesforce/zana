/**
 * Renderer-facing cookie-import shapes. Cookie values never appear here —
 * Settings only sends a source id + profile directory over IPC.
 */

export const DESKTOP_BROWSER_IMPORT_SOURCE_IDS = [
  "chrome",
  "chromium",
  "edge",
  "brave",
  "vivaldi",
  "opera",
  "arc",
  "firefox",
  "safari",
] as const;

export type DesktopBrowserImportSourceId =
  (typeof DESKTOP_BROWSER_IMPORT_SOURCE_IDS)[number];

export type DesktopBrowserImportUnavailableReason =
  | "notInstalled"
  | "needsKeychainApproval"
  | "keychainItemMissing"
  | "needsFullDiskAccess"
  | "browserRunning"
  | "unsupportedPlatform";

export type DesktopBrowserImportFailureReason =
  | DesktopBrowserImportUnavailableReason
  | "keychainUnavailable"
  | "unknownSource"
  | "unknownSourceProfile"
  | "readFailed";

export interface DesktopBrowserImportSourceProfile {
  directory: string;
  name: string;
  cookieCount?: number;
}

export interface DesktopBrowserImportSource {
  id: DesktopBrowserImportSourceId;
  name: string;
  profiles: DesktopBrowserImportSourceProfile[];
  unavailable?: DesktopBrowserImportUnavailableReason;
  icon?: string;
}

export type DesktopBrowserImportOutcome =
  | {
      ok: true;
      imported: number;
      skipped: number;
      skippedDomains: string[];
    }
  | {
      ok: false;
      reason: DesktopBrowserImportFailureReason;
    };

const UNAVAILABLE_COPY: Readonly<
  Record<DesktopBrowserImportUnavailableReason, string>
> = {
  notInstalled: "Not installed on this machine.",
  needsKeychainApproval:
    "Needs Keychain access to read its cookie encryption key. Approve the prompt and try again.",
  keychainItemMissing:
    "No encryption key found in your Keychain. Sign in to that browser once, then try again.",
  needsFullDiskAccess:
    "Give Zana Full Disk Access in System Settings → Privacy & Security, then try again.",
  browserRunning: "Quit the browser first so its cookie database can be read.",
  unsupportedPlatform:
    "Importing from this browser isn't possible on this platform.",
};

export const DESKTOP_BROWSER_IMPORT_FAILURE_COPY: Readonly<
  Record<DesktopBrowserImportFailureReason, string>
> = {
  ...UNAVAILABLE_COPY,
  keychainUnavailable:
    "The system keyring could not be reached. Make sure it is running and unlocked, then try again.",
  unknownSource: "That browser is no longer available to import from.",
  unknownSourceProfile: "That browser profile no longer exists.",
  readFailed: "The browser's cookie database could not be read.",
};

export function isRetryableDesktopBrowserImportReason(
  reason: DesktopBrowserImportFailureReason,
): boolean {
  switch (reason) {
    case "needsKeychainApproval":
    case "keychainItemMissing":
    case "keychainUnavailable":
    case "readFailed":
    case "browserRunning":
    case "needsFullDiskAccess":
      return true;
    default:
      return false;
  }
}
