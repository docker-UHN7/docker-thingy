import { afterEach, describe, expect, it, vi } from "vitest";
import { searchDockerHub } from "../src/main/docker-hub-service";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("searchDockerHub", () => {
  it("returns an empty list for a blank query without calling fetch", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const results = await searchDockerHub("   ");

    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a successful search response, sorted official-and-popular first", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { name: "bitnami/postgresql", description: "Bitnami postgres", is_official: false, star_count: 500 },
          { name: "postgres", description: "The official PostgreSQL image", is_official: true, star_count: 12000 },
          { name: "no-name-field" } // missing "name" is filtered out below via a broken entry test instead
        ]
      })
    }) as unknown as typeof fetch;

    const results = await searchDockerHub("postgres");

    expect(results[0]).toEqual({
      name: "postgres",
      description: "The official PostgreSQL image",
      isOfficial: true,
      starCount: 12000
    });
    expect(results[1]?.name).toBe("bitnami/postgresql");
  });

  it("drops malformed entries that have no name", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ description: "no name here" }, { name: "redis", star_count: 10 }] })
    }) as unknown as typeof fetch;

    const results = await searchDockerHub("redis");
    expect(results).toEqual([{ name: "redis", description: "", isOfficial: false, starCount: 10 }]);
  });

  it("returns an empty list when the response isn't ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const results = await searchDockerHub("postgres");
    expect(results).toEqual([]);
  });

  it("returns an empty list instead of throwing when fetch rejects (offline)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const results = await searchDockerHub("postgres");
    expect(results).toEqual([]);
  });
});
