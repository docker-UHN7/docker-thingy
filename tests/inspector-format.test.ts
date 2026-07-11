import { describe, expect, it } from "vitest";
import { formatBytes, formatMemoryUsage } from "../src/renderer/Inspector";

describe("formatBytes", () => {
  it("formats byte counts with an appropriate unit", () => {
    expect(formatBytes(5)).toBe("5.0 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });

  it("returns undefined for missing or invalid input, leaving the 'no limit' wording to callers", () => {
    expect(formatBytes(undefined)).toBeUndefined();
    expect(formatBytes(-1)).toBeUndefined();
  });
});

describe("formatMemoryUsage", () => {
  it("reports 'not available' when there is no stats snapshot yet", () => {
    expect(formatMemoryUsage(undefined)).toBe("not available");
  });

  it("does not mislabel a real zero-byte usage reading as 'no limit set'", () => {
    // Regression test: formatMemoryUsage used to delegate to the "limit"
    // formatter, which special-cased 0 (and falsy values) as "no limit set" -
    // a real (if rare) 0-byte usage reading would have shown the wrong text.
    expect(
      formatMemoryUsage({
        containerId: "abc",
        memoryUsageBytes: 0,
        fetchedAt: "2024-01-01T00:00:00.000Z"
      })
    ).toBe("0.0 B");
  });

  it("includes the memory percent when available", () => {
    expect(
      formatMemoryUsage({
        containerId: "abc",
        memoryUsageBytes: 1024,
        memoryPercent: 12.345,
        fetchedAt: "2024-01-01T00:00:00.000Z"
      })
    ).toBe("1.0 KB (12.3%)");
  });
});
