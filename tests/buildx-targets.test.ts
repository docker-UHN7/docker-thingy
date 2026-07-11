import { describe, expect, it } from "vitest";
import { parseBuildxTargets, validateImageTag } from "../src/main/dockerfile-service";

describe("parseBuildxTargets", () => {
  it("parses a human-readable target table", () => {
    const text = `TARGET DESCRIPTION\nbase foundation\nrelease production (default)`;
    const result = parseBuildxTargets(text);

    expect(result.targets).toHaveLength(2);
    expect(result.targets[1]).toMatchObject({ name: "release", isDefault: true });
  });

  it("validates image tags for build actions", () => {
    expect(validateImageTag("docker-thingy:dev").ok).toBe(true);
    expect(validateImageTag("bad tag").ok).toBe(false);
  });
});

