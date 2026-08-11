export class MemoryRateLimiter {
  constructor(options = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.buckets = new Map();
  }

  allow(key, limit, windowMs) {
    const now = this.clock();
    const bucketKey = String(key);
    const current = this.buckets.get(bucketKey);
    if (!current || now >= current.resetAt) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 };
    }
    if (current.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, current.resetAt - now),
      };
    }
    current.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - current.count),
      retryAfterMs: 0,
    };
  }

  reset() {
    this.buckets.clear();
  }
}
