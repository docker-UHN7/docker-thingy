import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { NetworkTopology, TopologyNode as TopologyNodeModel } from "../../shared/network-contracts";

export type TopologyGraphEdgeData = {
  kind: "attachment" | "uplink" | "interconnect";
  state: "up" | "down";
  controllable: boolean;
};

// Must stay in sync with the fixed node sizes in styles.css
// (.topology-node / .topology-uplink-node) - see graph-builder.ts's
// SERVICE_NODE_WIDTH comment for why this matters for ELK layout.
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 100;
export const UPLINK_NODE_WIDTH = 150;
export const UPLINK_NODE_HEIGHT = 64;

// Interconnect edges get their own color (reusing the same purple the
// Compose project graph already uses for volume edges - an established
// "this is a different relationship type" visual language) since, unlike
// attachment/uplink, they only ever exist while connected - there's no
// "down" state to color for.
function edgeColor(kind: TopologyGraphEdgeData["kind"], state: "up" | "down"): string {
  if (kind === "interconnect") {
    return "var(--volume-node)";
  }
  return state === "up" ? "var(--status-running)" : "var(--status-error)";
}

export function buildTopologyGraph(topology: NetworkTopology): {
  nodes: Node<TopologyNodeModel>[];
  edges: Edge<TopologyGraphEdgeData>[];
} {
  const nodes: Node<TopologyNodeModel>[] = topology.nodes.map((node, index) => ({
    id: node.id,
    type: node.kind === "uplink" ? "uplinkNode" : "topologyNode",
    position: { x: 260 * (index % 4), y: 160 * Math.floor(index / 4) },
    data: node
  }));

  const edges: Edge<TopologyGraphEdgeData>[] = topology.edges.map((edge) => {
    const color = edgeColor(edge.kind, edge.state);
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: "smoothstep",
      label: edge.state === "down" ? "disconnected" : undefined,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color
      },
      style: {
        stroke: color,
        strokeWidth: 2.2,
        strokeDasharray: edge.state === "down" ? "5 5" : undefined
      },
      labelStyle: {
        fill: color,
        fontWeight: 600
      },
      // Only a device's own attachment edge can be dragged onto a different
      // bridge to reattach it - uplink (bridge<->internet) and interconnect
      // (bridge<->bridge) edges use click-to-toggle only, not drag.
      reconnectable: edge.kind === "attachment",
      data: {
        kind: edge.kind,
        state: edge.state,
        controllable: edge.controllable
      },
      animated: false
    };
  });

  return { nodes, edges };
}

export async function layoutTopologyGraph(
  topology: NetworkTopology,
  direction: "RIGHT" | "DOWN" = "RIGHT"
): Promise<{ nodes: Node<TopologyNodeModel>[]; edges: Edge<TopologyGraphEdgeData>[] }> {
  const elk = new ELK();
  const { nodes, edges } = buildTopologyGraph(topology);

  const layout = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.edgeNode": "28",
      "elk.spacing.edgeEdge": "16"
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.type === "uplinkNode" ? UPLINK_NODE_WIDTH : NODE_WIDTH,
      height: node.type === "uplinkNode" ? UPLINK_NODE_HEIGHT : NODE_HEIGHT
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  });

  const laidOutNodes = nodes.map((node) => {
    const match = layout.children?.find((entry) => entry.id === node.id);
    return {
      ...node,
      position: {
        x: match?.x ?? node.position.x,
        y: match?.y ?? node.position.y
      }
    };
  });

  return { nodes: laidOutNodes, edges };
}
