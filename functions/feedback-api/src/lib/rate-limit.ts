const DEFAULT_WINDOW_MS = 60 * 60 * 1000
const DEFAULT_MAX = 10

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly max: number = DEFAULT_MAX,
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now()
    const cutoff = t - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff)

    if (recent.length >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: recent[0] + this.windowMs,
      }
    }

    recent.push(t)
    this.hits.set(key, recent)
    return {
      allowed: true,
      remaining: Math.max(0, this.max - recent.length),
      resetAt: t + this.windowMs,
    }
  }
}
