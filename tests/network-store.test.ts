import { describe, expect, it } from "vitest";
import type { NetworkTopology } from "../src/shared/network-contracts";
import { topologiesAreEquivalent } from "../src/renderer/network/networkStore";

function topology(overrides: Partial<NetworkTopology> = {}): NetworkTopology {
  return {
    nodes: [{ id: "bridge:docker0", kind: "bridge", name: "docker0", status: "up" }],
    edges: [],
    checkedAt: "2026-01-01T00:00:00.000Z",
    controlAgentAvailable: true,
    ...overrides
  };
}

describe("topologiesAreEquivalent", () => {
  it("treats two fetches with only a different checkedAt as equivalent", () => {
    const a = topology({ checkedAt: "2026-01-01T00:00:00.000Z" });
    const b = topology({ checkedAt: "2026-01-01T00:00:05.000Z" });
    expect(topologiesAreEquivalent(a, b)).toBe(true);
  });

  it("detects a real change in node status", () => {
    const a = topology();
    const b = topology({ nodes: [{ id: "bridge:docker0", kind: "bridge", name: "docker0", status: "down" }] });
    expect(topologiesAreEquivalent(a, b)).toBe(false);
  });

  it("detects a real change in edge count", () => {
    const a = topology();
    const b = topology({
      edges: [
        {
          id: "uplink:docker0",
          from: "bridge:docker0",
          to: "uplink:docker0",
          kind: "uplink",
          state: "up",
          controllable: true,
          verb: "bridge-forward",
          actionTargetId: "docker0"
        }
      ]
    });
    expect(topologiesAreEquivalent(a, b)).toBe(false);
  });
});
