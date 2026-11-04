import { z } from 'zod';

export const CLI_CALLBACK_MAX_BODY_BYTES = 1024 * 1024;
export const CLI_CALLBACK_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Owner-wide ceilings on in-flight callbacks; native tool policy calls have their own pool so long /mcp calls cannot starve them. */
export const CLI_CALLBACK_MAX_ACTIVE = 8;
export const CLI_CALLBACK_MAX_ACTIVE_NATIVE_TOOL = 64;
export const CliCallbackGrantSchema = z.object({
  projectId: z.string().regex(/^[\w-]{1,200}$/),
  sessionId: z.string().uuid(),
  credential: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type CliCallbackGrant = z.infer<typeof CliCallbackGrantSchema>;
export const CliCallbackControlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), grant: CliCallbackGrantSchema }).strict(),
  z.object({ action: z.literal('revoke'), sessionId: z.string().uuid() }).strict()
]);
export type CliCallbackControl = z.infer<typeof CliCallbackControlSchema>;
const base64 = (maxBytes: number) => z.string().max(4 * Math.ceil(maxBytes / 3))
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const header = z.string().max(1024).regex(/^[\x20-\x7e]*$/);
export const CliCallbackRequestSchema = z.object({
  sessionId: z.string().uuid(),
  path: z.string().min(1).max(1024),
  headers: z.object({ 'content-type': header.optional(), accept: header.optional(), 'mcp-protocol-version': header.optional() }).strict(),
  bodyBase64: base64(CLI_CALLBACK_MAX_BODY_BYTES)
}).strict();
export type CliCallbackWireRequest = z.infer<typeof CliCallbackRequestSchema>;
export const CliCallbackResponseSchema = z.object({
  status: z.number().int().min(200).max(599),
  contentType: z.string().min(1).max(200).regex(/^[\x20-\x7e]+$/).optional(),
  bodyBase64: base64(CLI_CALLBACK_MAX_RESPONSE_BYTES)
}).strict();
export type CliCallbackWireResponse = z.infer<typeof CliCallbackResponseSchema>;

/** Both the execution machine and the owner compare the exact raw route. */
export function cliCallbackPaths(input: CliCallbackGrant): ReadonlySet<string> {
  const parsed = CliCallbackGrantSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid CLI callback grant');
  const grant = parsed.data, suffix = `${grant.projectId}/${grant.sessionId}`;
  return new Set([
    `/mcp/${suffix}/${grant.credential}`,
    ...['stop', 'firstprompt', 'overseer', 'contentscreen', 'question'].map(kind => `/hook/${kind}/${suffix}`),
    ...['blocked', 'unblocked'].map(action => `/hook/notify/${suffix}/${action}`),
    ...['start', 'stop'].map(action => `/hook/subagent/${suffix}/${action}`),
    ...['start', 'stop', 'clear'].map(action => `/hook/toolactivity/${suffix}/${action}`),
    `/hook/nativetool/${suffix}`
  ]);
}

/** The PreToolUse policy callback fires on every tool call; it gets its own bounded pool. */
export const isCliNativeToolPath = (path: string): boolean => path.startsWith('/hook/nativetool/');
