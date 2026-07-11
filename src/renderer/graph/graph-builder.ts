import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { MountRecord, ProjectSummary, ServiceNodeModel } from "../../shared/contracts";

type GraphNodeData =
  | ServiceNodeModel
  | { label: string }
  | { name: string; path: string }
  | { name: string; kind: string };

type GraphEdgeData = {
  kind: "dependency" | "mount" | "network-link";
};

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

export function buildGraph(project: ProjectSummary): { nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] } {
  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge<GraphEdgeData>[] = [];
  const volumeNames = new Set<string>();
  const serviceByName = new Map(project.services.map((service) => [service.name, service]));

  project.services.forEach((service, index) => {
    nodes.push({
      id: service.id,
      type: "serviceNode",
      position: { x: 260 * (index % 3), y: 220 * Math.floor(index / 3) },
      data: service
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
        label: relationship.condition ?? "depends_on",
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
          fill: "var(--accent-copper)"
        },
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
          fill: "var(--volume-node)"
        },
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
        label: relationship.label ?? "shared network",
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
          fill: "var(--status-info)"
        },
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
      data: {
        name: volumeName,
        path: volumeName
      }
    });
  }

  for (const external of project.externalNodes) {
    nodes.push({
      id: external.id,
      type: "externalNode",
      position: { x: 0, y: 0 },
      data: {
        name: external.name,
        kind: external.kind
      }
    });
  }

  return { nodes, edges };
}

export async function layoutGraph(
  project: ProjectSummary,
  direction: "RIGHT" | "DOWN" = "RIGHT"
): Promise<{ nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] }> {
  const elk = new ELK();
  const { nodes, edges } = buildGraph(project);

  const layout = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "84",
      "elk.edgeRouting": "ORTHOGONAL"
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.type === "serviceNode" ? 260 : 180,
      height: node.type === "serviceNode" ? 144 : 84
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
    const maxX = Math.max(...members.map((node) => node.position.x + 260));
    const maxY = Math.max(...members.map((node) => node.position.y + 144));

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
