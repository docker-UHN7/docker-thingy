import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { MountRecord, ProjectSummary, ServiceNodeModel } from "../../shared/contracts";

type VolumeNodeData = {
  name: string;
  path: string;
  consumerCount: number;
};

type ExternalNodeData = {
  name: string;
  kind: string;
};

export type GraphNodeData = ServiceNodeModel | VolumeNodeData | ExternalNodeData;

export type GraphEdgeData = {
  kind: "dependency" | "mount";
  label?: string;
  color: string;
  dashed?: boolean;
};

type DependencyEdgeRecord = {
  sourceId: string;
  targetId: string;
  label?: string;
};

type VolumeResource = {
  id: string;
  name: string;
  path: string;
  consumerIds: string[];
  targetPaths: Map<string, string>;
};

type ExternalDependencyNode = {
  id: string;
  name: string;
  consumerIds: string[];
};

type Point = {
  x: number;
  y: number;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AxisAnchor = {
  nodeId: string;
  anchor: number;
};

export type MeasuredNode = {
  id: string;
  width: number;
  height: number;
};

const SERVICE_NODE_WIDTH = 224;
const SERVICE_NODE_HEIGHT = 152;
const COMPACT_NODE_WIDTH = 164;
const COMPACT_NODE_HEIGHT = 78;
const SERVICE_GAP_X = 150;
const SERVICE_GAP_Y = 180;
const SIDE_COLUMN_OFFSET = 360;
const EXTERNAL_ROW_OFFSET = 220;
const SIDE_COLLISION_GAP = COMPACT_NODE_HEIGHT + 54;
const TOP_COLLISION_GAP = COMPACT_NODE_WIDTH + 54;
const GLOBAL_COLLISION_PADDING = 48;
const VOLUME_HORIZONTAL_GAP = 132;
const LABEL_WIDTH = 88;
const LABEL_HEIGHT = 26;

function dependencyEdgeLabel(condition: string | undefined): string | undefined {
  if (!condition || condition === "service_started") {
    return undefined;
  }

  return condition.replace(/^service_/, "");
}

function compactPath(value: string, maxParts = 2): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length <= maxParts) {
    return normalized;
  }

  return `.../${parts.slice(-maxParts).join("/")}`;
}

function normalizeHostPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function isPathLike(value: string): boolean {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value) || value.startsWith(".") || value.startsWith("~");
}

function canonicalVolumeName(rawName: string, service: ServiceNodeModel, composeProjectName?: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return rawName;
  }

  const candidates = service.categories.volumes.filter((entry) => entry && !isPathLike(normalizeHostPath(entry)));
  if (candidates.includes(trimmed)) {
    return trimmed;
  }

  if (composeProjectName) {
    const prefixed = `${composeProjectName}_`;
    if (trimmed.startsWith(prefixed)) {
      const logicalName = trimmed.slice(prefixed.length);
      if (candidates.includes(logicalName)) {
        return logicalName;
      }
    }
  }

  return trimmed;
}

function nodeWidth(type: Node["type"]): number {
  return type === "serviceNode" ? SERVICE_NODE_WIDTH : COMPACT_NODE_WIDTH;
}

function nodeHeight(type: Node["type"]): number {
  return type === "serviceNode" ? SERVICE_NODE_HEIGHT : COMPACT_NODE_HEIGHT;
}

function measuredWidth(node: Node<GraphNodeData>, measured: Map<string, MeasuredNode>): number {
  return measured.get(node.id)?.width ?? nodeWidth(node.type);
}

function measuredHeight(node: Node<GraphNodeData>, measured: Map<string, MeasuredNode>): number {
  return measured.get(node.id)?.height ?? nodeHeight(node.type);
}

function rectForNode(node: Node<GraphNodeData>, measured: Map<string, MeasuredNode>): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: measuredWidth(node, measured),
    height: measuredHeight(node, measured)
  };
}

function rectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function rectsOverlap(a: Rect, b: Rect, padding = GLOBAL_COLLISION_PADDING): boolean {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

function nudgeNode(node: Node<GraphNodeData>, dx: number, dy: number): Node<GraphNodeData> {
  return {
    ...node,
    position: {
      x: node.position.x + dx,
      y: node.position.y + dy
    }
  };
}

function edgeKey(edge: { source: string; target: string; kind: string; label?: string }): string {
  return [edge.source, edge.target, edge.kind, edge.label ?? ""].join("|");
}

function mountLabel(mount: MountRecord | undefined, fallback: string): string {
  if (!mount?.destination) {
    return compactPath(fallback);
  }

  return compactPath(mount.destination);
}

function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function centerOf(node: Node): Point {
  return {
    x: node.position.x + nodeWidth(node.type) / 2,
    y: node.position.y + nodeHeight(node.type) / 2
  };
}

function serviceNodeMap(nodes: Node<GraphNodeData>[]): Map<string, Node<GraphNodeData>> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function consumerCenter(ids: string[], positions: Map<string, Node<GraphNodeData>>): Point {
  const points = ids
    .map((id) => positions.get(id))
    .filter((node): node is Node<GraphNodeData> => Boolean(node))
    .map(centerOf);

  return {
    x: average(points.map((point) => point.x)),
    y: average(points.map((point) => point.y))
  };
}

function nodeCenter(node: Node<GraphNodeData>, measured: Map<string, MeasuredNode>): Point {
  return rectCenter(rectForNode(node, measured));
}

function nodesByType(nodes: Node<GraphNodeData>[], type: Node["type"]): Node<GraphNodeData>[] {
  return nodes.filter((node) => node.type === type);
}

function packHorizontally(
  nodes: Node<GraphNodeData>[],
  measured: Map<string, MeasuredNode>,
  orderedAnchors: AxisAnchor[],
  gap: number
): Node<GraphNodeData>[] {
  const byId = new Map(nodes.map((node) => [node.id, { ...node, position: { ...node.position } }]));
  const ordered = orderedAnchors
    .map((entry) => {
      const node = byId.get(entry.nodeId);
      return node ? { node, anchor: entry.anchor } : undefined;
    })
    .filter((entry): entry is { node: Node<GraphNodeData>; anchor: number } => Boolean(entry));

  if (ordered.length === 0) {
    return nodes;
  }

  const totalWidth = ordered.reduce((sum, entry) => sum + measuredWidth(entry.node, measured), 0) + gap * Math.max(0, ordered.length - 1);
  const anchorCenter = average(ordered.map((entry) => entry.anchor));
  let cursor = anchorCenter - totalWidth / 2;

  for (const entry of ordered) {
    entry.node.position.x = Math.round(cursor);
    cursor += measuredWidth(entry.node, measured) + gap;
  }

  return nodes.map((node) => byId.get(node.id) ?? node);
}

function packVertically(
  nodes: Node<GraphNodeData>[],
  measured: Map<string, MeasuredNode>,
  orderedAnchors: AxisAnchor[],
  gap: number
): Node<GraphNodeData>[] {
  const byId = new Map(nodes.map((node) => [node.id, { ...node, position: { ...node.position } }]));
  const ordered = orderedAnchors
    .map((entry) => {
      const node = byId.get(entry.nodeId);
      return node ? { node, anchor: entry.anchor } : undefined;
    })
    .filter((entry): entry is { node: Node<GraphNodeData>; anchor: number } => Boolean(entry));

  if (ordered.length === 0) {
    return nodes;
  }

  const totalHeight = ordered.reduce((sum, entry) => sum + measuredHeight(entry.node, measured), 0) + gap * Math.max(0, ordered.length - 1);
  const anchorCenter = average(ordered.map((entry) => entry.anchor));
  let cursor = anchorCenter - totalHeight / 2;

  for (const entry of ordered) {
    entry.node.position.y = Math.round(cursor);
    cursor += measuredHeight(entry.node, measured) + gap;
  }

  return nodes.map((node) => byId.get(node.id) ?? node);
}

function serviceDependencyRanks(services: ServiceNodeModel[], dependencyEdges: DependencyEdgeRecord[]): Map<string, number> {
  const serviceIds = services.map((service) => service.id).sort((left, right) => left.localeCompare(right));
  const rank = new Map(serviceIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(serviceIds.map((id) => [id, 0]));

  for (const edge of dependencyEdges) {
    outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge.targetId]);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
  }

  const queue = serviceIds.filter((id) => (indegree.get(id) ?? 0) === 0);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const dependent of outgoing.get(current) ?? []) {
      rank.set(dependent, Math.max(rank.get(dependent) ?? 0, (rank.get(current) ?? 0) + 1));
      indegree.set(dependent, (indegree.get(dependent) ?? 1) - 1);
      if ((indegree.get(dependent) ?? 0) === 0) {
        queue.push(dependent);
      }
    }
  }

  return rank;
}

