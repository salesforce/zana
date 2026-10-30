/**
 * Bounded process-local storage for workload-owned, already-validated results.
 * Callers own semantic equivalence: this class only coalesces identical keys and
 * retains values explicitly returned as cacheable.
 */
export interface WorkloadMemoCounters {
  requests: number;
  hits: number;
  misses: number;
  inFlightJoins: number;
  activeLimitSkips: number;
  evictions: number;
  providerCalls: number;
  failures: number;
}

const EMPTY_COUNTERS: WorkloadMemoCounters = {
  requests: 0,
  hits: 0,
  misses: 0,
  inFlightJoins: 0,
  activeLimitSkips: 0,
  evictions: 0,
  providerCalls: 0,
  failures: 0
};

export const WORKLOAD_MEMO_SKIPPED = Symbol('workload-memo-skipped');
const MAX_COUNTER_WORKLOADS = 8;
const OTHER_WORKLOAD = 'other';

export class WorkloadMemo {
  private readonly values = new Map<string, { value: unknown; expiresAt: number; bytes: number }>();
  private readonly inFlight = new Map<string, Promise<unknown | undefined>>();
  private readonly counters = new Map<string, WorkloadMemoCounters>();
  private totalBytes = 0;
  private generation = 0;
  private activeCalls = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries = 128,
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly maxInFlight = 16
  ) {}

  async getOrCompute<T>(
    workload: string,
    key: string,
    ttlMs: number,
    compute: () => Promise<T | undefined>
  ): Promise<T | undefined | typeof WORKLOAD_MEMO_SKIPPED> {
    const counters = this.counterFor(workload);
    counters.requests++;
    const hit = this.values.get(key);
    if (hit && hit.expiresAt > this.now()) {
      this.values.delete(key);
      this.values.set(key, hit);
      counters.hits++;
      return hit.value as T;
    }
    if (hit) this.delete(key, hit);

    const existing = this.inFlight.get(key);
    if (existing) {
      counters.inFlightJoins++;
      return existing as Promise<T | undefined>;
    }
    if (this.activeCalls >= this.maxInFlight) {
      counters.activeLimitSkips++;
      return WORKLOAD_MEMO_SKIPPED;
    }

    counters.misses++;
    counters.providerCalls++;
    const generation = this.generation;
    this.activeCalls++;
    const call = compute().then((value) => {
      // A configuration invalidation can happen while work is in flight. Its
      // result may satisfy its original caller, but never repopulates reuse.
      if (value !== undefined && generation === this.generation) this.set(key, value, ttlMs, counters);
      if (value === undefined) counters.failures++;
      return value;
    }, (error) => {
      counters.failures++;
      throw error;
    });
    this.inFlight.set(key, call);
    void call.then(() => {
      if (this.inFlight.get(key) === call) this.inFlight.delete(key);
      this.activeCalls--;
    }, () => {
      if (this.inFlight.get(key) === call) this.inFlight.delete(key);
      this.activeCalls--;
    });
    return call;
  }

  clear(): void {
    this.generation++;
    this.values.clear();
    this.inFlight.clear();
    this.totalBytes = 0;
  }

  snapshot(): Readonly<Record<string, WorkloadMemoCounters>> {
    return Object.fromEntries(
      [...this.counters].map(([workload, counters]) => [workload, { ...counters }])
    );
  }

  private counterFor(workload: string): WorkloadMemoCounters {
    const counterWorkload = this.counters.has(workload) || this.counters.size < MAX_COUNTER_WORKLOADS
      ? workload
      : OTHER_WORKLOAD;
    let counters = this.counters.get(counterWorkload);
    if (!counters) {
      counters = { ...EMPTY_COUNTERS };
      this.counters.set(counterWorkload, counters);
    }
    return counters;
  }

  private set(key: string, value: unknown, ttlMs: number, counters: WorkloadMemoCounters): void {
    const serialized = JSON.stringify(value);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > this.maxBytes) return;
    const previous = this.values.get(key);
    if (previous) this.delete(key, previous);
    while (this.values.size >= this.maxEntries || this.totalBytes + bytes > this.maxBytes) {
      const oldest = this.values.entries().next().value as [string, { value: unknown; expiresAt: number; bytes: number }] | undefined;
      if (!oldest) break;
      this.delete(oldest[0], oldest[1]);
      counters.evictions++;
    }
    this.values.set(key, { value, expiresAt: this.now() + ttlMs, bytes });
    this.totalBytes += bytes;
  }

  private delete(key: string, value: { bytes: number }): void {
    this.values.delete(key);
    this.totalBytes -= value.bytes;
  }
}
