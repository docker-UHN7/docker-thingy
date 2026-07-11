import { describe, expect, it } from "vitest";
import { addServiceToCompose } from "../src/main/compose-service";

describe("addServiceToCompose", () => {
  it("adds a new service block with image, environment, and a named volume", () => {
    const source = "services:\n  api:\n    image: api:latest\n";

    const result = addServiceToCompose(source, {
      serviceName: "postgres",
      image: "postgres:16",
      environment: { POSTGRES_USER: "app", POSTGRES_PASSWORD: "app" },
      volumeName: "postgres-data",
      volumeMountPath: "/var/lib/postgresql/data"
    });

    expect(result.sourceText).toContain("postgres:\n");
    expect(result.sourceText).toContain("image: postgres:16");
    expect(result.sourceText).toContain("POSTGRES_USER: app");
    expect(result.sourceText).toContain("postgres-data:/var/lib/postgresql/data");
    expect(result.sourceText).toContain("volumes:\n  postgres-data:");
  });

  it("wires depends_on (short-list form) and merges connection env vars into the target service", () => {
    const source = "services:\n  api:\n    image: api:latest\n";

    const result = addServiceToCompose(source, {
      serviceName: "postgres",
      image: "postgres:16",
      connectTo: [{ serviceName: "api", environment: { DATABASE_URL: "postgres://app:app@postgres:5432/app" } }]
    });

    expect(result.sourceText).toMatch(/api:\n\s+image: api:latest\n\s+depends_on:\n\s+- postgres/);
    expect(result.sourceText).toContain("DATABASE_URL: postgres://app:app@postgres:5432/app");
  });

  it("appends to an existing short-list depends_on instead of replacing it", () => {
    const source = "services:\n  api:\n    image: api:latest\n    depends_on:\n      - redis\n";

    const result = addServiceToCompose(source, {
      serviceName: "postgres",
      image: "postgres:16",
      connectTo: [{ serviceName: "api", environment: {} }]
    });

    expect(result.sourceText).toContain("- redis");
    expect(result.sourceText).toContain("- postgres");
  });

  it("adds a condition entry to an existing long-form (map) depends_on", () => {
    const source =
      "services:\n  api:\n    image: api:latest\n    depends_on:\n      redis:\n        condition: service_healthy\n";

    const result = addServiceToCompose(source, {
      serviceName: "postgres",
      image: "postgres:16",
      connectTo: [{ serviceName: "api", environment: {} }]
    });

    expect(result.sourceText).toContain("redis:");
    expect(result.sourceText).toContain("condition: service_healthy");
    expect(result.sourceText).toMatch(/postgres:\n\s+condition: service_started/);
  });

  it("appends to an existing list-form environment instead of switching to map form", () => {
    const source = "services:\n  api:\n    image: api:latest\n    environment:\n      - EXISTING=1\n";

    const result = addServiceToCompose(source, {
      serviceName: "postgres",
      image: "postgres:16",
      connectTo: [{ serviceName: "api", environment: { DATABASE_URL: "postgres://app:app@postgres:5432/app" } }]
    });

    expect(result.sourceText).toContain("- EXISTING=1");
    expect(result.sourceText).toContain("- DATABASE_URL=postgres://app:app@postgres:5432/app");
  });

  it("does not duplicate a depends_on entry that's already present", () => {
    const source = "services:\n  api:\n    image: api:latest\n    depends_on:\n      - postgres\n";

    const result = addServiceToCompose(source, {
      serviceName: "postgres",
      image: "postgres:16",
      connectTo: [{ serviceName: "api", environment: {} }]
    });

    const occurrences = result.sourceText.match(/- postgres/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});