function collectVolumeResources(project: ProjectSummary): VolumeResource[] {
  const resources = new Map<string, VolumeResource>();
  const servicesByName = new Map(project.services.map((service) => [service.name, service]));
  const composeProjectName = project.composeProjectName;

  for (const service of [...project.services].sort((left, right) => left.name.localeCompare(right.name))) {
    const runtimeMounts = service.details?.mounts ?? [];

    for (const mount of runtimeMounts) {
      if (mount.type !== "volume" || !mount.name) {
        continue;
      }

      const volumeName = canonicalVolumeName(mount.name, service, composeProjectName);
      const id = `volume:${volumeName}`;
      const existing = resources.get(id) ?? {
        id,
        name: volumeName,
        path: volumeName,
        consumerIds: [],
        targetPaths: new Map<string, string>()
      };
      if (!existing.consumerIds.includes(service.id)) {
        existing.consumerIds.push(service.id);
      }
      existing.targetPaths.set(service.id, mountLabel(mount, volumeName));
      resources.set(id, existing);
    }
  }

  for (const relationship of project.relationshipEdges) {
    if (relationship.kind !== "volume") {
      continue;
    }

    const targetService = servicesByName.get(relationship.to);
    if (!targetService) {
      continue;
    }

    const sourceName = canonicalVolumeName(relationship.from, targetService, composeProjectName);
    if (!sourceName || isPathLike(normalizeHostPath(sourceName))) {
      continue;
    }

    const id = `volume:${sourceName}`;
    const existing = resources.get(id) ?? {
      id,
      name: sourceName,
      path: sourceName,
      consumerIds: [],
      targetPaths: new Map<string, string>()
    };
    if (!existing.consumerIds.includes(targetService.id)) {
      existing.consumerIds.push(targetService.id);
    }

    const matchingMount = targetService.details?.mounts.find(
      (mount) => mount.name && canonicalVolumeName(mount.name, targetService, composeProjectName) === sourceName
    );
    existing.targetPaths.set(targetService.id, mountLabel(matchingMount, relationship.label ?? sourceName));
    resources.set(id, existing);
  }

  return [...resources.values()]
    .filter((resource) => resource.consumerIds.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((resource) => ({
      ...resource,
      consumerIds: [...resource.consumerIds].sort((left, right) => left.localeCompare(right))
    }));
}

function collectExternalDependencies(project: ProjectSummary): ExternalDependencyNode[] {
  const externalMap = new Map<string, ExternalDependencyNode>();
  const serviceByName = new Map(project.services.map((service) => [service.name, service]));

  for (const dependencyEdge of project.relationshipEdges) {
    if (dependencyEdge.kind !== "depends_on") {
      continue;
    }

    if (serviceByName.has(dependencyEdge.to)) {
      continue;
    }

    const consumer = serviceByName.get(dependencyEdge.from);
    if (!consumer) {
      continue;
    }

    const id = `external-service:${dependencyEdge.to}`;
    const existing = externalMap.get(id) ?? {
      id,
      name: dependencyEdge.to,
      consumerIds: []
    };
    if (!existing.consumerIds.includes(consumer.id)) {
      existing.consumerIds.push(consumer.id);
    }
    externalMap.set(id, existing);
  }

  return [...externalMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function edgeLabelRect(
  edge: Edge<GraphEdgeData>,
  nodesById: Map<string, Node<GraphNodeData>>,
  measured: Map<string, MeasuredNode>
): Rect | undefined {
  if (!edge.data?.label) {
    return undefined;
  }

  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  if (!sourceNode || !targetNode) {
    return undefined;
  }

  const sourceCenter = rectCenter(rectForNode(sourceNode, measured));
  const targetCenter = rectCenter(rectForNode(targetNode, measured));

  return {
    x: (sourceCenter.x + targetCenter.x) / 2 - LABEL_WIDTH / 2,
    y: (sourceCenter.y + targetCenter.y) / 2 - LABEL_HEIGHT / 2,
    width: LABEL_WIDTH,
    height: LABEL_HEIGHT
  };
}

function resolveServiceLayerSpacing(nodes: Node<GraphNodeData>[], measured: Map<string, MeasuredNode>): Node<GraphNodeData>[] {
  const layers = new Map<number, Node<GraphNodeData>[]>();
  for (const node of nodesByType(nodes, "serviceNode")) {
    const layer = Math.round(node.position.y / (SERVICE_NODE_HEIGHT + SERVICE_GAP_Y));
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }

  let resolved = [...nodes];
  for (const [, layerNodes] of [...layers.entries()].sort((left, right) => left[0] - right[0])) {
    const anchors = [...layerNodes]
      .sort((left, right) => left.position.x - right.position.x || left.id.localeCompare(right.id))
      .map((node) => ({
        nodeId: node.id,
        anchor: nodeCenter(node, measured).x
      }));
    resolved = packHorizontally(resolved, measured, anchors, SERVICE_GAP_X);
  }

  return resolved;
}

function resolveSideColumnAnchors(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
  measured: Map<string, MeasuredNode>
): Node<GraphNodeData>[] {
  const byId = new Map(nodes.map((node) => [node.id, { ...node, position: { ...node.position } }]));

  const serviceNodes = nodesByType(nodes, "serviceNode");
  if (serviceNodes.length === 0) {
    return nodes;
  }

  const serviceRects = serviceNodes.map((node) => rectForNode(node, measured));
  const maxRight = Math.max(...serviceRects.map((rect) => rect.x + rect.width));

  const volumeAnchors = nodesByType(nodes, "volumeNode")
    .map((node) => {
      const consumers = edges
        .filter((edge) => edge.source === node.id && edge.data?.kind === "mount")
        .map((edge) => byId.get(edge.target))
        .filter((entry): entry is Node<GraphNodeData> => Boolean(entry));
      const anchorY = consumers.length > 0 ? average(consumers.map((entry) => nodeCenter(entry, measured).y)) : nodeCenter(node, measured).y;
      const minX =
        consumers.length > 0
          ? Math.max(...consumers.map((entry) => rectForNode(entry, measured).x + measuredWidth(entry, measured))) + VOLUME_HORIZONTAL_GAP
          : maxRight + SIDE_COLUMN_OFFSET;
      return { nodeId: node.id, anchor: anchorY, minX };
    })
    .sort((left, right) => left.anchor - right.anchor || left.nodeId.localeCompare(right.nodeId));

  const externalAnchors = nodesByType(nodes, "externalNode")
    .map((node) => {
      const consumers = edges
        .filter((edge) => edge.source === node.id && edge.data?.kind === "dependency")
        .map((edge) => byId.get(edge.target))
        .filter((entry): entry is Node<GraphNodeData> => Boolean(entry));
      const anchorX = consumers.length > 0 ? average(consumers.map((entry) => nodeCenter(entry, measured).x)) : nodeCenter(node, measured).x;
      return { nodeId: node.id, anchor: anchorX };
    })
    .sort((left, right) => left.anchor - right.anchor || left.nodeId.localeCompare(right.nodeId));

  let resolved = packVertically(nodes, measured, volumeAnchors, GLOBAL_COLLISION_PADDING);
  resolved = packHorizontally(resolved, measured, externalAnchors, GLOBAL_COLLISION_PADDING);

  const nextById = new Map(resolved.map((node) => [node.id, node]));
  for (const entry of volumeAnchors) {
    const node = nextById.get(entry.nodeId);
    if (!node) {
      continue;
    }

    node.position.x = Math.max(Math.round(entry.minX), Math.round(maxRight + SIDE_COLUMN_OFFSET));
  }

  for (const entry of externalAnchors) {
    const node = nextById.get(entry.nodeId);
    if (!node) {
      continue;
    }

    node.position.y = Math.round(Math.min(...serviceRects.map((rect) => rect.y)) - measuredHeight(node, measured) - EXTERNAL_ROW_OFFSET);
  }

  return resolved.map((node) => nextById.get(node.id) ?? node);
}

export function buildGraph(project: ProjectSummary): { nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] } {
  const edges: Edge<GraphEdgeData>[] = [];
  const edgeKeys = new Set<string>();
  const services = [...project.services].sort((left, right) => left.name.localeCompare(right.name));
  const serviceByName = new Map(services.map((service) => [service.name, service]));
  const dependencyRecords: DependencyEdgeRecord[] = [];

  for (const relationship of project.relationshipEdges) {
    if (relationship.kind !== "depends_on") {
      continue;
    }

    const consumer = serviceByName.get(relationship.from);
    if (!consumer) {
      continue;
    }

    const provider = serviceByName.get(relationship.to);
    const providerId = provider?.id ?? `external-service:${relationship.to}`;
    const label = dependencyEdgeLabel(relationship.condition);
    dependencyRecords.push({
      sourceId: providerId,
      targetId: consumer.id,
      ...(label ? { label } : {})
    });
  }

  const serviceIdSet = new Set(services.map((service) => service.id));
  const ranks = serviceDependencyRanks(
    services,
    dependencyRecords.filter((edge) => serviceIdSet.has(edge.sourceId) && serviceIdSet.has(edge.targetId))
  );

  const servicesByRank = new Map<number, ServiceNodeModel[]>();
  for (const service of services) {
    const rank = ranks.get(service.id) ?? 0;
    const row = [...(servicesByRank.get(rank) ?? []), service].sort((left, right) => left.name.localeCompare(right.name));
    servicesByRank.set(rank, row);
  }

  const sortedRanks = [...servicesByRank.keys()].sort((left, right) => left - right);
  const nodes: Node<GraphNodeData>[] = [];

  for (const rank of sortedRanks) {
    const row = servicesByRank.get(rank) ?? [];
    const rowWidth = row.length * SERVICE_NODE_WIDTH + Math.max(0, row.length - 1) * SERVICE_GAP_X;
    const rowStartX = -rowWidth / 2;

    row.forEach((service, index) => {
      nodes.push({
        id: service.id,
        type: "serviceNode",
        position: {
          x: rowStartX + index * (SERVICE_NODE_WIDTH + SERVICE_GAP_X),
          y: rank * (SERVICE_NODE_HEIGHT + SERVICE_GAP_Y)
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        data: service,
        zIndex: 3
      });
    });
  }

  const positionedServices = serviceNodeMap(nodes);
  const volumeResources = collectVolumeResources(project);
  const externalNodes = collectExternalDependencies(project);
  const serviceCenters = [...positionedServices.values()].map(centerOf);
  const maxServiceX = Math.max(...serviceCenters.map((point) => point.x));
  const minServiceY = Math.min(...serviceCenters.map((point) => point.y));

  const positionedVolumes = [...volumeResources]
    .map((resource) => ({
      resource,
      point: {
        x: maxServiceX + SIDE_COLUMN_OFFSET,
        y: consumerCenter(resource.consumerIds, positionedServices).y
      }
    }))
    .sort((left, right) => left.point.y - right.point.y || left.resource.name.localeCompare(right.resource.name));

  for (let index = 1; index < positionedVolumes.length; index += 1) {
    const previous = positionedVolumes[index - 1];
    const current = positionedVolumes[index];
    if (!previous || !current) {
      continue;
    }

    if (current.point.y - previous.point.y < SIDE_COLLISION_GAP) {
      current.point.y = previous.point.y + SIDE_COLLISION_GAP;
    }
  }

  positionedVolumes.forEach(({ resource, point }) => {
    nodes.push({
      id: resource.id,
      type: "volumeNode",
      position: {
        x: point.x - COMPACT_NODE_WIDTH / 2,
        y: point.y - COMPACT_NODE_HEIGHT / 2
      },
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      data: {
        name: resource.name,
        path: resource.path,
        consumerCount: resource.consumerIds.length
      },
      zIndex: 2
    });
  });

  const positionedExternals = [...externalNodes]
    .map((external) => ({
      external,
      point: {
        x: consumerCenter(external.consumerIds, positionedServices).x,
        y: minServiceY - EXTERNAL_ROW_OFFSET
      }
    }))
    .sort((left, right) => left.point.x - right.point.x || left.external.name.localeCompare(right.external.name));

  for (let index = 1; index < positionedExternals.length; index += 1) {
    const previous = positionedExternals[index - 1];
    const current = positionedExternals[index];
    if (!previous || !current) {
      continue;
    }

    if (current.point.x - previous.point.x < TOP_COLLISION_GAP) {
      current.point.x = previous.point.x + TOP_COLLISION_GAP;
    }
  }

  positionedExternals.forEach(({ external, point }) => {
    nodes.push({
      id: external.id,
      type: "externalNode",
      position: {
        x: point.x - COMPACT_NODE_WIDTH / 2,
        y: point.y - COMPACT_NODE_HEIGHT / 2
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        name: external.name,
        kind: "service"
      },
      zIndex: 2
    });
  });

  for (const record of dependencyRecords) {
    const key = edgeKey({
      source: record.sourceId,
      target: record.targetId,
      kind: "dependency",
      ...(record.label ? { label: record.label } : {})
    });
    if (edgeKeys.has(key)) {
      continue;
    }
    edgeKeys.add(key);

    edges.push({
      id: `dependency:${record.sourceId}:${record.targetId}`,
      type: "smartStraight",
      source: record.sourceId,
      target: record.targetId,
      sourceHandle: "dependency-out",
      targetHandle: "dependency-in",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: "var(--accent-copper)"
      },
      style: {
        stroke: "var(--accent-copper)",
        strokeWidth: 2.2
      },
      data: {
        kind: "dependency",
        color: "var(--accent-copper)",
        ...(record.label ? { label: record.label } : {})
      }
    });
  }

  for (const resource of volumeResources) {
    for (const serviceId of resource.consumerIds) {
      const label = resource.targetPaths.get(serviceId);
      const key = edgeKey({
        source: resource.id,
        target: serviceId,
        kind: "mount",
        ...(label ? { label } : {})
      });
      if (edgeKeys.has(key)) {
        continue;
      }
      edgeKeys.add(key);

      edges.push({
        id: `volume:${resource.id}:${serviceId}`,
        type: "smartStraight",
        source: resource.id,
        target: serviceId,
        sourceHandle: "resource-out",
        targetHandle: "storage",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "var(--volume-node)"
        },
        style: {
          stroke: "var(--volume-node)",
          strokeWidth: 1.8,
          strokeDasharray: "6 4"
        },
        data: {
          kind: "mount",
          color: "var(--volume-node)",
          dashed: true,
          ...(label ? { label } : {})
        }
      });
    }
  }

  return { nodes, edges };
}

export function layoutGraph(project: ProjectSummary): { nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] } {
  return buildGraph(project);
}

