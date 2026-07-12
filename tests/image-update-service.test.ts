import { afterEach, describe, expect, it, vi } from "vitest";
import { checkImageUpdate, parseHubImageRef } from "../src/main/image-update-service";

describe("parseHubImageRef", () => {
  it("resolves an unqualified image to the library namespace with an implicit latest tag", () => {
    expect(parseHubImageRef("nginx")).toEqual({ namespace: "library", repo: "nginx", tag: "latest" });
  });

  it("resolves an unqualified image with an explicit tag", () => {
    expect(parseHubImageRef("nginx:alpine")).toEqual({ namespace: "library", repo: "nginx", tag: "alpine" });
  });

  it("resolves a namespaced image", () => {
    expect(parseHubImageRef("bitnami/postgresql:16")).toEqual({ namespace: "bitnami", repo: "postgresql", tag: "16" });
  });

  it("refuses a digest-pinned reference - nothing to update to", () => {
    expect(parseHubImageRef("nginx@sha256:abc123")).toBeUndefined();
  });

  it("refuses an image on a non-Hub registry host", () => {
    expect(parseHubImageRef("ghcr.io/foo/bar:latest")).toBeUndefined();
    expect(parseHubImageRef("registry.example.com/foo:latest")).toBeUndefined();
    expect(parseHubImageRef("localhost:5000/foo:latest")).toBeUndefined();
  });
});

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("checkImageUpdate", () => {
  it("returns undefined for a reference this check can't resolve", async () => {
    const result = await checkImageUpdate("ghcr.io/foo/bar:latest");
    expect(result).toBeUndefined();
  });

  it("returns undefined for a digest-pinned reference without ever calling fetch", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await checkImageUpdate("nginx@sha256:abc123");

    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
