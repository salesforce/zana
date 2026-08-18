export interface HarnessSessionReference {
  readonly id: string;
  readonly nativeId?: string;
}

export interface HarnessResumeTarget {
  readonly profileId: string;
  readonly args: readonly string[];
}

export interface HarnessSessionAdapter<TSession = unknown, TStats = unknown> {
  readonly supportsExactResume: boolean;
  readonly supportsTranscript: boolean;
  resolve?(session: TSession): Promise<HarnessSessionReference | undefined>;
  resumeTarget?(reference: HarnessSessionReference): HarnessResumeTarget | undefined;
  /**
   * Reads retain the original host session because transcript stores commonly
   * need launch metadata such as cwd as well as the resolved native id.
   */
  readLastTurn?(session: TSession, reference?: HarnessSessionReference): Promise<string>;
  readDigest?(session: TSession, reference?: HarnessSessionReference): Promise<string>;
  readStats?(session: TSession, reference?: HarnessSessionReference): Promise<TStats | null>;
  forget?(sessionId: string): void;
}
