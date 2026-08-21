/**
 * Main-owned transcript dispatch. Harness-specific discovery and reading live
 * behind the registered session adapter; this seam only selects the registered
 * implementation and writes resolver results through the authoritative PTY path.
 */

import type { SessionStats } from '@zana-ai/zcc-domain/product';
import type { HarnessSessionReference } from '@zcc/harness-sdk';
import { HARNESS_REGISTRATIONS, registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import type { HarnessTranscriptAdapter, NativeSessionPatch, TranscriptSessionRef } from '@zana-ai/zcc-host-daemon/harness/session-adapter';

export type { TranscriptSessionRef } from '@zana-ai/zcc-host-daemon/harness/session-adapter';

export class TranscriptSource {
  private readonly adapters = new Map<string, HarnessTranscriptAdapter>();

  constructor(
    private readonly stampNativeSession: (id: string, patch: NativeSessionPatch) => void = () => {},
    openCodeBinary: () => string = () => 'opencode'
  ) {
    for (const registration of HARNESS_REGISTRATIONS) {
      const adapter = registration.createTranscriptAdapter?.({ openCodeBinary });
      if (adapter) this.adapters.set(registration.id, adapter);
    }
  }

  forget(id: string): void {
    for (const adapter of this.adapters.values()) adapter.forget?.(id);
  }

  /** Resolve and persist a harness-native id without reading transcript data. */
  async observe(ref: TranscriptSessionRef): Promise<void> {
    try {
      await this.resolve(ref);
    } catch {
      // Transcript/session metadata is observational; a harness failure must not
      // reject the status listener that opportunistically discovers native ids.
    }
  }

  async readLastTurn(ref: TranscriptSessionRef): Promise<string> {
    try {
      const { adapter, reference } = await this.resolve(ref);
      return adapter?.readLastTurn ? await adapter.readLastTurn(ref, reference) : '';
    } catch {
      return '';
    }
  }

  async readDigest(ref: TranscriptSessionRef): Promise<string> {
    try {
      const { adapter, reference } = await this.resolve(ref);
      return adapter?.readDigest ? await adapter.readDigest(ref, reference) : '';
    } catch {
      return '';
    }
  }

  async readStats(ref: TranscriptSessionRef): Promise<SessionStats | null> {
    try {
      const { adapter, reference } = await this.resolve(ref);
      return adapter?.readStats ? await adapter.readStats(ref, reference) : null;
    } catch {
      return null;
    }
  }

  private async resolve(ref: TranscriptSessionRef): Promise<{
    adapter?: HarnessTranscriptAdapter;
    reference?: HarnessSessionReference;
  }> {
    const registration = registrationFor(ref.profile as import('@zana-ai/zcc-domain/product').LaunchProfileId);
    const adapter = registration && this.adapters.get(registration.id);
    if (!adapter) return {};
    const reference = await adapter.resolve?.(ref);
    if (reference?.nativeId) {
      const patch = registration?.nativeSessionPatch?.(reference.nativeId);
      if (patch) this.stampNativeSession(ref.id, patch);
    }
    return { adapter, reference };
  }
}
