import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { MountRecord, ProjectSummary, ServiceNodeModel } from "../../shared/contracts";

const elk = new ELK();

type GraphNodeData =
  | (ServiceNodeModel & { layoutDirection: "RIGHT" | "DOWN" })
  | { label: string }
  | { name: string; path: string; layoutDirection: "RIGHT" | "DOWN" }
  | { name: string; kind: string; layoutDirection: "RIGHT" | "DOWN" };

type GraphEdgeData = {
  kind: "dependency" | "mount" | "network-link";
};

// These pixel dimensions MUST stay in sync with the rendered node sizes in
// styles.css (`.manifest-node` and `.volume-node`/`.external-node`). ELK lays
// out the graph using these numbers *before* anything is rendered to the DOM,
// so if the CSS box is ever bigger than what we tell ELK, nodes will overlap.
// Both node families are fixed-height (with `overflow: hidden`) precisely so
// that "actual rendered size" can never drift from these constants regardless
// of content length.
export const SERVICE_NODE_WIDTH = 208;
export const SERVICE_NODE_HEIGHT = 140;
export const COMPACT_NODE_WIDTH = 152;
export const COMPACT_NODE_HEIGHT = 72;

// Rough width estimate for an edge label so ELK can reserve enough space
// between layers to fit the label chip without it overlapping a node. Edge
// labels render in an 11px bold monospace font (see `.react-flow__edge-text`
// in styles.css); ~7px/char covers that comfortably, plus padding for the
// label chip's own background.
const EDGE_LABEL_CHAR_WIDTH = 7;
const EDGE_LABEL_CHIP_PADDING = 16;
const EDGE_LABEL_HEIGHT = 20;
const EDGE_LABEL_MIN_WIDTH = 32;

function estimateEdgeLabelWidth(label: string): number {
  return Math.max(EDGE_LABEL_MIN_WIDTH, label.length * EDGE_LABEL_CHAR_WIDTH + EDGE_LABEL_CHIP_PADDING);
}

// Shared styling so every edge label renders as an opaque, bordered chip
// rather than bare text - otherwise it visually merges with whatever node
// content happens to sit underneath it.
function edgeLabelChipStyle(color: string) {
  return {
    labelBgStyle: {
      fill: "var(--bg-elevated)",
      fillOpacity: 1,
      stroke: color,
      strokeWidth: 1
    },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4
  };
}

function findVolumeMount(service: ServiceNodeModel, volumeName: string): MountRecord | undefined {
  return service.details?.mounts.find((mount) => (mount.name ?? mount.source) === volumeName);
}

function createVolumeLabel(service: ServiceNodeModel, volumeName: string): string {
  const mount = findVolumeMount(service, volumeName);
  if (!mount) {
    return volumeName;
  }

  return `${mount.destination} (${mount.rw ? "rw" : "ro"})`;
}

function dependencyEdgeLabel(condition: string | undefined): string | undefined {
  if (!condition || condition === "service_started") {
    return undefined;
  }

  return condition.replace(/^service_/, "");
}

function networkEdgeLabel(label: string | undefined): string | undefined {
  if (!label || label === "shared network") {
    return undefined;
  }

  return label;
}

export function buildGraph(
  project: ProjectSummary,
  direction: "RIGHT" | "DOWN" = "RIGHT"
): { nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] } {
  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge<GraphEdgeData>[] = [];
  const volumeNames = new Set<string>();
  const serviceByName = new Map(project.services.map((service) => [service.name, service]));
  const targetPosition = direction === "RIGHT" ? Position.Left : Position.Top;
  const sourcePosition = direction === "RIGHT" ? Position.Right : Position.Bottom;

  project.services.forEach((service, index) => {
    nodes.push({
      id: service.id,
      type: "serviceNode",
      position: { x: 260 * (index % 3), y: 220 * Math.floor(index / 3) },
      targetPosition,
      sourcePosition,
      data: {
        ...service,
        layoutDirection: direction
      }
    });
  });

  for (const relationship of project.relationshipEdges ?? []) {
    if (relationship.kind === "depends_on") {
      const sourceService = serviceByName.get(relationship.from);
      const targetService = serviceByName.get(relationship.to);
      const targetId = targetService?.id ?? `external-service:${relationship.to}`;
      if (!sourceService) {
        continue;
      }
      edges.push({
        id: `depends_on:${sourceService.id}:${targetId}`,
        source: sourceService.id,
        target: targetId,
        label: dependencyEdgeLabel(relationship.condition),
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: "var(--accent-copper)"
        },
        style: {
          stroke: "var(--accent-copper)",
          strokeWidth: 2.6
        },
        labelStyle: {
          fill: "var(--accent-copper)",
          fontWeight: 600
        },
        ...edgeLabelChipStyle("var(--accent-copper)"),
        data: {
          kind: "dependency"
        },
        animated: false
      });
      continue;
    }

    if (relationship.kind === "volume") {
      const targetService = serviceByName.get(relationship.to);
      if (!targetService) {
        continue;
      }
      const volumeName = relationship.from;
      volumeNames.add(volumeName);
      edges.push({
        id: `volume:${volumeName}->${targetService.id}`,
        source: `volume:${volumeName}`,
        target: targetService.id,
        label: createVolumeLabel(targetService, volumeName),
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "var(--volume-node)"
        },
        style: {
          stroke: "var(--volume-node)",
          strokeWidth: 2.1,
          strokeDasharray: "6 4"
        },
        labelStyle: {
          fill: "var(--volume-node)",
          fontWeight: 600
        },
        ...edgeLabelChipStyle("var(--volume-node)"),
        data: {
          kind: "mount"
        },
        animated: false
      });
      continue;
    }

    if (relationship.kind === "network") {
      const left = serviceByName.get(relationship.from);
      const right = serviceByName.get(relationship.to);
      if (!left || !right) {
        continue;
      }
      edges.push({
        id: `network:${left.id}:${right.id}:${relationship.label ?? "shared"}`,
        source: left.id,
        target: right.id,
        label: networkEdgeLabel(relationship.label),
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "var(--status-info)"
        },
        style: {
          stroke: "var(--status-info)",
          strokeWidth: 2.4,
          strokeDasharray: "3 6"
        },
        labelStyle: {
          fill: "var(--status-info)",
          fontWeight: 600
        },
        ...edgeLabelChipStyle("var(--status-info)"),
        data: {
          kind: "network-link"
        },
        animated: false
      });
    }
  }

  for (const volumeName of volumeNames) {
    nodes.push({
      id: `volume:${volumeName}`,
      type: "volumeNode",
      position: { x: 0, y: 0 },
      sourcePosition,
      data: {
        name: volumeName,
        path: volumeName,
        layoutDirection: direction
      }
    });
  }

  for (const external of project.externalNodes) {
    nodes.push({
      id: external.id,
      type: "externalNode",
      position: { x: 0, y: 0 },
      targetPosition,
      data: {
        name: external.name,
        kind: external.kind,
        layoutDirection: direction
      }
    });
  }

  return { nodes, edges };
}