function resolveLayerCollisions(nodes: Node<GraphNodeData>[], measured: Map<string, MeasuredNode>): Node<GraphNodeData>[] {
  let mutable = resolveServiceLayerSpacing(nodes, measured);

  for (const type of ["volumeNode"] as const) {
    const columnNodes = mutable.filter((entry) => entry.type === type).sort((left, right) => left.position.y - right.position.y);
    for (let index = 1; index < columnNodes.length; index += 1) {
      const previous = columnNodes[index - 1];
      const current = columnNodes[index];
      if (!previous || !current) {
        continue;
      }

      const minY = previous.position.y + measuredHeight(previous, measured) + GLOBAL_COLLISION_PADDING;
      if (current.position.y < minY) {
        current.position.y = minY;
      }
    }
  }

  const externalNodes = mutable.filter((entry) => entry.type === "externalNode").sort((left, right) => left.position.x - right.position.x);
  for (let index = 1; index < externalNodes.length; index += 1) {
    const previous = externalNodes[index - 1];
    const current = externalNodes[index];
    if (!previous || !current) {
      continue;
    }

    const minX = previous.position.x + measuredWidth(previous, measured) + GLOBAL_COLLISION_PADDING;
    if (current.position.x < minX) {
      current.position.x = minX;
    }
  }

  return mutable;
}

