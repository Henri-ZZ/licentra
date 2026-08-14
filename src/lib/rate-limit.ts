/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Intended for admin-protected migration endpoints (spec §22 requires rate
 * limiting). In-memory means it is per-process only — with multiple server
 * instances each gets its own budget, so prefer a shared store (e.g.
 * Upstash Redis) in production, same as the existing license-API rate
 * limiting note in docs/PROJECT.md.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= opts.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimitByIp(
  ip: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  return rateLimit(`ip:${ip}`, opts);
}

/** Best-effort client IP extraction (proxy-aware, non-authoritative). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