export async function layoutGraph(
  project: ProjectSummary,
  direction: "RIGHT" | "DOWN" = "RIGHT"
): Promise<{ nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] }> {
  const { nodes, edges } = buildGraph(project, direction);

  const layout = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": direction === "RIGHT" ? "76" : "84",
      "elk.layered.spacing.nodeNodeBetweenLayers": direction === "RIGHT" ? "156" : "140",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      // Reserve room around edges/labels so a label chip never sits flush
      // against (or on top of) a node's border.
      "elk.spacing.edgeNode": "52",
      "elk.spacing.edgeEdge": "24",
      "elk.spacing.edgeLabel": "18",
      "elk.layered.spacing.edgeNodeBetweenLayers": "48",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "24"
    },
    // Widths/heights here must match the actual rendered node sizes (see the
    // SERVICE_NODE_*/COMPACT_NODE_* constants above and the corresponding
    // fixed-size, overflow-hidden CSS rules) or ELK will under-allocate space
    // and neighboring nodes/edges will overlap.
    children: nodes.map((node) => ({
      id: node.id,
      width: node.type === "serviceNode" ? SERVICE_NODE_WIDTH : COMPACT_NODE_WIDTH,
      height: node.type === "serviceNode" ? SERVICE_NODE_HEIGHT : COMPACT_NODE_HEIGHT
    })),
    edges: edges.map((edge) => {
      const labelText = typeof edge.label === "string" ? edge.label : undefined;
      return {
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        // Giving ELK the label's approximate footprint lets the layered
        // algorithm widen the gap between layers just enough to fit it,
        // instead of drawing it wherever happens to be free (often on top
        // of a node).
        labels: labelText
          ? [{ id: `${edge.id}::label`, text: labelText, width: estimateEdgeLabelWidth(labelText), height: EDGE_LABEL_HEIGHT }]
          : []
      };
    })
  });

  const laidOutNodes = nodes.map((node) => {
    const match = layout.children?.find((entry) => entry.id === node.id);
    return {
      ...node,
      position: {
        x: match?.x ?? node.position.x,
        y: match?.y ?? node.position.y
      },
      zIndex: node.type === "networkRegion" ? 0 : 2
    };
  });

  const regions: Node<GraphNodeData>[] = [];
  for (const networkName of new Set(project.services.flatMap((service) => service.categories.networks))) {
    const members = laidOutNodes.filter(
      (node) =>
        node.type === "serviceNode" &&
        project.services.find((service) => service.id === node.id)?.categories.networks.includes(networkName)
    );
    if (members.length === 0) {
      continue;
    }

    const minX = Math.min(...members.map((node) => node.position.x)) - 36;
    const minY = Math.min(...members.map((node) => node.position.y)) - 28;
    const maxX = Math.max(...members.map((node) => node.position.x + SERVICE_NODE_WIDTH));
    const maxY = Math.max(...members.map((node) => node.position.y + SERVICE_NODE_HEIGHT));

    regions.push({
      id: `network-region:${project.id}:${networkName}`,
      type: "networkRegion",
      position: { x: minX, y: minY },
      selectable: false,
      draggable: false,
      data: {
        label: networkName
      },
      style: {
        width: maxX - minX + 36,
        height: maxY - minY + 28
      },
      zIndex: 0
    });
  }

  return {
    edges,
    nodes: [...regions, ...laidOutNodes]
  };
}
