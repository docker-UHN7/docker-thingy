import { describe, expect, it } from "vitest";
import { isValidContainerRef, normalizeLogTail, sanitizeSettingsPatch } from "../src/main/validation";

describe("isValidContainerRef", () => {
  it("accepts realistic container ids and names", () => {
    expect(isValidContainerRef("a1b2c3d4e5f6")).toBe(true);
    expect(isValidContainerRef("demo-web-1")).toBe(true);
    expect(isValidContainerRef("demo_api.1")).toBe(true);
  });

  it("rejects values that look like CLI flags or are the wrong type", () => {
    expect(isValidContainerRef("-v")).toBe(false);
    expect(isValidContainerRef("--privileged")).toBe(false);
    expect(isValidContainerRef("")).toBe(false);
    expect(isValidContainerRef(42)).toBe(false);
    expect(isValidContainerRef(undefined)).toBe(false);
  });
});

describe("normalizeLogTail", () => {
  it("passes through sane positive integers", () => {
    expect(normalizeLogTail(200)).toBe(200);
  });

  it("falls back to the default for non-numeric, zero, or negative input", () => {
    expect(normalizeLogTail(Number.NaN)).toBe(200);
    expect(normalizeLogTail(0)).toBe(200);
    expect(normalizeLogTail(-5)).toBe(200);
  });

  it("clamps unreasonably large values", () => {
    expect(normalizeLogTail(1_000_000)).toBe(10_000);
  });
});

describe("sanitizeSettingsPatch", () => {
  it("keeps a valid partial patch", () => {
    expect(sanitizeSettingsPatch({ statsPollSeconds: 5 })).toEqual({ statsPollSeconds: 5 });
  });

  it("drops an entire patch that fails validation", () => {
    expect(sanitizeSettingsPatch({ statsPollSeconds: "not-a-number" as unknown as number })).toEqual({});
  });

  it("ignores non-object input", () => {
    expect(sanitizeSettingsPatch(null)).toEqual({});
    expect(sanitizeSettingsPatch("nope")).toEqual({});
  });
});
