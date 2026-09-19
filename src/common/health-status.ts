/**
 * Process-wide dependency liveness, surfaced by GET /health.
 *
 * Deliberately a plain object rather than an injected provider: the health endpoint
 * (and its tests) then need no import of the Redis/ioredis stack — and @nestjs/config
 * ships ESM-only, which Jest cannot parse. Services publish their state here.
 */
export const healthStatus = {
  db: false,
  dbError: null as string | null,
  redis: false,
};
