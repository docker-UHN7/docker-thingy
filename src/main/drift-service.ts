import type { ContainerDetails, DriftFinding, ServiceFields } from "../shared/contracts";

/**
 * Best-effort resolution of compose `${VAR}` / `${VAR:-default}` interpolation
 * down to its fallback default (mirrors DockerNodes.tsx's formatImageDisplay,
 * duplicated here rather than shared since main can't import renderer code).
 * Without the project's actual .env values this can't resolve a bare `${VAR}`
 * with no default - those are left alone and simply never flagged, since a
 * false "drift" from unresolved interpolation syntax would be worse than a
 * missed one.
 */
function resolveInterpolation(value: string): string {
  return value.replace(/\$\{([^}:]+)(:-([^}]*))?\}/g, (_match, varName: string, hasDefault: string, defaultValue?: string) =>
    hasDefault ? (defaultValue ?? "") : `\${${varName}}`
  );
}

function normalizeRestart(value: string | undefined, retryCount: number | undefined): string {
  if (!value || value === "no" || value === "") {
    return retryCount ? `on-failure:${retryCount}` : "no";
  }
  if (value === "on-failure" && retryCount) {
    return `on-failure:${retryCount}`;
  }
  return value;
}

/**
 * Compares one service's declared compose fields against its running
 * container's actual state. Only the fields most likely to indicate a real
 * "someone hand-changed this outside of source control" gap: image, restart
 * policy, and environment. Ports/volumes are deliberately excluded - they're
 * already a lossy, merged projection by the time they reach ServiceNodeModel
 * (see ContainerDetails' own comment on ServiceFields), too noisy to diff
 * reliably here.
 */
export function detectServiceDrift(serviceName: string, declared: ServiceFields, actual: ContainerDetails): DriftFinding[] {
  const findings: DriftFinding[] = [];

  const declaredImage = declared.image ? resolveInterpolation(declared.image) : undefined;
  if (declaredImage && actual.image && !declaredImage.includes("${") && declaredImage !== actual.image) {
    findings.push({ serviceName, field: "image", declared: declaredImage, actual: actual.image });
  }

  const declaredRestart = normalizeRestart(declared.restart, undefined);
  const actualRestart = normalizeRestart(actual.resources.restartPolicyName, actual.resources.restartRetryCount);
  if (declared.restart && declaredRestart !== actualRestart) {
    findings.push({ serviceName, field: "restart", declared: declaredRestart, actual: actualRestart });
  }

  const actualEnv = new Map(actual.env.filter((entry) => !entry.masked).map((entry) => [entry.key, entry.value]));
  for (const [key, declaredValue] of Object.entries(declared.environment)) {
    if (declaredValue.includes("${")) {
      // Unresolved interpolation - can't tell if it matches without the
      // project's real env, so don't guess.
      continue;
    }
    const resolvedValue = resolveInterpolation(declaredValue);
    const actualValue = actualEnv.get(key);
    if (actualValue !== undefined && actualValue !== resolvedValue) {
      findings.push({ serviceName, field: "environment", declared: `${key}=${resolvedValue}`, actual: `${key}=${actualValue}` });
    }
  }

  return findings;
}
