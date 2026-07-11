import { describe, expect, it } from "vitest";
import { findPresetForImageName, resolveConnectionEnv, searchPresets, SERVICE_PRESETS } from "../src/shared/service-presets";

describe("searchPresets", () => {
  it("returns every preset for an empty query", () => {
    expect(searchPresets("")).toHaveLength(SERVICE_PRESETS.length);
  });

  it("matches by name even when the query differs from the preset key", () => {
    const results = searchPresets("mongodb");
    expect(results.some((preset) => preset.key === "mongo")).toBe(true);
  });

  it("matches by description", () => {
    const results = searchPresets("cache");
    expect(results.some((preset) => preset.key === "redis")).toBe(true);
  });

  it("returns nothing for a query that matches no preset", () => {
    expect(searchPresets("elasticsearch")).toEqual([]);
  });
});

describe("findPresetForImageName", () => {
  it("matches the official Docker Hub repo name", () => {
    expect(findPresetForImageName("postgres")?.key).toBe("postgres");
  });

  it("strips the library/ namespace prefix", () => {
    expect(findPresetForImageName("library/redis")?.key).toBe("redis");
  });

  it("matches a substring for third-party image names", () => {
    expect(findPresetForImageName("bitnami/postgresql")?.key).toBe("postgres");
  });

  it("returns undefined for an image with no curated preset", () => {
    expect(findPresetForImageName("my-custom-app")).toBeUndefined();
  });
});

describe("resolveConnectionEnv", () => {
  it("resolves {{service}} and {{ENV_KEY}} placeholders against the new service's name and environment", () => {
    const postgres = SERVICE_PRESETS.find((preset) => preset.key === "postgres");
    expect(postgres).toBeDefined();
    if (!postgres) return;

    const resolved = resolveConnectionEnv(postgres, "postgres", {
      POSTGRES_USER: "app",
      POSTGRES_PASSWORD: "s3cret",
      POSTGRES_DB: "appdb"
    });

    expect(resolved.DATABASE_URL).toBe("postgres://app:s3cret@postgres:5432/appdb");
  });

  it("resolves a preset with no seed environment (redis)", () => {
    const redis = SERVICE_PRESETS.find((preset) => preset.key === "redis");
    expect(redis).toBeDefined();
    if (!redis) return;

    const resolved = resolveConnectionEnv(redis, "cache", {});
    expect(resolved.REDIS_URL).toBe("redis://cache:6379");
  });
});
