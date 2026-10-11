import { z } from "zod";
import {
  OWN_NOTIFICATION_LEVELS,
  PUSH_NOTIFICATION_KINDS,
} from "@zana-ai/zcc-domain";
import type {
  NotificationLevel,
  NotificationSource,
  OwnNotificationLevel,
  ThreadNotificationState,
} from "@zana-ai/zcc-domain";

export const setThreadNotificationLevelRequestSchema = z
  .object({ level: z.enum(OWN_NOTIFICATION_LEVELS) })
  .strict();
export type SetThreadNotificationLevelRequest = z.infer<
  typeof setThreadNotificationLevelRequestSchema
>;

export const threadNotificationVerdictQuerySchema = z.object({
  kind: z.enum(PUSH_NOTIFICATION_KINDS),
});
export type ThreadNotificationVerdictQuery = z.infer<
  typeof threadNotificationVerdictQuerySchema
>;

/** A thread's own level, what it resolves to, and the defaults it falls back to. */
export type ThreadNotificationLevelResponse = ThreadNotificationState;

export interface ThreadNotificationVerdictResponse {
  send: boolean;
  level: NotificationLevel;
  source: NotificationSource;
  reason?: "level" | "archived";
  /** Present only when sending with previews enabled. */
  title?: string;
  body?: string;
}

/** Error body of these routes (the product server's `{ error, message }` shape). */
export interface ThreadNotificationError {
  error:
    | "unknown-thread"
    | "invalid-thread-id"
    | "invalid-notification-level"
    | "invalid-notification-kind"
    | "notification-limit";
  message: string;
}

export type { OwnNotificationLevel };
