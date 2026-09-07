import { z } from "zod";
import { permissionModeSchema } from "./shared-types.js";

export const hostTypeValues = ["persistent"] as const;
export const hostTypeSchema = z.enum(hostTypeValues);
export type HostType = z.infer<typeof hostTypeSchema>;

export const hostStatusValues = ["connected", "disconnected"] as const;
export const hostStatusSchema = z.enum(hostStatusValues);

export const hostSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: hostTypeSchema,
  status: hostStatusSchema,
  /**
   * Permission ceiling for work that runs on this machine. Threads resolve
   * down to this mode, so a sandbox machine can stay at "full" while a
   * personal laptop refuses to go above "accept-edits". Only an owner session
   * changes it; machine credentials cannot (see the hosts routes).
   */
  maxPermissionMode: permissionModeSchema,
  lastSeenAt: z.number().nullable(),
  lastRejectedProtocolVersion: z.number().int().positive().nullable(),
  /** True for the co-started local daemon. It cannot be removed. */
  isPrimary: z.boolean(),
  /**
   * True when the server stored an SSH alias for this machine so Fix can
   * restart or reinstall the daemon without asking the renderer for a host.
   */
  canRepairViaSsh: z.boolean().default(false),
  /**
   * SSH config alias used to pair this enrolled daemon (`Host.sshHost`).
   * Lookup for workspace defaults uses this, never the display name.
   */
  sshHost: z.string().nullable().optional(),
  /**
   * Optional per-machine start path for SSH remotes that do not set a
   * per-project `remotePath`. Empty/null falls through to Connectivity's
   * global default, then the remote home directory. Primary (this Mac)
   * never stores one.
   */
  defaultWorkspacePath: z.string().nullable().optional(),
  /** Last-seen home directory reported by the daemon, used as the Home fallback. */
  homeDir: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Host = z.infer<typeof hostSchema>;
