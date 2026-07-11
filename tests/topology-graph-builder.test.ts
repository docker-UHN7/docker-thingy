import { describe, expect, it } from "vitest";
import type { NetworkTopology } from "../src/shared/network-contracts";
import { buildTopologyGraph } from "../src/renderer/network/topology-graph-builder";

describe("buildTopologyGraph", () => {
  const topology: NetworkTopology = {
    nodes: [
      { id: "container:c1", kind: "container", name: "web", status: "up", detail: "nginx:alpine" },
      { id: "bridge:docker0", kind: "bridge", name: "docker0 (bridge)", status: "up" },
      { id: "uplink:docker0", kind: "uplink", name: "Internet / LAN", status: "up" }
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
      },
      {
        id: "uplink:docker0",
        from: "bridge:docker0",
        to: "uplink:docker0",
        kind: "uplink",
        state: "down",
        controllable: true,
        verb: "bridge-forward",
        actionTargetId: "docker0"
      }
    ],
    checkedAt: "2026-01-01T00:00:00.000Z",
    controlAgentAvailable: true
  };

  it("maps every topology node to a flow node with the right type", () => {
    const graph = buildTopologyGraph(topology);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.find((node) => node.id === "container:c1")).toMatchObject({ type: "topologyNode" });
    expect(graph.nodes.find((node) => node.id === "uplink:docker0")).toMatchObject({ type: "uplinkNode" });
  });

  it("maps edges preserving source/target and kind", () => {
    const graph = buildTopologyGraph(topology);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ source: "container:c1", target: "bridge:docker0" });
    expect(graph.edges[0]?.data).toMatchObject({ kind: "attachment", state: "up", controllable: true });
  });

  it("renders a down edge as dashed with a 'disconnected' label, and an up edge as solid with no label", () => {
    const graph = buildTopologyGraph(topology);

    const upEdge = graph.edges.find((edge) => edge.id === "attach:container:c1:docker0");
    const downEdge = graph.edges.find((edge) => edge.id === "uplink:docker0");

    expect(upEdge?.label).toBeUndefined();
    expect(upEdge?.style?.strokeDasharray).toBeUndefined();
    expect(downEdge?.label).toBe("disconnected");
    expect(downEdge?.style?.strokeDasharray).toBe("5 5");
  });
});
