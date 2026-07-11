import { describe, expect, it } from "vitest";
import { removeServiceFromCompose } from "../src/main/compose-service";

describe("removeServiceFromCompose", () => {
  it("deletes the service block", () => {
    const source = "services:\n  api:\n    image: api:latest\n  postgres:\n    image: postgres:16\n";

    const result = removeServiceFromCompose(source, "postgres");

    expect(result.sourceText).not.toContain("postgres:");
    expect(result.sourceText).toContain("api:");
  });

  it("removes the entry from a short-list depends_on and drops the key once it's empty", () => {
    const source = "services:\n  api:\n    image: api:latest\n    depends_on:\n      - postgres\n  postgres:\n    image: postgres:16\n";

    const result = removeServiceFromCompose(source, "postgres");

    expect(result.sourceText).not.toContain("depends_on");
    expect(result.sourceText).not.toContain("- postgres");
  });

  it("keeps other depends_on entries when only one is removed", () => {
    const source =
      "services:\n  api:\n    image: api:latest\n    depends_on:\n      - postgres\n      - redis\n  postgres:\n    image: postgres:16\n  redis:\n    image: redis:7\n";

    const result = removeServiceFromCompose(source, "postgres");

    expect(result.sourceText).toContain("- redis");
    expect(result.sourceText).not.toContain("- postgres");
  });

  it("removes the entry from a map-form depends_on and drops the key once it's empty", () => {
    const source =
      "services:\n  api:\n    image: api:latest\n    depends_on:\n      postgres:\n        condition: service_healthy\n  postgres:\n    image: postgres:16\n";

    const result = removeServiceFromCompose(source, "postgres");

    expect(result.sourceText).not.toContain("depends_on");
    expect(result.sourceText).not.toContain("condition: service_healthy");
  });

  it("drops a named volume that only the removed service used", () => {
    const source =
      "services:\n  postgres:\n    image: postgres:16\n    volumes:\n      - postgres-data:/var/lib/postgresql/data\nvolumes:\n  postgres-data:\n";

    const result = removeServiceFromCompose(source, "postgres");

    expect(result.sourceText).not.toContain("postgres-data");
  });

  it("keeps a named volume that another remaining service still references", () => {
    const source =
      "services:\n  postgres:\n    image: postgres:16\n    volumes:\n      - shared-data:/data\n  worker:\n    image: worker:latest\n    volumes:\n      - shared-data:/data\nvolumes:\n  shared-data:\n";

    const result = removeServiceFromCompose(source, "postgres");

    expect(result.sourceText).toContain("shared-data:");
    expect(result.sourceText).toMatch(/worker:[\s\S]*shared-data/);
  });

  it("leaves a bind mount alone (no matching top-level volume to remove)", () => {
    const source = "services:\n  api:\n    image: api:latest\n    volumes:\n      - ./data:/data\n";

    const result = removeServiceFromCompose(source, "api");

    // Just confirms this doesn't throw or corrupt the file when the service
    // being removed has volumes that aren't top-level named volumes.
    expect(result.sourceText).not.toContain("api:");
  });
});
