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

// A process pid is always a positive integer - reject anything else before
// it reaches nsenter/kill-adjacent tooling.
const PID_PATTERN = /^[1-9][0-9]*$/;

export function isValidPid(value: unknown): value is string {
  return typeof value === "string" && PID_PATTERN.test(value);
}

// Linux interface names (bridges, veths) are capped at IFNAMSIZ-1 = 15 chars
// and can't contain shell/nft-meaningful characters.
const INTERFACE_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,15}$/;

export function isValidInterfaceName(value: unknown): value is string {
  return typeof value === "string" && INTERFACE_NAME_PATTERN.test(value);
}

// libvirt domain names are user-chosen but virsh itself restricts them to a
// conservative, shell-safe character set (no whitespace/slashes/quotes).
const LIBVIRT_DOMAIN_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

export function isValidLibvirtDomainName(value: unknown): value is string {
  return typeof value === "string" && LIBVIRT_DOMAIN_NAME_PATTERN.test(value);
}

const MAC_ADDRESS_PATTERN = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/;

export function isValidMacAddress(value: unknown): value is string {
  return typeof value === "string" && MAC_ADDRESS_PATTERN.test(value);
}

// Compose service names are restricted (by the Compose spec itself) to
// lowercase alphanumerics plus `._-`, and this name ends up both as a YAML
// mapping key and as a DNS-resolvable hostname on the project's network.
const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export function isValidServiceName(value: unknown): value is string {
  return typeof value === "string" && SERVICE_NAME_PATTERN.test(value);
}

// Compose's restart policy grammar: a fixed set of keywords, with
// "on-failure" optionally taking a max-retry count.
const RESTART_POLICY_PATTERN = /^(no|always|unless-stopped|on-failure(:\d+)?)$/;

export function isValidRestartPolicy(value: unknown): value is string {
  return typeof value === "string" && RESTART_POLICY_PATTERN.test(value);
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
