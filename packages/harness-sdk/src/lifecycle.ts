export type HarnessLifecycleEvent =
  | 'turn-complete'
  | 'blocked'
  | 'unblocked'
  | 'first-prompt'
  | 'subagent-start'
  | 'subagent-stop'
  | 'tool-start'
  | 'tool-stop'
  | 'tool-clear';

/** A host-owned disposable resource, such as an SDK event-stream subscription. */
export interface HarnessDisposable {
  dispose(): void | Promise<void>;
}

export interface HarnessLifecycleAdapter<TAttachment = unknown> {
  readonly supportedEvents: readonly HarnessLifecycleEvent[];
  attach?(attachment: TAttachment): Promise<HarnessDisposable | undefined>;
}
