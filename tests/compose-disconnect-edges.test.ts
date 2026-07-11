import { describe, expect, it } from "vitest";
import { removeDependencyEdge, removeVolumeMount } from "../src/main/compose-service";

describe("removeDependencyEdge", () => {
  it("removes one entry from a short-list depends_on, dropping the key once empty", () => {
    const source = "services:\n  api:\n    image: api:latest\n    depends_on:\n      - postgres\n";

    const result = removeDependencyEdge(source, "api", "postgres");
    expect(result.sourceText).not.toContain("depends_on");
  });

  it("removes one entry from a map-form depends_on, keeping the others", () => {
    const source =
      "services:\n  api:\n    image: api:latest\n    depends_on:\n      postgres:\n        condition: service_healthy\n      redis:\n        condition: service_started\n";

    const result = removeDependencyEdge(source, "api", "postgres");
    expect(result.sourceText).not.toContain("postgres");
    expect(result.sourceText).toContain("redis");
  });

  it("is a no-op when the dependency isn't present", () => {
    const source = "services:\n  api:\n    image: api:latest\n";
    const result = removeDependencyEdge(source, "api", "postgres");
    expect(result.sourceText).toBe(source);
  });
});

describe("removeVolumeMount", () => {
  it("removes the mount from the service and drops the now-unused top-level volumes key entirely", () => {
    const source =
      "services:\n  postgres:\n    image: postgres:16\n    volumes:\n      - postgres-data:/var/lib/postgresql/data\nvolumes:\n  postgres-data:\n";

    const result = removeVolumeMount(source, "postgres", "postgres-data");
    expect(result.sourceText).not.toContain("volumes:");
    expect(result.sourceText).not.toContain("postgres-data");
  });

  it("keeps the top-level volume when another service still mounts it, removing it only from the target service", () => {
    const source =
      "services:\n  postgres:\n    image: postgres:16\n    volumes:\n      - shared:/data\n  worker:\n    image: worker:latest\n    volumes:\n      - shared:/data\nvolumes:\n  shared:\n";

    const result = removeVolumeMount(source, "postgres", "shared");
    expect(result.sourceText).toContain("volumes:\n  shared:");
    // postgres keeps its image line but loses its volumes block entirely.
    expect(result.sourceText).toMatch(/postgres:\n\s+image: postgres:16\n\s+worker:/);
    expect(result.sourceText).toMatch(/worker:\n[\s\S]*- shared:\/data/);
  });

  it("leaves other volumes on the same service untouched", () => {
    const source =
      "services:\n  api:\n    image: api:latest\n    volumes:\n      - cache:/cache\n      - logs:/logs\nvolumes:\n  cache:\n  logs:\n";

    const result = removeVolumeMount(source, "api", "cache");
    expect(result.sourceText).toContain("logs:/logs");
    expect(result.sourceText).not.toContain("cache:/cache");
  });
});
