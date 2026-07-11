import { describe, expect, it } from "vitest";
import type { NetworkTopology } from "../src/shared/network-contracts";
import { applyOptimisticEdgeState } from "../src/main/topology-service";
import { parseVmLinkTargetId } from "../src/main/network-control-service";

describe("parseVmLinkTargetId", () => {
  it("splits on the last '|' so a domain name containing '|' still parses (MAC never does)", () => {
    expect(parseVmLinkTargetId("splunk-lab|52:54:00:fc:c6:27")).toEqual({
      domain: "splunk-lab",
      mac: "52:54:00:fc:c6:27"
    });
    expect(parseVmLinkTargetId("weird|name|52:54:00:fc:c6:27")).toEqual({
      domain: "weird|name",
      mac: "52:54:00:fc:c6:27"
    });
  });

  it("throws on a target id with no separator", () => {
    expect(() => parseVmLinkTargetId("no-separator-here")).toThrow();
  });
});

describe("applyOptimisticEdgeState", () => {
  const topology: NetworkTopology = {
    nodes: [
      { id: "bridge:docker0", kind: "bridge", name: "docker0", status: "up" },
      { id: "uplink:docker0", kind: "uplink", name: "Internet / LAN", status: "up" }
    ],
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
    ],
    checkedAt: "2026-01-01T00:00:00.000Z",
    controlAgentAvailable: true
  };

  it("patches the matching edge's state and its uplink node's status", () => {
    const patched = applyOptimisticEdgeState(topology, "bridge-forward", "docker0", "down");

    expect(patched.edges[0]?.state).toBe("down");
    expect(patched.nodes.find((node) => node.kind === "uplink")?.status).toBe("down");
  });

  it("leaves the topology untouched when no edge matches", () => {
    const patched = applyOptimisticEdgeState(topology, "container-link", "some-other-id", "down");
    expect(patched).toEqual(topology);
  });

  it("does not patch node status for a container-link/vm-link toggle (only bridge-forward affects an uplink node)", () => {
    const containerTopology: NetworkTopology = {
      nodes: [
        { id: "container:c1", kind: "container", name: "web", status: "up" },
        { id: "bridge:docker0", kind: "bridge", name: "docker0", status: "up" }
      ],
      edges: [
        {
          id: "attach:container:c1:docker0",
          from: "container:c1",
          to: "bridge:docker0",
          kind: "attachment",
          state: "up",
          controllable: true,
          verb: "container-link",
          actionTargetId: "c1"
        }
      ],
      checkedAt: "2026-01-01T00:00:00.000Z",
      controlAgentAvailable: true
    };

    const patched = applyOptimisticEdgeState(containerTopology, "container-link", "c1", "down");

    expect(patched.edges[0]?.state).toBe("down");
    expect(patched.nodes.find((node) => node.kind === "container")?.status).toBe("up");
  });
});
