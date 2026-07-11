import { describe, expect, it } from "vitest";
import { distinguishingFileLabel, longestCommonPrefix } from "../src/renderer/compose-file-labels";

describe("longestCommonPrefix", () => {
  it("finds the shared prefix across compose file names, backing off the trailing separator", () => {
    const prefix = longestCommonPrefix([
      "docker-compose.yml",
      "docker-compose.local.prod.yml",
      "docker-compose.override.yml",
      "docker-compose.prod.yml"
    ]);

    expect(prefix).toBe("docker-compose");
  });

  it("returns the whole string when there's only one file", () => {
    expect(longestCommonPrefix(["docker-compose.yml"])).toBe("docker-compose.yml");
  });

  it("returns an empty string for an empty list", () => {
    expect(longestCommonPrefix([])).toBe("");
  });

  it("returns an empty string when names share nothing", () => {
    expect(longestCommonPrefix(["a.yml", "b.yml"])).toBe("");
  });
});

describe("distinguishingFileLabel", () => {
  const commonPrefix = "docker-compose";

  it("strips the shared prefix so the differing suffix stands out", () => {
    expect(distinguishingFileLabel("docker-compose.override.yml", commonPrefix)).toBe(".override.yml");
    expect(distinguishingFileLabel("docker-compose.local.prod.yml", commonPrefix)).toBe(".local.prod.yml");
    expect(distinguishingFileLabel("docker-compose.prod.yml", commonPrefix)).toBe(".prod.yml");
  });

  it("falls back to the full name when stripping would leave nothing (the file that IS the prefix)", () => {
    expect(distinguishingFileLabel("docker-compose", commonPrefix)).toBe("docker-compose");
  });

  it("does not strip a trivially short common prefix", () => {
    expect(distinguishingFileLabel("a.yml", "a")).toBe("a.yml");
  });

  it("leaves names alone when there's no common prefix", () => {
    expect(distinguishingFileLabel("compose.yaml", "")).toBe("compose.yaml");
  });
});