function resolveGlobalNodeCollisions(nodes: Node<GraphNodeData>[], measured: Map<string, MeasuredNode>): Node<GraphNodeData>[] {
  const mutable = [...nodes];

  for (let pass = 0; pass < 10; pass += 1) {
    let moved = false;

    for (let index = 0; index < mutable.length; index += 1) {
      const current = mutable[index];
      if (!current) {
        continue;
      }

      for (let compareIndex = index + 1; compareIndex < mutable.length; compareIndex += 1) {
        const other = mutable[compareIndex];
        if (!other) {
          continue;
        }

        if (!rectsOverlap(rectForNode(current, measured), rectForNode(other, measured))) {
          continue;
        }

        if (current.type === "volumeNode") {
          mutable[index] = nudgeNode(current, GLOBAL_COLLISION_PADDING, 0);
        } else if (other.type === "volumeNode") {
          mutable[compareIndex] = nudgeNode(other, GLOBAL_COLLISION_PADDING, 0);
        } else if (current.type === "serviceNode" && other.type === "serviceNode") {
          mutable[compareIndex] = nudgeNode(other, GLOBAL_COLLISION_PADDING, GLOBAL_COLLISION_PADDING / 2);
        } else if (current.type === "serviceNode") {
          mutable[compareIndex] = nudgeNode(other, GLOBAL_COLLISION_PADDING / 2, GLOBAL_COLLISION_PADDING);
        } else if (other.type === "serviceNode") {
          mutable[index] = nudgeNode(current, -GLOBAL_COLLISION_PADDING / 2, -GLOBAL_COLLISION_PADDING);
        } else {
          mutable[index] = nudgeNode(current, -GLOBAL_COLLISION_PADDING / 2, -GLOBAL_COLLISION_PADDING / 2);
          mutable[compareIndex] = nudgeNode(other, GLOBAL_COLLISION_PADDING / 2, GLOBAL_COLLISION_PADDING / 2);
        }

        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return mutable;
}

function resolveEdgeLabelCollisions(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
  measured: Map<string, MeasuredNode>
): Node<GraphNodeData>[] {
  const mutable = [...nodes];

  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    const byId = new Map(mutable.map((node) => [node.id, node]));

    for (const edge of edges) {
      const labelRect = edgeLabelRect(edge, byId, measured);
      if (!labelRect) {
        continue;
      }

      for (let index = 0; index < mutable.length; index += 1) {
        const node = mutable[index];
        if (!node || node.id === edge.source || node.id === edge.target) {
          continue;
        }

        if (!rectsOverlap(labelRect, rectForNode(node, measured), 12)) {
          continue;
        }

        if (edge.data?.kind === "mount") {
          mutable[index] = nudgeNode(node, 0, GLOBAL_COLLISION_PADDING);
        } else {
          mutable[index] = nudgeNode(node, 0, GLOBAL_COLLISION_PADDING);
        }

        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return mutable;
}

export function resolveMeasuredLayout(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
  measuredNodes: MeasuredNode[]
): Node<GraphNodeData>[] {
  const measured = new Map(measuredNodes.map((node) => [node.id, node]));

  let resolved = resolveSideColumnAnchors(nodes, edges, measured);
  resolved = resolveLayerCollisions(resolved, measured);
  resolved = resolveGlobalNodeCollisions(resolved, measured);
  resolved = resolveEdgeLabelCollisions(resolved, edges, measured);
  resolved = resolveSideColumnAnchors(resolved, edges, measured);
  resolved = resolveLayerCollisions(resolved, measured);
  resolved = resolveGlobalNodeCollisions(resolved, measured);

  return resolved.map((node) => {
    if (node.type !== "volumeNode") {
      return node;
    }

    const targetEdge = edges.find((edge) => edge.source === node.id && edge.data?.kind === "mount");
    const targetNode = targetEdge ? resolved.find((entry) => entry.id === targetEdge.target) : undefined;
    if (!targetNode) {
      return node;
    }

    const minX = targetNode.position.x + measuredWidth(targetNode, measured) + VOLUME_HORIZONTAL_GAP;
    if (node.position.x >= minX) {
      return node;
    }

    return {
      ...node,
      position: {
        x: minX,
        y: node.position.y
      }
    };
  });
}
