import { AppSettingsSchema, type AppSettings } from "../shared/contracts";

// Docker container ids/names are restricted to this character set. Container
// ids passed from the renderer are forwarded straight into `docker` CLI args
// (execFile, so no shell injection risk), but an unvalidated value could still
// be interpreted as a CLI flag (e.g. a value starting with "-") or otherwise
// make docker behave unexpectedly. Reject anything that doesn't look like a
// real id/name up front.
const CONTAINER_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function isValidContainerRef(value: unknown): value is string {
  return typeof value === "string" && CONTAINER_REF_PATTERN.test(value);
}

const MIN_LOG_TAIL = 1;
const MAX_LOG_TAIL = 10_000;
const DEFAULT_LOG_TAIL = 200;

/** Coerces an untrusted `tail` argument into a safe, bounded positive integer. */
export function normalizeLogTail(tail: unknown): number {
  const numeric = typeof tail === "number" ? tail : Number(tail);
  if (!Number.isFinite(numeric) || numeric < MIN_LOG_TAIL) {
    return DEFAULT_LOG_TAIL;
  }

  return Math.min(Math.floor(numeric), MAX_LOG_TAIL);
}

/**
 * Validates an untrusted settings patch against the AppSettings shape,
 * dropping the whole patch if it doesn't conform. Without this, a bad value
 * (e.g. a non-numeric statsPollSeconds) would be merged straight into stored
 * settings and silently break renderer polling (NaN/negative setInterval).
 */
export function sanitizeSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (typeof patch !== "object" || patch === null) {
    return {};
  }

  const result = AppSettingsSchema.partial().safeParse(patch);
  if (!result.success) {
    return {};
  }

  // Build the output manually (rather than returning result.data directly):
  // zod's `.partial()` output type allows explicit `undefined` values, which
  // `exactOptionalPropertyTypes` doesn't allow assigning into Partial<AppSettings>.
  const sanitized: Partial<AppSettings> = {};
  for (const [key, value] of Object.entries(result.data)) {
    if (value !== undefined) {
      (sanitized as Record<string, unknown>)[key] = value;
    }
  }

  return sanitized;
}
