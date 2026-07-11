/**
 * Sliding-window rate limiter (in-process).
 * Used for OpenRouter free-model quotas (20 RPM / 50–1000 RPD).
 */

export type AcquireResult = "ok" | "daily_exhausted" | "timeout";

export interface RateLimiterOptions {
  /** Max requests inside windowMs (e.g. 20 for OpenRouter free RPM). */
  maxPerWindow: number;
  /** Window length in ms (e.g. 60_000 for per-minute). */
  windowMs: number;
  /** Optional hard daily cap (UTC day). Null = unlimited. */
  maxPerDay: number | null;
  /** Optional logger for wait / day-cap messages. */
  log?: (message: string) => void;
  /** Clock override for tests. */
  now?: () => number;
  /** Sleep override for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SlidingWindowRateLimiter {
  private readonly timestamps: number[] = [];
  private dayKey = "";
  private dayCount = 0;
  private chain: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: RateLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.sleep = options.sleep ?? sleep;
  }

  /** How many requests remain in the current minute window (best-effort). */
  remainingInWindow(): number {
    this.prune(this.now());
    return Math.max(0, this.options.maxPerWindow - this.timestamps.length);
  }

  /** How many requests remain today (UTC), or null if unlimited. */
  remainingToday(): number | null {
    if (optionsMaxPerDay(this.options) === null) {
      return null;
    }
    this.rollDay(this.now());
    return Math.max(0, (this.options.maxPerDay as number) - this.dayCount);
  }

  /**
   * Block until a request slot is available under RPM/RPD.
   * Serialized so concurrent workers share one budget.
   */
  async acquire(maxWaitMs?: number): Promise<AcquireResult> {
    const deadline =
      maxWaitMs === undefined ? null : this.now() + Math.max(0, maxWaitMs);
    const run = this.chain.then(() => this.acquireLocked(deadline));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Record an external wait (e.g. after 429) without consuming a slot. */
  async pause(
    ms: number,
    reason: string,
    maxWaitMs?: number,
  ): Promise<boolean> {
    const deadline =
      maxWaitMs === undefined ? null : this.now() + Math.max(0, maxWaitMs);
    const run = this.chain.then(async () => {
      const availableMs =
        deadline === null ? ms : Math.max(0, deadline - this.now());
      const waitMs = Math.min(ms, availableMs);
      if (waitMs <= 0) return ms <= 0;
      this.log(`[rate-limit] pause ${waitMs}ms (${reason})`);
      await this.sleep(waitMs);
      return waitMs >= ms;
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async acquireLocked(deadline: number | null): Promise<AcquireResult> {
    const maxDay = optionsMaxPerDay(this.options);
    for (;;) {
      const now = this.now();
      if (deadline !== null && now >= deadline) {
        return "timeout";
      }
      this.rollDay(now);
      if (maxDay !== null && this.dayCount >= maxDay) {
        this.log(
          `[rate-limit] daily cap reached (${maxDay} requests / UTC day)`,
        );
        return "daily_exhausted";
      }

      this.prune(now);
      if (this.timestamps.length < this.options.maxPerWindow) {
        this.timestamps.push(now);
        this.dayCount += 1;
        return "ok";
      }

      const oldest = this.timestamps[0] ?? now;
      const waitMs = Math.max(50, oldest + this.options.windowMs - now + 25);
      const boundedWaitMs =
        deadline === null
          ? waitMs
          : Math.min(waitMs, Math.max(0, deadline - now));
      this.log(
        `[rate-limit] RPM window full (${this.options.maxPerWindow}/${this.options.windowMs}ms) — waiting ${boundedWaitMs}ms`,
      );
      await this.sleep(boundedWaitMs);
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.options.windowMs;
    while (
      this.timestamps.length > 0 &&
      (this.timestamps[0] as number) <= cutoff
    ) {
      this.timestamps.shift();
    }
  }

  private rollDay(now: number): void {
    const key = utcDayKey(now);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayCount = 0;
    }
  }
}

function optionsMaxPerDay(options: RateLimiterOptions): number | null {
  return options.maxPerDay === null || options.maxPerDay === undefined
    ? null
    : options.maxPerDay;
}
