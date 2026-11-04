/**
 * Identity environment for an interactive session. Both values originate in the
 * main-authorized spawn context (the project was validated against the store,
 * the thread binding is stamped by main), never from renderer input. The env is
 * a fast-path hint: every server operation still authorizes by session token,
 * and `GET /api/v1/sessions/self` is the authority when these are absent.
 */
export interface SessionIdentityEnvInput {
  projectId: string;
  threadId?: string;
}

export function sessionIdentityEnv(input: SessionIdentityEnvInput): Record<string, string> {
  return {
    ZCC_PROJECT_ID: input.projectId,
    ...(input.threadId ? { ZCC_THREAD_ID: input.threadId } : {})
  };
}

/** Inherited ambient identity must not describe a different session. */
export function clearInheritedSessionIdentity(env: Record<string, string>): void {
  delete env.ZCC_PROJECT_ID;
  delete env.ZCC_THREAD_ID;
}
