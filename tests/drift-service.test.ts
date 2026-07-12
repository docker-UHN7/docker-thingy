import { describe, expect, it } from "vitest";
import { detectServiceDrift } from "../src/main/drift-service";
import type { ContainerDetails, ServiceFields } from "../src/shared/contracts";

function fields(overrides: Partial<ServiceFields> = {}): ServiceFields {
  return {
    image: "nginx:alpine",
    restart: "unless-stopped",
    ports: [],
    volumes: [],
    dependsOn: [],
    environment: {},
    ...overrides
  };
}

function details(overrides: Partial<ContainerDetails> = {}): ContainerDetails {
  return {
    containerId: "abc123",
    image: "nginx:alpine",
    env: [],
    mounts: [],
    networks: [],
    labels: {},
    runtimeState: { status: "running", running: true, restarting: false, oomKilled: false },
    resources: { restartPolicyName: "unless-stopped" },
    command: [],
    entrypoint: [],
    ports: [],
    ...overrides
  };
}

describe("detectServiceDrift", () => {
  it("finds nothing when everything matches", () => {
    expect(detectServiceDrift("web", fields(), details())).toEqual([]);
  });

  it("flags an image mismatch", () => {
    const findings = detectServiceDrift("web", fields({ image: "nginx:alpine" }), details({ image: "nginx:latest" }));
    expect(findings).toEqual([{ serviceName: "web", field: "image", declared: "nginx:alpine", actual: "nginx:latest" }]);
  });

  it("resolves ${VAR:-default} interpolation before comparing images", () => {
    const findings = detectServiceDrift(
      "web",
      fields({ image: "nginx:${TAG:-alpine}" }),
      details({ image: "nginx:alpine" })
    );
    expect(findings).toEqual([]);
  });

  it("does not flag an image with unresolved interpolation and no default", () => {
    const findings = detectServiceDrift("web", fields({ image: "nginx:${TAG}" }), details({ image: "nginx:latest" }));
    expect(findings).toEqual([]);
  });

  it("flags a restart policy mismatch", () => {
    const findings = detectServiceDrift(
      "web",
      fields({ restart: "always" }),
      details({ resources: { restartPolicyName: "no" } })
    );
    expect(findings).toEqual([{ serviceName: "web", field: "restart", declared: "always", actual: "no" }]);
  });

  it("normalizes on-failure with a retry count", () => {
    const findings = detectServiceDrift(
      "web",
      fields({ restart: "on-failure:3" }),
      details({ resources: { restartPolicyName: "on-failure", restartRetryCount: 3 } })
    );
    expect(findings).toEqual([]);
  });

  it("flags an environment value mismatch", () => {
    const findings = detectServiceDrift(
      "web",
      fields({ environment: { LOG_LEVEL: "debug" } }),
      details({ env: [{ key: "LOG_LEVEL", value: "info", masked: false }] })
    );
    expect(findings).toEqual([{ serviceName: "web", field: "environment", declared: "LOG_LEVEL=debug", actual: "LOG_LEVEL=info" }]);
  });

  it("never compares or exposes a masked (secret) env value", () => {
    const findings = detectServiceDrift(
      "web",
      fields({ environment: { API_KEY: "declared-secret" } }),
      details({ env: [{ key: "API_KEY", value: "actual-secret", masked: true }] })
    );
    expect(findings).toEqual([]);
  });

  it("skips an env value with unresolved interpolation", () => {
    const findings = detectServiceDrift(
      "web",
      fields({ environment: { LOG_LEVEL: "${LOG_LEVEL}" } }),
      details({ env: [{ key: "LOG_LEVEL", value: "info", masked: false }] })
    );
    expect(findings).toEqual([]);
  });
});
